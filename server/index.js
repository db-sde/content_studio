import { config } from './config.js';
import { getDb } from './db/index.js';
import { createApp } from './app.js';

// Boot sequence: open DB (which runs migrations) before starting the HTTP server, so the
// server never accepts a request against a not-yet-migrated database. Now async (Postgres/Neon)
// — the server must not call app.listen() until this resolves.
try {
  await getDb();
} catch (e) {
  console.error(`[server] failed to connect to the database: ${e.message}`);
  process.exit(1);
}

const app = createApp()

app.listen(config.port, () => {
  console.log(`[server] listening on http://localhost:${config.port}`);
  if (!config.anthropicApiKey) console.warn('[server] ANTHROPIC_API_KEY not set — AI generation routes will fail until content_studio/.env is configured.');
  if (!config.openaiApiKey) console.warn('[server] OPENAI_API_KEY not set — AI evaluation routes will fail until content_studio/.env is configured.');
});
