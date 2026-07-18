-- Lets a Senior mark which accumulated learning_queue entries were actually folded into a new
-- style version, so the review screen can distinguish "still pending" from "already incorporated"
-- instead of the queue growing forever with no way to tell what's been acted on.
ALTER TABLE learning_queue ADD COLUMN incorporated_at TEXT;
