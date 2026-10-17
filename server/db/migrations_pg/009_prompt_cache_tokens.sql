-- Prompt caching (server/ai/providers/*) bills cached input at a fraction of the normal price, so
-- input_tokens alone no longer prices a call. input_tokens now holds only the uncached part;
-- these hold the rest. NULL on rows from before caching, which the cost sums treat as 0.
--   cache_write_tokens: written to Anthropic's cache this call (billed at 1.25x input)
--   cache_read_tokens:  served from cache (Anthropic 0.1x input, OpenAI 0.5x input)
ALTER TABLE generation_logs ADD COLUMN IF NOT EXISTS cache_read_tokens INTEGER;
ALTER TABLE generation_logs ADD COLUMN IF NOT EXISTS cache_write_tokens INTEGER;
ALTER TABLE evaluation_logs ADD COLUMN IF NOT EXISTS cache_read_tokens INTEGER;
ALTER TABLE evaluation_logs ADD COLUMN IF NOT EXISTS cache_write_tokens INTEGER;
