import { Router } from 'express';
import { asyncRoute } from '../middleware/errorHandler.js';
import { requireRole } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimit.js';
import * as anthropicProvider from '../ai/providers/anthropicProvider.js';
import * as openaiProvider from '../ai/providers/openaiProvider.js';
import { generateAndEvaluateField } from '../ai/orchestrator.js';
import { computeCostUsd, usdToInr } from '../ai/pricing.js';
import { config } from '../config.js';
import { getDraftById } from '../repositories/draftsRepo.js';

export const aiRouter = Router();

const DRAFT_ID_RE = /^draft_\d+$/;

// Per-field regenerate is a Senior/Admin-only action, gated to whichever review stage that role
// actually owns (see AiFieldToolbar's mount condition in App.jsx: Senior during senior_review,
// Admin during admin_review) — the frontend already hides the controls otherwise, but nothing
// enforced it server-side until now. Rate-limited per user since every call is a real, billed
// Claude+GPT round trip.
const REVIEW_STAGE_BY_ROLE = { senior: 'senior_review', admin: 'admin_review' };

aiRouter.post(
  '/generate-field',
  requireRole('senior', 'admin'),
  rateLimit({ windowMs: 5 * 60 * 1000, max: 40, keyFn: (req) => req.currentUser.id }),
  asyncRoute(async (req, res) => {
    const { draftId, pageType, fieldKey, fieldLabel, fieldInstructions, outputFormat, facts, mode, existingContent } = req.body || {};

    if (!draftId || !DRAFT_ID_RE.test(draftId)) {
      const err = new Error('Invalid or missing draftId'); err.status = 400; throw err;
    }
    if (!pageType || !fieldKey || !fieldLabel) {
      const err = new Error('pageType, fieldKey, and fieldLabel are required'); err.status = 400; throw err;
    }

    const draft = await getDraftById(draftId);
    if (!draft) {
      const err = new Error('Draft not found'); err.status = 404; throw err;
    }
    if (draft.status !== REVIEW_STAGE_BY_ROLE[req.currentUser.role]) {
      const err = new Error('This draft is not in review with you right now'); err.status = 409; throw err;
    }

    const result = await generateAndEvaluateField({
      draftId,
      pageType,
      fieldKey,
      fieldLabel,
      fieldInstructions: fieldInstructions || '',
      outputFormat: outputFormat === 'markdown' || outputFormat === 'plain-short' ? outputFormat : 'plain',
      facts: facts && typeof facts === 'object' ? facts : {},
      mode: mode === 'regenerate' ? 'regenerate' : 'generate',
      existingContent: existingContent || ''
    });

    res.json(result);
  })
);

// M1 throwaway endpoint: proves both provider adapters + API keys work end-to-end,
// independent of any orchestration/business logic (added in M2). Still costs real tokens on
// every call, so it's rate-limited the same as the real generation routes.
aiRouter.post('/test-generate', rateLimit({ windowMs: 5 * 60 * 1000, max: 10, keyFn: (req) => req.currentUser.id }), asyncRoute(async (req, res) => {
  const prompt = 'Reply with exactly the single word: pong';

  const [claudeReply, gptReply] = await Promise.all([
    anthropicProvider.complete({
      system: 'You respond with exactly what is asked, nothing else.',
      prompt,
      maxTokens: 16
    }),
    openaiProvider.complete({
      system: 'You respond with exactly what is asked, nothing else.',
      prompt,
      maxTokens: 16
    })
  ]);

  res.json({
    anthropic: { model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5', reply: claudeReply.text.trim() },
    openai: { model: process.env.OPENAI_MODEL || 'gpt-4o', reply: gptReply.text.trim() }
  });
}));

// Reference per-field token assumptions — approximate, not measured from real calls; used only
// to give the Intern a rough pre-generate cost estimate before any API call is made. Field
// counts per page type mirror src/config/schemas.js's aiAssist fields (backend doesn't import
// frontend code, so these are a coarse, occasionally-drifting approximation, not a live count).
const AI_ASSIST_FIELD_COUNTS = {
  university: { cheap: 2, normal: 8 },
  course: { cheap: 2, normal: 7 },
  specialization: { cheap: 2, normal: 7 }
};
const CHEAP_FIELD_TOKENS = { input: 900, output: 30 };
const NORMAL_FIELD_TOKENS = { input: 1000, output: 150 };
const EVALUATOR_TOKENS = { input: 700, output: 100 }; // one GPT evaluate call per generated field

aiRouter.get('/pricing-estimate', asyncRoute(async (req, res) => {
  const { pageType } = req.query;
  const counts = AI_ASSIST_FIELD_COUNTS[pageType];
  if (!counts) {
    const err = new Error('Unknown or missing pageType'); err.status = 400; throw err;
  }

  const cheapGenerateCost = counts.cheap * computeCostUsd({
    model: config.anthropicCheapModel, inputTokens: CHEAP_FIELD_TOKENS.input, outputTokens: CHEAP_FIELD_TOKENS.output
  });
  const normalGenerateCost = counts.normal * computeCostUsd({
    model: config.anthropicModel, inputTokens: NORMAL_FIELD_TOKENS.input, outputTokens: NORMAL_FIELD_TOKENS.output
  });
  const evaluateCost = (counts.cheap + counts.normal) * computeCostUsd({
    model: config.openaiModel, inputTokens: EVALUATOR_TOKENS.input, outputTokens: EVALUATOR_TOKENS.output
  });

  const estimatedUsd = cheapGenerateCost + normalGenerateCost + evaluateCost;
  res.json({ estimatedUsd, estimatedInr: usdToInr(estimatedUsd) });
}));
