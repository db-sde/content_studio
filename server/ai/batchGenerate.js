import { generateAndEvaluateField } from './orchestrator.js';
import { upsertFieldRecord } from '../repositories/fieldRecordsRepo.js';
import { isRichTextEmpty } from '../../src/config/schemas.js';

const CONCURRENCY = 3;

// Runs a small hand-rolled concurrency-limited pool over `items`, calling `worker` for each —
// no queue library needed for a batch this size (at most ~10 aiAssist fields per page type).
async function runWithConcurrencyLimit(items, worker, limit) {
  const results = new Array(items.length);
  let next = 0;

  async function runNext() {
    const i = next++;
    if (i >= items.length) return;
    results[i] = await worker(items[i], i);
    await runNext();
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runNext));
  return results;
}

// One batch entry point behind both the initial "Generate All AI Fields" (onlyEmpty: false) and
// the post-revert "Generate Empty Fields" (onlyEmpty: true) actions. `fields` and `currentValues`
// are client-supplied (schemas.js is the frontend's single source of truth for field metadata —
// see Phase 4 plan note) — this only orchestrates calls to the existing per-field pipeline.
export async function generateAllAiFields({ draftId, pageType, fields, facts, currentValues, onlyEmpty }) {
  // Shared with the frontend's own emptiness check (schemas.js) rather than a separate exact-match
  // — degrades gracefully to a plain trim-check for non-rich-text fields, and catches blank rich
  // text serializations an exact '<p></p>' match would miss (e.g. multiple empty paragraphs).
  const toGenerate = fields.filter(f => {
    if (!onlyEmpty) return true;
    return isRichTextEmpty(currentValues[f.fieldKey]);
  });

  // Each field's failure is caught individually rather than left to reject the pool's Promise.all
  // — a single transient timeout used to abort the entire batch and discard every other field's
  // already-generated (already-billed) content. Now a failed field is reported separately and the
  // rest of the batch's results still get merged into the draft.
  const results = await runWithConcurrencyLimit(toGenerate, async (field) => {
    try {
      const result = await generateAndEvaluateField({
        draftId, pageType,
        fieldKey: field.fieldKey,
        fieldLabel: field.fieldLabel,
        fieldInstructions: field.fieldInstructions,
        outputFormat: field.outputFormat,
        facts,
        mode: 'generate'
      });

      const generationLogId = result.generationLogIds[result.generationLogIds.length - 1] || null;
      await upsertFieldRecord({
        draftId, pageType, fieldKey: field.fieldKey,
        generatedContent: result.content, approvedContent: null,
        source: 'ai', status: 'pending', generationLogId
      });

      return { fieldKey: field.fieldKey, content: result.content, ok: true };
    } catch (e) {
      return { fieldKey: field.fieldKey, ok: false, error: e.message || 'Generation failed' };
    }
  }, CONCURRENCY);

  const values = {};
  const failures = [];
  results.forEach(r => {
    if (r.ok) values[r.fieldKey] = r.content;
    else failures.push({ fieldKey: r.fieldKey, error: r.error });
  });
  return { values, failures };
}
