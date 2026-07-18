import pg from 'pg';
import { config } from '../config.js';

const { Pool } = pg;
let pool = null;

// Neon (and most hosted Postgres) requires TLS; a local Postgres used for dev/testing typically
// doesn't have a cert configured at all, so only enable TLS when the host isn't local. Neon's
// pooler cert doesn't chain to a locally-trusted root in every environment, hence
// rejectUnauthorized: false rather than a strict verify — this matches Neon's own connection
// examples, not a general weakening of TLS elsewhere in this app.
function sslConfigFor(connectionString) {
  const isLocal = /(^|@)(localhost|127\.0\.0\.1)/.test(connectionString);
  return isLocal ? false : { rejectUnauthorized: false };
}

export function getPool() {
  if (pool) return pool;

  if (!config.databaseUrl) {
    throw new Error('DATABASE_URL is not set. Add your Neon connection string to content_studio/.env (see .env.example) — the server cannot start without it.');
  }

  pool = new Pool({
    connectionString: config.databaseUrl,
    ssl: sslConfigFor(config.databaseUrl)
  });

  // node-postgres emits 'error' on the pool whenever an *idle* client hits a backend-side
  // connection error — and Neon actively terminates idle connections as part of its
  // serverless/auto-suspend model, so this isn't a rare edge case here. With no listener,
  // that 'error' event is unhandled and crashes the entire process (not just one request) —
  // logging it lets the pool silently drop the dead client and reconnect on the next query.
  pool.on('error', (err) => {
    console.error('[db] idle client error (pool will recover on next query):', err.message);
  });

  return pool;
}

// Runs `fn` against a single checked-out client wrapped in BEGIN/COMMIT/ROLLBACK — needed
// whenever multiple statements must be atomic (e.g. archiving the old active style version and
// activating the new one in the same transaction). A bare pool.query() per statement does not
// guarantee the same underlying connection, so it can't be used for multi-statement atomicity.
export async function withTransaction(fn) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
