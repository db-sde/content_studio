-- Lets a Senior or Admin hand a draft to a specific Intern.
--
-- Until now a draft's "owner" was simply whoever created it (drafts.created_by_user_id). Assignment
-- adds a separate pointer, leaving created_by_user_id untouched as the permanent record of who
-- started the draft. The effective owner is COALESCE(assigned_to_user_id, created_by_user_id): NULL
-- here means "never assigned", so every existing draft keeps its current owner with no backfill.
ALTER TABLE drafts ADD COLUMN IF NOT EXISTS assigned_to_user_id INTEGER REFERENCES users(id);

-- The assignee gets a notification (bell + pop-up) like every other hand-off, which needs its own
-- type - the original CHECK only allows the four forward/backward review hand-offs.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('sent_to_senior', 'reverted_to_intern', 'sent_to_admin', 'reverted_to_senior', 'assigned_to_intern'));
