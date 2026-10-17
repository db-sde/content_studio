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

// Token totals per model, computed in the database - the cost figures only ever need
// SUM(tokens) per model (cost is linear in tokens, see ai/pricing.js), so shipping every individual
// log row to Node just to add them up was pure waste: that row count grows with every field anyone
// ever generates, and it was re-downloaded on every poll from every open tab. Returns a handful of
// rows (one per model) however many logs exist.
export async function getGenerationUsageTotals() {
  const db = await getDb();
  const { rows } = await db.query(`
    SELECT model, COUNT(*)::int AS calls,
           COALESCE(SUM(input_tokens), 0)::float8 AS input_tokens,
           COALESCE(SUM(output_tokens), 0)::float8 AS output_tokens
    FROM generation_logs GROUP BY model
  `);
  const { rows: touched } = await db.query('SELECT COUNT(DISTINCT draft_id)::int AS n FROM generation_logs');
  return { byModel: rows, draftsTouched: touched[0].n };
}

// Same, scoped to one draft - backs GET /api/drafts/:id/cost-summary, which used to SELECT * the
// draft's logs (including every full prompt and output text) just to add up token counts.
export async function getGenerationUsageForDraft(draftId) {
  const db = await getDb();
  const { rows } = await db.query(`
    SELECT model, COUNT(*)::int AS calls,
           COALESCE(SUM(input_tokens), 0)::float8 AS input_tokens,
           COALESCE(SUM(output_tokens), 0)::float8 AS output_tokens
    FROM generation_logs WHERE draft_id = $1 GROUP BY model
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
