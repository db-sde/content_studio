import { getDb } from '../db/index.js';

// Upserts the current state of one AI-assisted field on one draft. `onlyIfMissing` is used by
// the opportunistic "Save Draft" sync (writer-typed content that was never AI-touched) so it
// never clobbers a row that Generate/Accept/Reject already created.
export async function upsertFieldRecord({ draftId, pageType, fieldKey, generatedContent, approvedContent, source, status, generationLogId, onlyIfMissing }) {
  const db = await getDb();

  if (onlyIfMissing) {
    const { rows } = await db.query(`SELECT id FROM field_records WHERE draft_id = $1 AND field_key = $2`, [draftId, fieldKey]);
    if (rows[0]) return rows[0].id;
  }

  await db.query(`
    INSERT INTO field_records (draft_id, page_type, field_key, generation_log_id, generated_content, approved_content, source, status, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, iso_now())
    ON CONFLICT(draft_id, field_key) DO UPDATE SET
      generation_log_id = EXCLUDED.generation_log_id,
      generated_content = EXCLUDED.generated_content,
      approved_content = EXCLUDED.approved_content,
      source = EXCLUDED.source,
      status = EXCLUDED.status,
      updated_at = iso_now()
  `, [draftId, pageType, fieldKey, generationLogId || null, generatedContent || null, approvedContent || null, source, status]);

  // Always look the id up explicitly rather than trusting a RETURNING clause, since ON CONFLICT DO
  // UPDATE and the plain INSERT path would need separate RETURNING handling either way.
  const { rows } = await db.query(`SELECT id FROM field_records WHERE draft_id = $1 AND field_key = $2`, [draftId, fieldKey]);
  return rows[0].id;
}

export async function getFieldRecordsByDraft(draftId) {
  const db = await getDb();
  const { rows } = await db.query(`
    SELECT * FROM field_records WHERE draft_id = $1 ORDER BY field_key ASC
  `, [draftId]);
  return rows;
}
