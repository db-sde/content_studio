-- Two roles only (intern, senior). Accounts are created via invite links only — no self-signup.
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('intern','senior')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  deactivated_at TEXT
);

-- Opaque session tokens carried in an httpOnly cookie. No express-session — hand-rolled to
-- avoid an extra dependency, consistent with the rest of this codebase.
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);

-- One-time invite links. `role` is fixed by the inviter at creation time, never self-picked by
-- the invitee. An intern may only create role='intern' invites (enforced in the route, not here).
CREATE TABLE IF NOT EXISTS invites (
  token TEXT PRIMARY KEY,
  role TEXT NOT NULL CHECK (role IN ('intern','senior')),
  invited_by_user_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  used_at TEXT,
  used_by_user_id INTEGER REFERENCES users(id)
);

-- Same one-time-link mechanism as invites, for resetting an existing account's password.
CREATE TABLE IF NOT EXISTS password_resets (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  used_at TEXT
);
