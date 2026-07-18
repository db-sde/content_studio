import { getDb } from '../db/index.js';

// Upserted whenever an Admin approves a university/course draft (see routes/drafts.js's
// 'approve' STATUS_ACTIONS handler) — this is what backs the searchable Linked University/Linked
// Course dropdowns on other pages. Keyed by draft_id so a later re-approval (Reopen -> edit ->
// re-approve) updates this same row rather than creating a duplicate with a stale display_name.
// `secondaryLabel` is only ever set for course entries (that course's own university_name) —
// letting the frontend disambiguate courses that share a name across different universities
// (e.g. two different universities both approved as "MBA in Finance") and scope the Linked
// Course dropdown to whichever university a draft's Linked University field currently names.
export async function upsertDirectoryEntry({ draftId, pageType, displayName, secondaryLabel }) {
  const db = await getDb();
  await db.query(`
    INSERT INTO directory_entries (draft_id, page_type, display_name, secondary_label, updated_at)
    VALUES ($1, $2, $3, $4, iso_now())
    ON CONFLICT (draft_id) DO UPDATE SET
      page_type = EXCLUDED.page_type,
      display_name = EXCLUDED.display_name,
      secondary_label = EXCLUDED.secondary_label,
      updated_at = iso_now()
  `, [draftId, pageType, displayName, secondaryLabel || null]);
}

// Sorted case-insensitively so "NMIMS" and "amity" interleave the way a human expects rather
// than every uppercase name sorting before every lowercase one.
export async function listDirectoryEntries(pageType) {
  const db = await getDb();
  const { rows } = await db.query(`
    SELECT draft_id, display_name, secondary_label FROM directory_entries
    WHERE page_type = $1
    ORDER BY LOWER(display_name) ASC
  `, [pageType]);
  return rows;
}
