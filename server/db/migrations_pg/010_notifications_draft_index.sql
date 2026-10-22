-- A draft's full remarks history (GET /api/drafts/:id/remarks) reads every note left on that draft;
-- index by draft so it stays a small lookup however many notifications accumulate.
CREATE INDEX IF NOT EXISTS idx_notifications_draft_id ON notifications(draft_id);
