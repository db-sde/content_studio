-- Tracks WHO touched a draft, so the Saved Drafts list (and the draft header) can show which Intern
-- submitted a page and who last edited it - drafts.created_by_user_id alone only answers "who
-- started it", not "who sent it for review" or "who changed it last" (a Senior or Admin editing
-- during review would otherwise be invisible).
--   submitted_by_user_id   - set each time a draft is sent to the Senior (send-to-senior)
--   last_edited_by_user_id - set on every content save (manual save, autosave, AI batch generate)
ALTER TABLE drafts ADD COLUMN IF NOT EXISTS submitted_by_user_id INTEGER REFERENCES users(id);
ALTER TABLE drafts ADD COLUMN IF NOT EXISTS last_edited_by_user_id INTEGER REFERENCES users(id);

-- Existing drafts have no recorded editor - the creator is the best available answer.
UPDATE drafts SET last_edited_by_user_id = created_by_user_id WHERE last_edited_by_user_id IS NULL;
