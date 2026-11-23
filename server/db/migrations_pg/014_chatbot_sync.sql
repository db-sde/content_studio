-- Pages Content Studio publishes, queued for the DegreeBaba chatbot's catalog (see
-- server/integrations/chatbotSync.js). Each row is one event, stored with the exact request body so
-- a retry sends the same bytes, event ID and version. Additive and safe to re-run.
CREATE TABLE IF NOT EXISTS chatbot_sync_events (
  id SERIAL PRIMARY KEY,
  event_id TEXT NOT NULL UNIQUE,
  draft_id TEXT,
  page_type TEXT NOT NULL,
  wp_site TEXT NOT NULL,
  wp_post_id TEXT NOT NULL,
  version BIGINT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  next_attempt_at TEXT NOT NULL DEFAULT iso_now(),
  created_at TEXT NOT NULL DEFAULT iso_now(),
  updated_at TEXT NOT NULL DEFAULT iso_now()
);
CREATE INDEX IF NOT EXISTS idx_chatbot_sync_due ON chatbot_sync_events(status, next_attempt_at, id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_chatbot_sync_post_version ON chatbot_sync_events(wp_site, page_type, wp_post_id, version);
