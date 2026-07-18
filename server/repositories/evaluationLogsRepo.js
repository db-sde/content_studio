import { getDb } from '../db/index.js';

export async function insertEvaluationLog({ generationLogId, model, scoresJson, feedback, overallScore, status, inputTokens, outputTokens }) {
  const db = await getDb();
  const { rows } = await db.query(`
    INSERT INTO evaluation_logs (generation_log_id, model, scores_json, feedback, overall_score, status, input_tokens, output_tokens)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING id
  `, [generationLogId, model, scoresJson, feedback || null, overallScore, status, inputTokens ?? null, outputTokens ?? null]);
  return rows[0].id;
}

export async function getEvaluationLogsByDraft(draftId) {
  const db = await getDb();
  const { rows } = await db.query(`
    SELECT evaluation_logs.*
    FROM evaluation_logs
    JOIN generation_logs ON generation_logs.id = evaluation_logs.generation_log_id
    WHERE generation_logs.draft_id = $1
    ORDER BY evaluation_logs.created_at ASC
  `, [draftId]);
  return rows;
}

// See getAllGenerationLogs — same "every draft, every time" scope for the home-page total, and
// the same reason to select only the cost-relevant columns instead of `SELECT *` (full rows here
// carry a `feedback`/`scores_json` blob per evaluation).
export async function getAllEvaluationLogs() {
  const db = await getDb();
  const { rows } = await db.query('SELECT model, input_tokens, output_tokens FROM evaluation_logs');
  return rows;
}
