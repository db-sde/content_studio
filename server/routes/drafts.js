import { Router } from 'express';
import { asyncRoute } from '../middleware/errorHandler.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { createDraft, getDraftById, listDrafts, updateDraftFormData, updateDraftStatus, setAllowInternAiEdit, setDraftPriority, setWordpressPublishInfo, deleteDraft } from '../repositories/draftsRepo.js';
import { generateAllAiFields } from '../ai/batchGenerate.js';
import { getGenerationLogsByDraft } from '../repositories/generationLogsRepo.js';
import { getEvaluationLogsByDraft } from '../repositories/evaluationLogsRepo.js';
import { getFieldRecordsByDraft } from '../repositories/fieldRecordsRepo.js';
import { computeCostUsd, usdToInr } from '../ai/pricing.js';
import { canEditFieldServer } from '../utils/serverPermissions.js';
import { validateFactsOnly, validateState, transformToACF } from '../../src/config/schemas.js';
import { createNotification } from '../repositories/notificationsRepo.js';
import { publishDraftToWordPress } from '../integrations/wordpressClient.js';
import { upsertDirectoryEntry } from '../repositories/directoryRepo.js';

export const draftsRouter = Router();

const DRAFT_ID_RE = /^draft_\d+$/;

// The field holding this page type's display title varies (a university's name field isn't a
// course's) — shared by the directory-entry upsert on approve (below) and the
// publish-to-wordpress route further down.
const TITLE_FIELD_BY_PAGE_TYPE = {
  university: 'university_name',
  course: 'program_name',
  specialization: 'spec_name'
};

const DRAFT_STATUSES = ['intern_editing', 'senior_review', 'admin_review', 'approved'];

// Notification to raise when an Admin force-sets a draft directly to this status via the
// 'admin-set-status' override below (bypassing the normal named hand-off actions) — same
// recipient logic as the closest-matching named action, so the affected role still finds out even
// when the Admin skipped the usual path to get there. No entry for 'admin_review'/'approved': the
// Admin doing this already knows (nothing to notify about their own action), and nothing "sent" a
// draft to Approved in the hand-off sense.
const ADMIN_OVERRIDE_NOTIFY = {
  intern_editing: (draft) => ({ type: 'reverted_to_intern', recipientUserId: draft.created_by_user_id }),
  senior_review: () => ({ type: 'reverted_to_senior', recipientRole: 'senior' })
};

// Applied after ANY transition (a named STATUS_ACTIONS entry or the Admin override) that lands a
// university/course draft on 'approved' — feeds the searchable Linked University/Linked Course
// dropdowns. Idempotent (ON CONFLICT DO UPDATE), so re-running it for an already-approved draft
// just refreshes the same row rather than duplicating it.
async function upsertDirectoryIfApproved(draft, updated) {
  if (updated.status !== 'approved') return;
  const titleField = TITLE_FIELD_BY_PAGE_TYPE[draft.page_type];
  if (!titleField || !['university', 'course'].includes(draft.page_type)) return;
  const displayName = updated.form_data[titleField];
  if (!displayName) return;
  // A course's own university_name disambiguates it from a same-named course at a different
  // university (e.g. two universities both approved as "MBA in Finance") — null for universities,
  // which have nothing above them to disambiguate against.
  const secondaryLabel = draft.page_type === 'course' ? (updated.form_data.university_name || null) : null;
  await upsertDirectoryEntry({ draftId: draft.id, pageType: draft.page_type, displayName, secondaryLabel });
}

function notFound() {
  const err = new Error('Draft not found'); err.status = 404; return err;
}

async function loadDraftOr404(id) {
  if (!DRAFT_ID_RE.test(id)) throw notFound();
  const draft = await getDraftById(id);
  if (!draft) throw notFound();
  return draft;
}

draftsRouter.get('/', asyncRoute(async (req, res) => {
  res.json({ drafts: await listDrafts() });
}));

