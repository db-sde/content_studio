import { getDb } from '../db/index.js';

export async function createDraft({ id, pageType, formData, createdByUserId }) {
  const db = await getDb();
  await db.query(`
    INSERT INTO drafts (id, page_type, form_data_json, created_by_user_id)
    VALUES ($1, $2, $3, $4)
  `, [id, pageType, JSON.stringify(formData), createdByUserId]);

  return getDraftById(id);
}

export async function getDraftById(id) {
  const db = await getDb();
  const { rows } = await db.query('SELECT * FROM drafts WHERE id = $1', [id]);
  const row = rows[0];
  return row ? { ...row, form_data: JSON.parse(row.form_data_json) } : null;
}

// Summary rows for the home screen's draft list — pulls just the display-name fields out of
// form_data_json via a JSON cast + ->> rather than shipping the full payload for every row
// (that's fetched per-draft on demand via getDraftById instead). Prioritized drafts (an Admin
// bounced them back to the Senior or Intern — see setDraftPriority) sort to the very top,
// newest-prioritized first, so a returned draft can't get buried under unrelated newer ones;
// everything else falls back to the normal newest-updated-first order.
export async function listDrafts() {
  const db = await getDb();
  const { rows } = await db.query(`
    SELECT
      id, page_type, status, allow_intern_ai_edit, created_by_user_id, prioritized_at, created_at, updated_at,
      wordpress_url,
      (form_data_json::json)->>'university_name' AS university_name,
      (form_data_json::json)->>'university_full_name' AS university_full_name,
      (form_data_json::json)->>'program_name' AS program_name,
      (form_data_json::json)->>'spec_name' AS spec_name
    FROM drafts
    ORDER BY (prioritized_at IS NULL) ASC, prioritized_at DESC, updated_at DESC
  `);
  return rows;
}

// Set when an Admin sends a draft back to the Senior or Intern; cleared the moment its recipient
// advances it forward again (send-to-senior / send-to-admin) — "fixed" drops it back into normal
// chronological order rather than leaving it pinned at the top forever.
export async function setDraftPriority(id, prioritized) {
  const db = await getDb();
  await db.query(`
    UPDATE drafts SET prioritized_at = ${prioritized ? 'iso_now()' : 'NULL'} WHERE id = $1
  `, [id]);
  return getDraftById(id);
}

export async function updateDraftFormData(id, formData) {
  const db = await getDb();
  await db.query(`
    UPDATE drafts SET form_data_json = $1, updated_at = iso_now() WHERE id = $2
  `, [JSON.stringify(formData), id]);
  return getDraftById(id);
}

export async function updateDraftStatus(id, status) {
  const db = await getDb();
  await db.query(`
    UPDATE drafts SET status = $1, updated_at = iso_now() WHERE id = $2
  `, [status, id]);
  return getDraftById(id);
}

export async function setAllowInternAiEdit(id, allow) {
  const db = await getDb();
  await db.query(`
    UPDATE drafts SET allow_intern_ai_edit = $1, updated_at = iso_now() WHERE id = $2
  `, [allow ? 1 : 0, id]);
  return getDraftById(id);
}

// Recorded after a successful publish so a later re-publish (Reopen -> edit -> re-approve) updates
// this same WordPress post via PUT instead of the wordpressClient creating a duplicate.
export async function setWordpressPublishInfo(id, { postId, url }) {
  const db = await getDb();
  await db.query(`
    UPDATE drafts SET wordpress_post_id = $1, wordpress_url = $2 WHERE id = $3
  `, [postId, url, id]);
  return getDraftById(id);
}

export async function deleteDraft(id) {
  const db = await getDb();
  await db.query('DELETE FROM drafts WHERE id = $1', [id]);
}
