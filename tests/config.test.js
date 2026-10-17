// Limits fall back to safe defaults when their env var is missing or garbage - a typo must never
// turn a limit into NaN (which would make every "is it over the limit?" comparison false).
import './helpers/env.js';
process.env.API_REQUESTS_PER_5_MIN = 'not-a-number';
process.env.AI_DAILY_BUDGET_USD = '';
const { test } = await import('node:test');
const assert = (await import('node:assert/strict')).default;
const { config } = await import('../server/config.js');
const pgPool = await import('../server/db/pgPool.js');

test('garbage or empty limit env vars fall back to the defaults', () => {
  assert.equal(config.limits.apiRequestsPer5Min, 600);
  assert.equal(config.limits.aiDailyBudgetUsd, 15);
});

test('every limit is a positive finite number by default', () => {
  for (const [key, value] of Object.entries(config.limits)) {
    assert.ok(Number.isFinite(value) && value > 0, `${key} = ${value}`);
  }
});

test('the real database pool is created with the statement and connect timeouts', () => {
  pgPool.__setPoolForTests(null);
  const pool = pgPool.getPool(); // no connection is made until a query runs
  assert.equal(pool.options.statement_timeout, config.limits.dbStatementTimeoutMs);
  assert.equal(pool.options.connectionTimeoutMillis, config.limits.dbConnectTimeoutMs);
  pool.end();
});