draftsRouter.post('/', asyncRoute(async (req, res) => {
  const { pageType } = req.body || {};
  if (!pageType) {
    const err = new Error('pageType is required'); err.status = 400; throw err;
  }

  const id = `draft_${Date.now()}`;
  const draft = await createDraft({ id, pageType, formData: {}, createdByUserId: req.currentUser.id });
  res.json({ draft });
}));

draftsRouter.get('/:id', asyncRoute(async (req, res) => {
  res.json({ draft: await loadDraftOr404(req.params.id) });
}));

// Server-side backstop for field-level locking: the UI already disables locked inputs and the
// JSON edit-mode already filters its bulk-apply through canEditField, but until now nothing
// stopped a direct PUT from overwriting a locked field (e.g. an Intern editing an AI field, or
// anyone editing at all once a draft has left intern_editing). Any key the caller isn't allowed
// to touch is silently kept at its current value rather than rejecting the whole save — a normal
// autosave from a partially-locked form legitimately includes unchanged locked-field values.
draftsRouter.put('/:id', asyncRoute(async (req, res) => {
  const draft = await loadDraftOr404(req.params.id);
  const { formData } = req.body || {};
  if (!formData || typeof formData !== 'object') {
    const err = new Error('formData is required'); err.status = 400; throw err;
  }

  const permissionCtx = {
    role: req.currentUser.role,
    draftStatus: draft.status,
    allowInternAiEdit: !!draft.allow_intern_ai_edit
  };

  const safeFormData = { ...draft.form_data };
  const skippedKeys = [];
  Object.keys(formData).forEach(key => {
    const incoming = formData[key];
    const changed = JSON.stringify(incoming) !== JSON.stringify(draft.form_data[key]);
    if (!changed) return;
    if (canEditFieldServer(draft.page_type, key, permissionCtx)) {
      safeFormData[key] = incoming;
    } else {
      skippedKeys.push(key);
    }
  });

  const updated = await updateDraftFormData(req.params.id, safeFormData);
  res.json({ draft: updated, skippedKeys: skippedKeys.length ? skippedKeys : undefined });
}));

draftsRouter.delete('/:id', asyncRoute(async (req, res) => {
  const draft = await loadDraftOr404(req.params.id);
  if (!['senior', 'admin'].includes(req.currentUser.role) && draft.created_by_user_id !== req.currentUser.id) {
    const err = new Error('Only this draft\'s creator, a senior, or an admin can delete it'); err.status = 403; throw err;
  }
  await deleteDraft(req.params.id);
  res.json({ ok: true });
}));

// Senior or Admin per-draft toggle that additionally unlocks aiAssist fields for the Intern while
// the draft is still intern_editing (see src/utils/permissions.js's canEditField).
draftsRouter.patch('/:id/allow-intern-ai-edit', asyncRoute(async (req, res) => {
  await loadDraftOr404(req.params.id);
  if (!['senior', 'admin'].includes(req.currentUser.role)) {
    const err = new Error('Only a senior or admin can change this setting'); err.status = 403; throw err;
  }
  const { allow } = req.body || {};
  const draft = await setAllowInternAiEdit(req.params.id, !!allow);
  res.json({ draft });
}));

