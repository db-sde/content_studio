-- Drafts sent by the document parser (micro app): where a draft came from, its original Word
-- document for the senior to work from, and the system account the import is credited to.

ALTER TABLE drafts ADD COLUMN IF NOT EXISTS source TEXT;
ALTER TABLE drafts ADD COLUMN IF NOT EXISTS source_ref TEXT;
ALTER TABLE drafts ADD COLUMN IF NOT EXISTS source_filename TEXT;
-- One draft per parser upload: sending the same upload again returns the existing draft.
CREATE UNIQUE INDEX IF NOT EXISTS idx_drafts_source_ref ON drafts(source, source_ref) WHERE source IS NOT NULL;

CREATE TABLE IF NOT EXISTS draft_source_documents (
  draft_id TEXT PRIMARY KEY REFERENCES drafts(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  content BYTEA NOT NULL,
  created_at TEXT NOT NULL DEFAULT iso_now()
);

-- Imports are credited to this account. It can't sign in: deactivated, and no usable password.
INSERT INTO users (name, email, password_hash, role, deactivated_at)
VALUES ('Document Parser', 'document-parser@system.degreebaba', '!', 'senior', iso_now())
ON CONFLICT (email) DO NOTHING;
