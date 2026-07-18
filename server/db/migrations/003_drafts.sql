-- Canonical, server-side store for draft form data — replaces localStorage-only persistence so
-- an Intern and a Senior (possibly different logins/machines) see the same shared draft state.
-- `id` reuses the existing frontend-generated `draft_<timestamp>` string format.
CREATE TABLE IF NOT EXISTS drafts (
  id TEXT PRIMARY KEY,
  page_type TEXT NOT NULL,
  form_data_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'intern_editing' CHECK (status IN ('intern_editing','generating','senior_review','approved')),
  allow_intern_ai_edit INTEGER NOT NULL DEFAULT 0,
  created_by_user_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_drafts_updated_at ON drafts(updated_at);
