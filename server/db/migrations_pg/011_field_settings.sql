-- The Admin's Field Settings page: per page type and field, overrides of the defaults in
-- src/config/schemas.js. NULL in a column = keep that field's default (see
-- src/config/fieldSettings.js), so "Reset to default" deletes the row.
CREATE TABLE IF NOT EXISTS field_settings (
  page_type TEXT NOT NULL,
  field_key TEXT NOT NULL,
  visible BOOLEAN,
  required BOOLEAN,
  ai_generated BOOLEAN,
  intern_fillable BOOLEAN,
  ai_instructions TEXT,
  updated_by_user_id INTEGER REFERENCES users(id),
  updated_at TEXT NOT NULL DEFAULT iso_now(),
  PRIMARY KEY (page_type, field_key)
);