// Batch-generates every listed AI field (client-supplied — schemas.js is the frontend's single
// source of truth for aiAssist field metadata, see Phase 4 plan note), merges the results into
// the draft's form data, and auto-transitions status to senior_review. Used for both the
// Intern's initial "Generate All AI Fields" (onlyEmpty: false) and the post-revert
// "Generate Empty Fields" (onlyEmpty: true) — the latter must check emptiness against this
// draft's own stored form_data, which is why the client is required to save its current facts
// via PUT immediately before calling this (see draftsClient.generateAllFields). Only while the
// draft is actually at intern_editing — but usable by any role sitting on it at that stage, not
// literally Intern-only: a Senior or Admin who originates their own draft (skipping the Intern
// step entirely) needs the same way to turn filled-in facts into generated narrative fields.
// Rate-limited since a single call can fan out to ~10 real Claude+GPT round trips.
draftsRouter.post(
  '/:id/generate-all-fields',
  rateLimit({ windowMs: 5 * 60 * 1000, max: 10, keyFn: (req) => req.currentUser.id }),
  asyncRoute(async (req, res) => {
    const draft = await loadDraftOr404(req.params.id);
    if (!['intern', 'senior', 'admin'].includes(req.currentUser.role)) {
      const err = new Error('This role cannot trigger AI generation'); err.status = 403; throw err;
    }
    if (draft.status !== 'intern_editing') {
      const err = new Error('This draft is not with the intern right now'); err.status = 409; throw err;
    }
    // The "Generate All AI Fields" button is only enabled client-side once every non-AI required
    // field is filled — enforced here too so a direct API call can't trigger generation grounded
    // in incomplete facts.
    if (!validateFactsOnly(draft.form_data, draft.page_type).isValid) {
      const err = new Error('Required facts fields are not all filled in yet'); err.status = 409; throw err;
    }

    const { fields, facts, onlyEmpty } = req.body || {};
    if (!Array.isArray(fields) || !fields.length) {
      const err = new Error('fields must be a non-empty array'); err.status = 400; throw err;
    }

    const { values, failures } = await generateAllAiFields({
      draftId: draft.id, pageType: draft.page_type, fields, facts: facts || {},
      currentValues: draft.form_data, onlyEmpty: !!onlyEmpty
    });

    const mergedFormData = { ...draft.form_data, ...values };
    let updated = await updateDraftFormData(draft.id, mergedFormData);

    // Only hand the draft off to the Senior once every field actually generated — if some
    // failed, the successful ones are still saved (and won't be re-billed) but the draft stays
    // with the Intern so "Generate Empty Fields" can retry just the ones that failed.
    if (!failures.length) {
      updated = await updateDraftStatus(draft.id, 'senior_review');
    }

    res.json({ draft: updated, failures });
  })
);

// Review chain is now Intern -> Senior -> Admin -> Approved. Admin has every Senior permission
// (see permissions.js) plus this final stage: approving (and, separately, publishing to
// WordPress — see the publish-to-wordpress route below) and the power to bounce a draft back to
// EITHER the Senior or the Intern directly, not just one step back — an Admin reading a draft
// might spot a facts problem that's really the Intern's to fix, not the Senior's.
//
// `allowed` lists every (role, current-status) pair permitted to fire this action — plural
// because revert-to-intern is reachable from two different places (a Senior bouncing it during
// senior_review, or an Admin bouncing it during admin_review) and both should behave identically
// from the Intern's point of view.
//
// `priority`: 'set' marks a draft an Admin bounced backwards so it floats to the top of the
// recipient's list (see draftsRepo.js's listDrafts); 'clear' is the recipient "fixing" it and
// moving on, dropping it back into normal chronological order. Forward actions (send-to-senior,
// send-to-admin) always clear; only an Admin's backward reverts set it. `approve`/`reopen` touch
// neither — that's the same Admin acting on their own decision, not bouncing to someone else.
//
// `notify`: neither role has any way to know another has acted other than through this app, so
// every hand-off (forward or backward) raises a notification (see notificationsRepo.js) except
// `approve`/`reopen`, which nobody asked to be told about.
const STATUS_ACTIONS = {
  // A Senior or Admin who originates their own draft (no Intern involved) needs this same
  // forward step to reach senior_review too — otherwise a self-created draft would have no
  // Intern to advance it and would simply get stuck at intern_editing forever.
  'send-to-senior': {
    allowed: [
      { role: 'intern', from: 'intern_editing' },
      { role: 'senior', from: 'intern_editing' },
      { role: 'admin', from: 'intern_editing' }
    ],
    newStatus: 'senior_review',
    requiresComplete: true,
    priority: 'clear',
    notify: () => ({ type: 'sent_to_senior', recipientRole: 'senior' })
  },
  'send-to-admin': {
    allowed: [{ role: 'senior', from: 'senior_review' }],
    newStatus: 'admin_review',
    requiresComplete: true,
    priority: 'clear',
    notify: () => ({ type: 'sent_to_admin', recipientRole: 'admin' })
  },
  'revert-to-intern': {
    allowed: [{ role: 'senior', from: 'senior_review' }, { role: 'admin', from: 'admin_review' }],
    newStatus: 'intern_editing',
    priority: 'set',
    notify: (draft) => ({ type: 'reverted_to_intern', recipientUserId: draft.created_by_user_id })
  },
  'revert-to-senior': {
    allowed: [{ role: 'admin', from: 'admin_review' }],
    newStatus: 'senior_review',
    priority: 'set',
    notify: () => ({ type: 'reverted_to_senior', recipientRole: 'senior' })
  },
  'approve': {
    allowed: [{ role: 'admin', from: 'admin_review' }],
    newStatus: 'approved',
    requiresComplete: true
  },
  'reopen': {
    allowed: [{ role: 'admin', from: 'approved' }],
    newStatus: 'admin_review'
  }
};

