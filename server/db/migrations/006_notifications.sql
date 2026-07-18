-- Intern and Senior often aren't on a call together — this is the in-app equivalent of "hey, I
-- sent this over" / "hey, I sent this back with notes," since neither role has any other way to
-- know the other has acted. `recipient_user_id` targets one person (the draft's own Intern, when
-- a Senior reverts it); `recipient_role` broadcasts to every Senior (any of whom might pick up a
-- newly-submitted draft), so exactly one of the two is set per row.
CREATE TABLE notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  draft_id TEXT NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('sent_to_senior', 'reverted_to_intern')),
  message TEXT,
  created_by_user_id INTEGER NOT NULL REFERENCES users(id),
  recipient_role TEXT CHECK (recipient_role IN ('intern', 'senior')),
  recipient_user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_notifications_recipient_role ON notifications(recipient_role);
CREATE INDEX idx_notifications_recipient_user_id ON notifications(recipient_user_id);

-- Per-user "last opened the notifications panel" timestamp — enough to compute an unread count
-- (created_at > this) without a per-notification-per-user read-state table, since a broadcast
-- notification (recipient_role) doesn't map to a single reader anyway.
ALTER TABLE users ADD COLUMN notifications_last_read_at TEXT;
