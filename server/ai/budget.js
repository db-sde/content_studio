import { getDb } from '../db/index.js';
import { config } from '../config.js';
import { computeCostUsdForUsage } from './pricing.js';
import { asyncRoute } from '../middleware/errorHandler.js';

// Daily AI spending cap. The Anthropic balance once ran out in the middle of interns' work with
// nothing in the app warning anyone first - this makes the ceiling explicit, visible, and enforced
// before any new Claude/GPT call is made.

// UTC midnight as the app's own timestamp format (see iso_now() in 001_init.sql) - TEXT
// timestamps compare correctly as strings in that format.
export function startOfUtcDay(now = new Date()) {
  return `${now.toISOString().slice(0, 10)}T00:00:00Z`;
}

// Summed per model in SQL (indexed on created_at - migration 008), so this is a handful of rows
// however many calls were made today.
export async function getTodaysAiSpendUsd() {
  const db = await getDb();
  const since = startOfUtcDay();
  const { rows } = await db.query(`
    SELECT model, COALESCE(SUM(input_tokens), 0)::float8 AS input_tokens, COALESCE(SUM(output_tokens), 0)::float8 AS output_tokens,
           COALESCE(SUM(cache_read_tokens), 0)::float8 AS cache_read_tokens, COALESCE(SUM(cache_write_tokens), 0)::float8 AS cache_write_tokens
    FROM generation_logs WHERE created_at >= $1 GROUP BY model
    UNION ALL
    SELECT model, COALESCE(SUM(input_tokens), 0)::float8 AS input_tokens, COALESCE(SUM(output_tokens), 0)::float8 AS output_tokens,
           COALESCE(SUM(cache_read_tokens), 0)::float8 AS cache_read_tokens, COALESCE(SUM(cache_write_tokens), 0)::float8 AS cache_write_tokens
    FROM evaluation_logs WHERE created_at >= $1 GROUP BY model
  `, [since]);
  return computeCostUsdForUsage(rows);
}

export async function getAiBudgetStatus() {
  const budgetUsd = config.limits.aiDailyBudgetUsd;
  const spentUsd = await getTodaysAiSpendUsd();
  return { spentUsd, budgetUsd, capped: budgetUsd > 0, exceeded: budgetUsd > 0 && spentUsd >= budgetUsd };
}

// Route middleware - mounted in front of every route that calls Claude/GPT (see
// tests/static-guards.test.js, which fails if a new AI route forgets it).
export const requireAiBudget = asyncRoute(async (req, res, next) => {
  const status = await getAiBudgetStatus();
  if (status.exceeded) {
    const err = new Error(
      `Today's AI spending limit of $${status.budgetUsd.toFixed(2)} has been reached ($${status.spentUsd.toFixed(2)} used). ` +
      'It resets at midnight UTC (5:30 AM IST). An admin can raise AI_DAILY_BUDGET_USD on the server if more is needed today.'
    );
    err.status = 429;
    throw err;
  }
  next();
});
