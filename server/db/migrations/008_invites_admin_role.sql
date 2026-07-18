-- Missed in 007: invites.role also needs 'admin' widened into its CHECK constraint, since an
-- Admin invite is now a real thing an Admin can generate for another Admin.
CREATE TABLE invites_new (
  token TEXT PRIMARY KEY,
  role TEXT NOT NULL CHECK (role IN ('intern', 'senior', 'admin')),
  invited_by_user_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  used_at TEXT,
  used_by_user_id INTEGER REFERENCES users(id)
);
INSERT INTO invites_new (token, role, invited_by_user_id, created_at, expires_at, used_at, used_by_user_id)
  SELECT token, role, invited_by_user_id, created_at, expires_at, used_at, used_by_user_id FROM invites;
DROP TABLE invites;
ALTER TABLE invites_new RENAME TO invites;
