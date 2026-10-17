// Imported right after env.js by tests/limits.test.js: tiny limits so each one can be hit in a
// test without thousands of requests.
process.env.AI_DAILY_BUDGET_USD = '0.05';
process.env.IMAGE_GENERATIONS_PER_HOUR = '3';
process.env.API_REQUESTS_PER_5_MIN = '40';
process.env.LOGIN_FAILURES_PER_15_MIN = '3';
process.env.IMAGE_PIPELINE_TIMEOUT_MS = '400';
