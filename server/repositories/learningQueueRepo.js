import { getDb } from '../db/index.js';

// Opt-in only: a row is inserted here only when an editor explicitly answers "Yes" to
// "Use this approved content to improve future generations?" after accepting a field.
export async function insertLearningQueueEntry({ pageType, fieldKey, factsJson, generatedContent, approvedContent, source, styleVersion, generationLogId, fieldRecordId }) {
  const db = await getDb();
  const { rows } = await db.query(`
    INSERT INTO learning_queue (page_type, field_key, facts_json, generated_content, approved_content, source, style_version, generation_log_id, field_record_id)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    RETURNING id
  `, [pageType, fieldKey, factsJson, generatedContent || null, approvedContent, source, styleVersion, generationLogId || null, fieldRecordId || null]);
  return rows[0].id;
}

export async function getPendingLearningQueueEntries() {
  const db = await getDb();
  const { rows } = await db.query(`
    SELECT * FROM learning_queue WHERE incorporated_at IS NULL ORDER BY created_at DESC
  `);
  return rows;
}

export async function markLearningQueueIncorporated(ids) {
  if (!ids || !ids.length) return;
  const db = await getDb();
  const placeholders = ids.map((_, i) => `$${i + 1}`).join(',');
  await db.query(`
    UPDATE learning_queue SET incorporated_at = iso_now() WHERE id IN (${placeholders})
  `, ids);
}
