-- Adds the third role: Admin sits above Senior in the review chain (Intern -> Senior -> Admin),
-- has every permission Senior has, and is the one who approves + publishes to WordPress. SQLite
-- has no ALTER TABLE for widening a CHECK constraint, so this is the standard rebuild-and-swap —
-- migrate.js toggles foreign_keys off around the whole migration batch for exactly this reason.

CREATE TABLE users_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('intern', 'senior', 'admin')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  deactivated_at TEXT,
  notifications_last_read_at TEXT
);
INSERT INTO users_new (id, name, email, password_hash, role, created_at, deactivated_at, notifications_last_read_at)
  SELECT id, name, email, password_hash, role, created_at, deactivated_at, notifications_last_read_at FROM users;
DROP TABLE users;
ALTER TABLE users_new RENAME TO users;

-- 'admin_review' is the new stage between senior_review and approved. `prioritized_at` is set
-- when an Admin sends a draft back to the Senior or Intern — the home screen's draft list sorts
-- on this first so a bounced-back draft doesn't get lost among newer, unrelated ones; cleared the
-- moment its recipient advances it forward again (see draftsRepo.js).
CREATE TABLE drafts_new (
  id TEXT PRIMARY KEY,
  page_type TEXT NOT NULL,
  form_data_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'intern_editing' CHECK (status IN ('intern_editing', 'generating', 'senior_review', 'admin_review', 'approved')),
  allow_intern_ai_edit INTEGER NOT NULL DEFAULT 0,
  created_by_user_id INTEGER NOT NULL REFERENCES users(id),
  prioritized_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO drafts_new (id, page_type, form_data_json, status, allow_intern_ai_edit, created_by_user_id, created_at, updated_at)
  SELECT id, page_type, form_data_json, status, allow_intern_ai_edit, created_by_user_id, created_at, updated_at FROM drafts;
DROP TABLE drafts;
ALTER TABLE drafts_new RENAME TO drafts;
CREATE INDEX idx_drafts_updated_at ON drafts(updated_at);

-- Widens notification types for the two new admin-facing transitions (sent-to-admin broadcasts
-- to the admin role same as sent-to-senior does to seniors; reverted-to-senior targets whichever
-- senior role is currently handling review, same broadcast model as everything else here).
CREATE TABLE notifications_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  draft_id TEXT NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('sent_to_senior', 'reverted_to_intern', 'sent_to_admin', 'reverted_to_senior')),
  message TEXT,
  created_by_user_id INTEGER NOT NULL REFERENCES users(id),
  recipient_role TEXT CHECK (recipient_role IN ('intern', 'senior', 'admin')),
  recipient_user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO notifications_new (id, draft_id, type, message, created_by_user_id, recipient_role, recipient_user_id, created_at)
  SELECT id, draft_id, type, message, created_by_user_id, recipient_role, recipient_user_id, created_at FROM notifications;
DROP TABLE notifications;
ALTER TABLE notifications_new RENAME TO notifications;
CREATE INDEX idx_notifications_recipient_role ON notifications(recipient_role);
CREATE INDEX idx_notifications_recipient_user_id ON notifications(recipient_user_id);
