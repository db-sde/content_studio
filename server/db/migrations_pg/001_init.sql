-- Consolidated final-state schema for Postgres (Neon). This single file reproduces the end
-- result of all 9 SQLite migrations (001-009) combined — a fresh Postgres database has no
-- pre-existing rows to preserve mid-migration, so there's no value in mechanically replaying
-- SQLite's incremental history (several of those files exist only to work around SQLite's lack
-- of ALTER TABLE for widening a CHECK constraint, which Postgres does natively).

-- Every TEXT timestamp column below uses iso_now()/iso_future() rather than Postgres's native
-- TIMESTAMPTZ so the API's JSON shape doesn't change (the frontend/JS layer already treats every
-- timestamp as a plain string) and so plain string comparison (">"/"<") against iso_now() keeps
-- working exactly like SQLite's datetime('now') string comparison did.
CREATE OR REPLACE FUNCTION iso_now() RETURNS TEXT AS $$
  SELECT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
$$ LANGUAGE SQL STABLE;

CREATE OR REPLACE FUNCTION iso_future(hours_ahead INTEGER) RETURNS TEXT AS $$
  SELECT to_char((now() + (hours_ahead || ' hours')::interval) AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
$$ LANGUAGE SQL STABLE;

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('intern', 'senior', 'admin')),
  created_at TEXT NOT NULL DEFAULT iso_now(),
  deactivated_at TEXT,
  notifications_last_read_at TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT iso_now(),
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);

CREATE TABLE IF NOT EXISTS invites (
  token TEXT PRIMARY KEY,
  role TEXT NOT NULL CHECK (role IN ('intern', 'senior', 'admin')),
  invited_by_user_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT iso_now(),
  expires_at TEXT NOT NULL,
  used_at TEXT,
  used_by_user_id INTEGER REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS password_resets (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT iso_now(),
  expires_at TEXT NOT NULL,
  used_at TEXT
);

CREATE TABLE IF NOT EXISTS drafts (
  id TEXT PRIMARY KEY,
  page_type TEXT NOT NULL,
  form_data_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'intern_editing' CHECK (status IN ('intern_editing', 'generating', 'senior_review', 'admin_review', 'approved')),
  allow_intern_ai_edit INTEGER NOT NULL DEFAULT 0,
  created_by_user_id INTEGER NOT NULL REFERENCES users(id),
  prioritized_at TEXT,
  created_at TEXT NOT NULL DEFAULT iso_now(),
  updated_at TEXT NOT NULL DEFAULT iso_now(),
  wordpress_post_id INTEGER,
  wordpress_url TEXT
);
CREATE INDEX IF NOT EXISTS idx_drafts_updated_at ON drafts(updated_at);

CREATE TABLE IF NOT EXISTS editorial_style_versions (
  id SERIAL PRIMARY KEY,
  version TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'archived')),
  style_json TEXT NOT NULL,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT iso_now(),
  activated_at TEXT
);

CREATE TABLE IF NOT EXISTS generation_logs (
  id SERIAL PRIMARY KEY,
  draft_id TEXT NOT NULL,
  page_type TEXT NOT NULL,
  field_key TEXT NOT NULL,
  attempt_number INTEGER NOT NULL,
  model TEXT NOT NULL,
  prompt TEXT NOT NULL,
  facts_json TEXT NOT NULL,
  style_version TEXT NOT NULL,
  output TEXT NOT NULL,
  input_tokens INTEGER,
  output_tokens INTEGER,
  created_at TEXT NOT NULL DEFAULT iso_now()
);
CREATE INDEX IF NOT EXISTS idx_generation_logs_draft_field ON generation_logs(draft_id, field_key, attempt_number);

CREATE TABLE IF NOT EXISTS evaluation_logs (
  id SERIAL PRIMARY KEY,
  generation_log_id INTEGER NOT NULL REFERENCES generation_logs(id),
  model TEXT NOT NULL,
  scores_json TEXT NOT NULL,
  feedback TEXT,
  overall_score DOUBLE PRECISION NOT NULL,
  status TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'errored')),
  input_tokens INTEGER,
  output_tokens INTEGER,
  created_at TEXT NOT NULL DEFAULT iso_now()
);
CREATE INDEX IF NOT EXISTS idx_evaluation_logs_generation_log_id ON evaluation_logs(generation_log_id);

CREATE TABLE IF NOT EXISTS field_records (
  id SERIAL PRIMARY KEY,
  draft_id TEXT NOT NULL,
  page_type TEXT NOT NULL,
  field_key TEXT NOT NULL,
  generation_log_id INTEGER REFERENCES generation_logs(id),
  generated_content TEXT,
  approved_content TEXT,
  source TEXT NOT NULL CHECK (source IN ('writer', 'ai', 'edited')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
  updated_at TEXT NOT NULL DEFAULT iso_now(),
  UNIQUE(draft_id, field_key)
);
CREATE INDEX IF NOT EXISTS idx_field_records_status ON field_records(status);

CREATE TABLE IF NOT EXISTS learning_queue (
  id SERIAL PRIMARY KEY,
  page_type TEXT NOT NULL,
  field_key TEXT NOT NULL,
  facts_json TEXT NOT NULL,
  generated_content TEXT,
  approved_content TEXT NOT NULL,
  source TEXT NOT NULL,
  style_version TEXT NOT NULL,
  generation_log_id INTEGER REFERENCES generation_logs(id),
  field_record_id INTEGER REFERENCES field_records(id),
  incorporated_at TEXT,
  created_at TEXT NOT NULL DEFAULT iso_now()
);
CREATE INDEX IF NOT EXISTS idx_learning_queue_page_field ON learning_queue(page_type, field_key);

CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  draft_id TEXT NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('sent_to_senior', 'reverted_to_intern', 'sent_to_admin', 'reverted_to_senior')),
  message TEXT,
  created_by_user_id INTEGER NOT NULL REFERENCES users(id),
  recipient_role TEXT CHECK (recipient_role IN ('intern', 'senior', 'admin')),
  recipient_user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT iso_now()
);
CREATE INDEX IF NOT EXISTS idx_notifications_recipient_role ON notifications(recipient_role);
CREATE INDEX IF NOT EXISTS idx_notifications_recipient_user_id ON notifications(recipient_user_id);