draftsRouter.patch('/:id/status', asyncRoute(async (req, res) => {
  const draft = await loadDraftOr404(req.params.id);
  const { action, message } = req.body || {};

  // Admin override: jump a draft directly to any of the 4 statuses regardless of where it
  // currently is, bypassing the normal Intern -> Senior -> Admin chain — the Admin is the final
  // authority and may need to fix a misrouted draft without forcing it back through every
  // intermediate stage. The one check that's never skipped: moving TO 'approved' still requires
  // every required field to be complete, the same guarantee the named 'approve' action provides,
  // so this can't be used to accidentally mark an incomplete draft as done.
  if (action === 'admin-set-status') {
    if (req.currentUser.role !== 'admin') {
      const err = new Error('Only an admin can directly set a draft\'s status'); err.status = 403; throw err;
    }
    const { targetStatus } = req.body || {};
    if (!DRAFT_STATUSES.includes(targetStatus)) {
      const err = new Error(`targetStatus must be one of: ${DRAFT_STATUSES.join(', ')}`); err.status = 400; throw err;
    }
    if (targetStatus === draft.status) {
      const err = new Error('This draft is already in that status'); err.status = 409; throw err;
    }
    if (targetStatus === 'approved' && !validateState(draft.form_data, draft.page_type).isValid) {
      const err = new Error('This draft still has required fields missing'); err.status = 409; throw err;
    }

    await updateDraftStatus(req.params.id, targetStatus);
    // Landing back on Intern or Senior is a "bounce back" needing attention out of order, same as
    // the named revert-to-* actions; landing on Admin Review or Approved is the Admin's own
    // forward decision, so it drops back into normal chronological order like the named
    // send-to-* actions do.
    const updated = await setDraftPriority(req.params.id, ['intern_editing', 'senior_review'].includes(targetStatus));

    await upsertDirectoryIfApproved(draft, updated);

    const notifyFn = ADMIN_OVERRIDE_NOTIFY[targetStatus];
    if (notifyFn) {
      const { type, recipientRole, recipientUserId } = notifyFn(draft);
      await createNotification({
        draftId: draft.id,
        type,
        message: message ? String(message).slice(0, 2000) : null,
        createdByUserId: req.currentUser.id,
        recipientRole,
        recipientUserId
      });
    }

    res.json({ draft: updated });
    return;
  }

  const spec = STATUS_ACTIONS[action];
  if (!spec) {
    const err = new Error(`action must be one of: ${Object.keys(STATUS_ACTIONS).join(', ')}, admin-set-status`); err.status = 400; throw err;
  }
  const permitted = spec.allowed.some(a => a.role === req.currentUser.role && a.from === draft.status);
  if (!permitted) {
    const err = new Error(`A ${req.currentUser.role} may not perform "${action}" while this draft is "${draft.status}"`); err.status = 403; throw err;
  }
  if (spec.requiresComplete && !validateState(draft.form_data, draft.page_type).isValid) {
    const err = new Error('This draft still has required fields missing'); err.status = 409; throw err;
  }

  let updated = await updateDraftStatus(req.params.id, spec.newStatus);

  if (spec.priority === 'set') updated = await setDraftPriority(req.params.id, true);
  else if (spec.priority === 'clear') updated = await setDraftPriority(req.params.id, false);

  await upsertDirectoryIfApproved(draft, updated);

  if (spec.notify) {
    const { type, recipientRole, recipientUserId } = spec.notify(draft);
    await createNotification({
      draftId: draft.id,
      type,
      message: message ? String(message).slice(0, 2000) : null,
      createdByUserId: req.currentUser.id,
      recipientRole,
      recipientUserId
    });
  }

  res.json({ draft: updated });
}));

