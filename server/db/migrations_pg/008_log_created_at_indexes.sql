-- The daily AI budget check (server/ai/budget.js) runs before every AI request and sums today's
-- generation + evaluation logs; index created_at so that stays a small range scan however many
-- logs accumulate, instead of reading the whole table each time.
CREATE INDEX IF NOT EXISTS idx_generation_logs_created_at ON generation_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_evaluation_logs_created_at ON evaluation_logs(created_at);
