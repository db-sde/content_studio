-- Backs the searchable University/Course dropdowns used on other pages' "Linked University" /
-- "Linked Course" fields. One row per approved university/course draft (specializations aren't
-- tracked here — nothing links to a specialization by name). UNIQUE(draft_id) so re-approving a
-- draft after Reopen -> edit -> re-approve updates this same row instead of duplicating it.
CREATE TABLE IF NOT EXISTS directory_entries (
  id SERIAL PRIMARY KEY,
  page_type TEXT NOT NULL CHECK (page_type IN ('university', 'course')),
  draft_id TEXT NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT iso_now(),
  UNIQUE(draft_id)
);
CREATE INDEX IF NOT EXISTS idx_directory_entries_page_type ON directory_entries(page_type, display_name);
