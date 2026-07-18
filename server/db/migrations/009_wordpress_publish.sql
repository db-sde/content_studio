-- Tracks the WordPress post a draft has been published as, so re-publishing (e.g. after Reopen ->
-- edit -> re-approve) updates that same post instead of creating a duplicate. Plain ADD COLUMN —
-- no CHECK constraint involved, so this doesn't need the rebuild-and-swap migrations 007/008 required.
ALTER TABLE drafts ADD COLUMN wordpress_post_id INTEGER;
ALTER TABLE drafts ADD COLUMN wordpress_url TEXT;
