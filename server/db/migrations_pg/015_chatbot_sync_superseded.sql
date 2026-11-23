-- A newer publish of the same page cancels an older send still waiting (the chatbot keeps whatever
-- arrives last, so a late retry would overwrite newer content): those rows become 'superseded'.
-- Safe to re-run.
ALTER TABLE chatbot_sync_events DROP CONSTRAINT IF EXISTS chatbot_sync_events_status_check;
ALTER TABLE chatbot_sync_events ADD CONSTRAINT chatbot_sync_events_status_check
  CHECK (status IN ('queued', 'sent', 'failed', 'superseded'));
