-- Fields an Admin added on the Field Settings page. Each fills the WordPress ACF field of the same
-- name (field_key), picked from the live site's own list. Removing one archives it (archived_at):
-- what drafts hold in it is kept, and it can be restored. Its Visible / Mandatory / AI / Who-fills
-- settings live in field_settings like any other field's.
CREATE TABLE IF NOT EXISTS custom_fields (
  page_type TEXT NOT NULL,
  field_key TEXT NOT NULL,
  label TEXT NOT NULL,
  field_type TEXT NOT NULL CHECK (field_type IN ('TEXT_INPUT', 'TEXTAREA', 'RICH_TEXT', 'REPEATER')),
  section_id TEXT NOT NULL,
  after_field_key TEXT,
  placeholder TEXT,
  subfields_json TEXT,
  archived_at TEXT,
  created_by_user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT iso_now(),
  updated_by_user_id INTEGER REFERENCES users(id),
  updated_at TEXT NOT NULL DEFAULT iso_now(),
  PRIMARY KEY (page_type, field_key)
);
