import { Router } from 'express';
import { asyncRoute } from '../middleware/errorHandler.js';
import { requireRole } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { requireAiBudget } from '../ai/budget.js';
import * as anthropicProvider from '../ai/providers/anthropicProvider.js';
import * as openaiProvider from '../ai/providers/openaiProvider.js';
import { generateAndEvaluateField } from '../ai/orchestrator.js';
import { computeCostUsd, usdToInr } from '../ai/pricing.js';
import { config } from '../config.js';
import { getDraftById } from '../repositories/draftsRepo.js';
import { getEffectiveSchemas } from '../repositories/fieldSettingsRepo.js';
import { aiFieldsOf } from '../../src/config/fieldSettings.js';

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
  requireAiBudget,
  asyncRoute(async (req, res) => {
    const { draftId, pageType, fieldKey, fieldLabel, fieldInstructions, facts, mode, existingContent } = req.body || {};

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

    // Only a field the Admin's settings make AI-generated, written to those settings' instructions.
    const setting = aiFieldsOf((await getEffectiveSchemas())[draft.page_type]).find(f => f.fieldKey === fieldKey);
    if (!setting) {
      const err = new Error('This field is not set to be AI-generated'); err.status = 400; throw err;
    }

    const result = await generateAndEvaluateField({
      draftId,
      pageType: draft.page_type,
      fieldKey,
      fieldLabel: setting.fieldLabel || fieldLabel,
      fieldInstructions: setting.fieldInstructions || fieldInstructions || '',
      outputFormat: setting.outputFormat,
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
aiRouter.post('/test-generate', rateLimit({ windowMs: 5 * 60 * 1000, max: 10, keyFn: (req) => req.currentUser.id }), requireAiBudget, asyncRoute(async (req, res) => {
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

// Rough pre-generate estimate for the Intern, before any API call is made. Counts this page type's
// AI fields under the Admin's current field settings: `seo` is the SEO title + meta description
// (Claude only - checked by rules, see ai/seoChecks.js), `narrative` is everything else (Claude +
// one GPT evaluation). Claude figures were measured on real pages with prompt caching on (Oct 2026;
// output includes Sonnet's thinking, which varies a lot per call); the GPT figures are the old
// measured size less what compact JSON and caching save. Retries aren't included.
const SEO_FIELD_KEYS = new Set(['seo_title', 'meta_description']);
async function aiFieldCounts(pageType) {
  const schema = (await getEffectiveSchemas())[pageType];
  if (!schema) return null;
  const keys = aiFieldsOf(schema).map(f => f.fieldKey);
  const seo = keys.filter(k => SEO_FIELD_KEYS.has(k)).length;
  return { seo, narrative: keys.length - seo };
}
const SHARED_PREFIX_TOKENS = 4000; // system prompt + the page's facts: written to the cache once, then read by every field
const NARRATIVE_FIELD_TOKENS = { input: 110, output: 500 };
const SEO_FIELD_TOKENS = { input: 180, output: 130 }; // 3 short versions per call
const EVALUATOR_TOKENS = { input: 750, cacheRead: 1700, output: 180 };

aiRouter.get('/pricing-estimate', asyncRoute(async (req, res) => {
  const { pageType } = req.query;
  const counts = await aiFieldCounts(pageType);
  if (!counts) {
    const err = new Error('Unknown or missing pageType'); err.status = 400; throw err;
  }

  const writerModel = config.anthropicModel;
  const cacheWarmupCost = computeCostUsd({ model: writerModel, cacheWriteTokens: SHARED_PREFIX_TOKENS });
  const fieldCost = (tokens) => computeCostUsd({
    model: writerModel, inputTokens: tokens.input, outputTokens: tokens.output, cacheReadTokens: SHARED_PREFIX_TOKENS
  });
  const generateCost = counts.narrative * fieldCost(NARRATIVE_FIELD_TOKENS) + counts.seo * fieldCost(SEO_FIELD_TOKENS);
  const evaluateCost = counts.narrative * computeCostUsd({
    model: config.openaiModel, inputTokens: EVALUATOR_TOKENS.input, outputTokens: EVALUATOR_TOKENS.output, cacheReadTokens: EVALUATOR_TOKENS.cacheRead
  });

  const estimatedUsd = cacheWarmupCost + generateCost + evaluateCost;
  res.json({ estimatedUsd, estimatedInr: usdToInr(estimatedUsd) });
}));
