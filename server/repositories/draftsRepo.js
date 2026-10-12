import { getDb } from '../db/index.js';

export async function createDraft({ id, pageType, formData, createdByUserId }) {
  const db = await getDb();
  await db.query(`
    INSERT INTO drafts (id, page_type, form_data_json, created_by_user_id, last_edited_by_user_id)
    VALUES ($1, $2, $3, $4, $4)
  `, [id, pageType, JSON.stringify(formData), createdByUserId]);

  return getDraftById(id);
}

export async function getDraftById(id) {
  const db = await getDb();
  const { rows } = await db.query('SELECT * FROM drafts WHERE id = $1', [id]);
  const row = rows[0];
  return row ? { ...row, form_data: JSON.parse(row.form_data_json) } : null;
}

// Normalizes a name for duplicate matching: lowercase, drops filler words that vary between how
// two people type the same thing ("Online MCA in Cloud & DevOps" vs "MCA in Cloud & DevOps",
// "Sharda University Online" vs "Sharda University"), strips punctuation, collapses whitespace.
// Built from POSIX classes ([[:<:]] word boundary, [^a-z0-9]) rather than \s/\b because this ends
// up inside a JS template literal, where an unrecognized backslash escape is silently dropped.
const norm = (col) => `btrim(regexp_replace(regexp_replace(lower(coalesce(${col}, '')), '[[:<:]](online|university|univ|in|and|of|the)[[:>:]]', ' ', 'g'), '[^a-z0-9]+', ' ', 'g'))`;

// Summary rows for the home screen's draft list — pulls just the display-name fields out of
// form_data_json via a JSON cast + ->> rather than shipping the full payload for every row
// (that's fetched per-draft on demand via getDraftById instead). Prioritized drafts (an Admin
// bounced them back to the Senior or Intern — see setDraftPriority) sort to the very top,
// newest-prioritized first, so a returned draft can't get buried under unrelated newer ones;
// everything else falls back to the normal newest-updated-first order.
//
// Also carries, per row:
//   - who created / last edited / submitted the draft, and who currently OWNS it (owner_*: the
//     assigned Intern if a Senior/Admin assigned one, otherwise the creator), as names via users
//     joins - so the list can show which Intern a specialization belongs to without a second
//     round-trip per row;
//   - dup_rank / dup_total: duplicate detection. Two drafts are the same entry when they share
//     page type + university + title (case, punctuation and filler words like "Online" ignored). dup_rank 1 is the earliest
//     ("original"), anything higher is a repeat; dup_total is how many drafts share that key.
//     Both are NULL for a draft with no title yet - an unnamed draft can't be a duplicate of
//     anything, and shouldn't make every other unnamed draft look like one.
export async function listDrafts() {
  const db = await getDb();
  const { rows } = await db.query(`
    WITH base AS (
      SELECT
        id, page_type, status, allow_intern_ai_edit, created_by_user_id, prioritized_at, created_at, updated_at,
        wordpress_url, submitted_by_user_id, last_edited_by_user_id, assigned_to_user_id,
        (form_data_json::json)->>'university_name' AS university_name,
        (form_data_json::json)->>'university_full_name' AS university_full_name,
        (form_data_json::json)->>'program_name' AS program_name,
        (form_data_json::json)->>'spec_name' AS spec_name
      FROM drafts
    ),
    keyed AS (
      SELECT
        base.*,
        CASE
          WHEN page_type = 'specialization' AND ${norm('spec_name')} <> '' THEN
            page_type || '|' || ${norm('university_name')} || '|' || ${norm('spec_name')}
          WHEN page_type = 'course' AND ${norm('program_name')} <> '' THEN
            page_type || '|' || ${norm('university_name')} || '|' || ${norm('program_name')}
          WHEN page_type = 'university' AND ${norm('university_name')} <> '' THEN
            page_type || '|' || ${norm('university_name')}
          ELSE NULL
        END AS dup_key
      FROM base
    )
    SELECT
      keyed.id, keyed.page_type, keyed.status, keyed.allow_intern_ai_edit, keyed.created_by_user_id,
      keyed.prioritized_at, keyed.created_at, keyed.updated_at, keyed.wordpress_url,
      keyed.submitted_by_user_id, keyed.last_edited_by_user_id, keyed.assigned_to_user_id,
      COALESCE(keyed.assigned_to_user_id, keyed.created_by_user_id) AS owner_user_id,
      owner.name AS owner_name,
      keyed.university_name, keyed.university_full_name, keyed.program_name, keyed.spec_name,
      creator.name AS created_by_name,
      editor.name AS last_edited_by_name,
      submitter.name AS submitted_by_name,
      CASE WHEN keyed.dup_key IS NULL THEN NULL
           ELSE (ROW_NUMBER() OVER (PARTITION BY keyed.dup_key ORDER BY keyed.created_at ASC, keyed.id ASC))::int END AS dup_rank,
      CASE WHEN keyed.dup_key IS NULL THEN NULL
           ELSE (COUNT(*) OVER (PARTITION BY keyed.dup_key))::int END AS dup_total
    FROM keyed
    JOIN users creator ON creator.id = keyed.created_by_user_id
    JOIN users owner ON owner.id = COALESCE(keyed.assigned_to_user_id, keyed.created_by_user_id)
    LEFT JOIN users editor ON editor.id = keyed.last_edited_by_user_id
    LEFT JOIN users submitter ON submitter.id = keyed.submitted_by_user_id
    ORDER BY (keyed.prioritized_at IS NULL) ASC, keyed.prioritized_at DESC, keyed.updated_at DESC
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

// `editedByUserId` records who made this change (see 005_draft_authorship.sql) - optional so a
// caller with no meaningful human author doesn't clobber the previous editor with null.
export async function updateDraftFormData(id, formData, editedByUserId) {
  const db = await getDb();
  if (editedByUserId) {
    await db.query(`
      UPDATE drafts SET form_data_json = $1, updated_at = iso_now(), last_edited_by_user_id = $3 WHERE id = $2
    `, [JSON.stringify(formData), id, editedByUserId]);
  } else {
    await db.query(`
      UPDATE drafts SET form_data_json = $1, updated_at = iso_now() WHERE id = $2
    `, [JSON.stringify(formData), id]);
  }
  return getDraftById(id);
}

// The one person who currently owns a draft: whoever a Senior/Admin assigned it to, or - if it was
// never assigned - whoever created it. Interns may only edit drafts they own, and a revert-to-intern
// is addressed to this person. Single definition shared by every route that needs it.
export function getDraftOwnerId(draft) {
  return draft.assigned_to_user_id ?? draft.created_by_user_id;
}

// Hands a draft to an Intern (or, with null, clears the assignment so it falls back to its creator).
export async function setDraftAssignee(id, userId) {
  const db = await getDb();
  await db.query('UPDATE drafts SET assigned_to_user_id = $1 WHERE id = $2', [userId, id]);
  return getDraftById(id);
}

// Who most recently sent this draft to the Senior - shown in the Saved Drafts list as the Intern
// who "submitted" it, distinct from who merely created it or last touched it.
export async function setDraftSubmittedBy(id, userId) {
  const db = await getDb();
  await db.query('UPDATE drafts SET submitted_by_user_id = $1 WHERE id = $2', [userId, id]);
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
