// The only file that talks to the AI backend over HTTP — components call these plain
// functions rather than scattering fetch() calls through the UI.

import { getJSON, postJSON } from './httpClient.js';

// Runs the full Claude generate -> GPT evaluate -> (optional) improve -> evaluate -> return flow
// for a single field. Throws on failure — callers handle the error state themselves.
export function generateField(payload) {
  return postJSON('/api/ai/generate-field', payload);
}

// Static, pre-generate cost estimate (no API call made) — shown to the Intern before they click
// "Generate All AI Fields" so they know roughly what it'll cost.
export function getPricingEstimate(pageType) {
  return getJSON(`/api/ai/pricing-estimate?pageType=${encodeURIComponent(pageType)}`);
}

// Running actual across every draft, ever — the per-draft equivalent is draftsClient.getCostSummary.
export function getGlobalCostSummary() {
  return getJSON('/api/costs/summary');
}

// Upserts the audit/approval record for one field. Non-blocking by design: a failure here
// shouldn't interrupt the writer's flow, so callers should not await this for UI purposes.
export function syncFieldRecord(payload) {
  return postJSON('/api/field-records/sync', payload).catch(err => {
    console.warn('[aiClient] field-records sync failed (non-blocking):', err.message);
  });
}

// Opt-in only — called when an editor explicitly answers "Yes" to "Use this approved content
// to improve future generations?". Non-blocking, same reasoning as syncFieldRecord.
export function submitToLearningQueue(payload) {
  return postJSON('/api/learning-queue', payload).catch(err => {
    console.warn('[aiClient] learning-queue submit failed (non-blocking):', err.message);
  });
}
