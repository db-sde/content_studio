-- Captures per-call token usage so real ₹/$ cost can be computed instead of only estimated.
ALTER TABLE generation_logs ADD COLUMN input_tokens INTEGER;
ALTER TABLE generation_logs ADD COLUMN output_tokens INTEGER;
ALTER TABLE evaluation_logs ADD COLUMN input_tokens INTEGER;
ALTER TABLE evaluation_logs ADD COLUMN output_tokens INTEGER;