// PLACEHOLDER export format — the plan's Phase 7 explicitly defers the exact "Download Complete
// Data" file shape to a later product decision. Until that's confirmed, this ships a fuller JSON
// dump (draft + every generation/evaluation/field-record row) rather than inventing a real format.
draftsRouter.get('/:id/full-export', asyncRoute(async (req, res) => {
  const draft = await loadDraftOr404(req.params.id);
  res.json({
    draft,
    generationLogs: await getGenerationLogsByDraft(draft.id),
    evaluationLogs: await getEvaluationLogsByDraft(draft.id),
    fieldRecords: await getFieldRecordsByDraft(draft.id)
  });
}));

// Real running total, computed on-demand from this draft's actual generation/evaluation rows —
// cheap (at most ~20 rows per draft), so no need to cache/denormalize onto the drafts row.
draftsRouter.get('/:id/cost-summary', asyncRoute(async (req, res) => {
  const draft = await loadDraftOr404(req.params.id);
  const generationLogs = await getGenerationLogsByDraft(draft.id);
  const evaluationLogs = await getEvaluationLogsByDraft(draft.id);

  const totalUsd = [...generationLogs, ...evaluationLogs].reduce((sum, row) => (
    sum + computeCostUsd({ model: row.model, inputTokens: row.input_tokens, outputTokens: row.output_tokens })
  ), 0);

  res.json({
    totalUsd,
    totalInr: usdToInr(totalUsd),
    generateCalls: generationLogs.length,
    evaluateCalls: evaluationLogs.length
  });
}));

// Admin-only, and only once a draft is fully approved — publishing is the deliberate final act of
// the review chain, not something that happens as a side effect of approving. Re-publishing an
// already-live draft (e.g. Reopen -> fix -> re-approve) updates the same WordPress post via
// wordpress_post_id rather than creating a duplicate.
draftsRouter.post('/:id/publish-to-wordpress', asyncRoute(async (req, res) => {
  const draft = await loadDraftOr404(req.params.id);

  if (req.currentUser.role !== 'admin') {
    const err = new Error('Only an admin can publish to WordPress'); err.status = 403; throw err;
  }
  if (draft.status !== 'approved') {
    const err = new Error('Only an approved draft can be published to WordPress'); err.status = 409; throw err;
  }

  const titleField = TITLE_FIELD_BY_PAGE_TYPE[draft.page_type];
  const title = (titleField && draft.form_data[titleField]) || 'Untitled';
  const acfFields = transformToACF(draft.form_data, draft.page_type);

  const { id: wordpressPostId, link } = await publishDraftToWordPress({
    pageType: draft.page_type,
    title,
    acfFields,
    existingPostId: draft.wordpress_post_id || undefined
  });

  const updated = await setWordpressPublishInfo(draft.id, { postId: wordpressPostId, url: link });
  res.json({ draft: updated });
}));
