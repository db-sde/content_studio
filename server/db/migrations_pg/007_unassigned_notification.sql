-- The intern a draft is taken away from (reassigned to someone else, or the assignment cleared) is
-- told about it, same as the new assignee - a draft silently turning read-only with no explanation
-- is confusing. Needs its own notification type; the CHECK from 006 only allows 'assigned_to_intern'.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('sent_to_senior', 'reverted_to_intern', 'sent_to_admin', 'reverted_to_senior', 'assigned_to_intern', 'unassigned_from_intern'));
