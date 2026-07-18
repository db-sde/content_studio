import { getDb } from '../db/index.js';

export async function insertGenerationLog({ draftId, pageType, fieldKey, attemptNumber, model, prompt, factsJson, styleVersion, output, inputTokens, outputTokens }) {
  const db = await getDb();
  const { rows } = await db.query(`
    INSERT INTO generation_logs (draft_id, page_type, field_key, attempt_number, model, prompt, facts_json, style_version, output, input_tokens, output_tokens)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    RETURNING id
  `, [draftId, pageType, fieldKey, attemptNumber, model, prompt, factsJson, styleVersion, output, inputTokens ?? null, outputTokens ?? null]);
  return rows[0].id;
}

export async function getGenerationLogsByDraft(draftId) {
  const db = await getDb();
  const { rows } = await db.query(`
    SELECT * FROM generation_logs WHERE draft_id = $1 ORDER BY created_at ASC
  `, [draftId]);
  return rows;
}

// Feeds the home-page "total AI cost across everything" figure — every draft, every time, not
// scoped to one draft_id like getGenerationLogsByDraft above. Polled every 12s from the home
// screen, so this selects only the columns routes/costs.js actually needs (cost math + the
// distinct-drafts-touched count) rather than `SELECT *` — the full rows carry a `prompt`/`output`
// TEXT blob per generation, which there's no reason to keep pulling off disk and across the wire
// just to throw away immediately after.
export async function getAllGenerationLogs() {
  const db = await getDb();
  const { rows } = await db.query('SELECT draft_id, model, input_tokens, output_tokens FROM generation_logs');
  return rows;
}
