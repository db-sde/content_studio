-- Editorial Style Engine: versioned, structured editorial-voice profile.
-- Exactly one row is expected to have status='active' at any time.
CREATE TABLE IF NOT EXISTS editorial_style_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  version TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','archived')),
  style_json TEXT NOT NULL,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  activated_at TEXT
);

-- Every Claude generation attempt (initial or improve pass), for audit + future learning.
CREATE TABLE IF NOT EXISTS generation_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  draft_id TEXT NOT NULL,
  page_type TEXT NOT NULL,
  field_key TEXT NOT NULL,
  attempt_number INTEGER NOT NULL,
  model TEXT NOT NULL,
  prompt TEXT NOT NULL,
  facts_json TEXT NOT NULL,
  style_version TEXT NOT NULL,
  output TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_generation_logs_draft_field ON generation_logs(draft_id, field_key, attempt_number);

-- Every GPT evaluation of a generation attempt.
CREATE TABLE IF NOT EXISTS evaluation_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  generation_log_id INTEGER NOT NULL REFERENCES generation_logs(id),
  model TEXT NOT NULL,
  scores_json TEXT NOT NULL,
  feedback TEXT,
  overall_score REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok','errored')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_evaluation_logs_generation_log_id ON evaluation_logs(generation_log_id);

-- Current state of every AI-assisted field on every draft: what was generated, what was
-- approved, and where the approved content actually came from.
CREATE TABLE IF NOT EXISTS field_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  draft_id TEXT NOT NULL,
  page_type TEXT NOT NULL,
  field_key TEXT NOT NULL,
  generation_log_id INTEGER REFERENCES generation_logs(id),
  generated_content TEXT,
  approved_content TEXT,
  source TEXT NOT NULL CHECK (source IN ('writer','ai','edited')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','rejected')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(draft_id, field_key)
);
CREATE INDEX IF NOT EXISTS idx_field_records_status ON field_records(status);

-- Opt-in examples an editor has flagged as "use this to improve future generations".
-- Feeds the (deferred) Style Evolution offline analysis workflow.
CREATE TABLE IF NOT EXISTS learning_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  page_type TEXT NOT NULL,
  field_key TEXT NOT NULL,
  facts_json TEXT NOT NULL,
  generated_content TEXT,
  approved_content TEXT NOT NULL,
  source TEXT NOT NULL,
  style_version TEXT NOT NULL,
  generation_log_id INTEGER REFERENCES generation_logs(id),
  field_record_id INTEGER REFERENCES field_records(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_learning_queue_page_field ON learning_queue(page_type, field_key);
