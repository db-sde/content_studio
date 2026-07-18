// One-time data migration: copies every row out of the old local SQLite file (server/data/
// content_studio.sqlite by default) into the Neon/Postgres database named by DATABASE_URL.
// Run manually, once, after DATABASE_URL is set in .env:
//
//   node server/db/migrateSqliteToPostgres.js
//
// Safe to re-run only against an EMPTY Postgres database — every table has a primary key, so a
// second run against a database that already has this data will fail loudly on a duplicate key
// rather than silently double-inserting. Test against a scratch/throwaway Neon branch first if
// you want to dry-run this before pointing it at the database you'll actually keep using.
import Database from 'better-sqlite3';
import { getPool } from './pgPool.js';
import { runMigrations } from './migrate.js';

const SQLITE_PATH = process.env.SQLITE_PATH || 'server/data/content_studio.sqlite';

// SQLite's datetime('now') produces "YYYY-MM-DD HH:MM:SS" (UTC, space-separated, no zone). This
// app's Postgres schema instead formats every TEXT timestamp as "YYYY-MM-DDTHH:MM:SSZ" (see
// iso_now() in migrations_pg/001_init.sql) and relies on plain string comparison between that
// format and expires_at/created_at columns — mixing the two formats in one column would silently
// break those comparisons (a space sorts before 'T', so an un-converted old row's expiry could
// compare as "already expired" or "not yet expired" incorrectly). Every *_at column gets
// normalized to the new format on the way in.
const SQLITE_DATETIME_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
function toIsoZ(value) {
  if (typeof value !== 'string' || !SQLITE_DATETIME_RE.test(value)) return value;
  return value.replace(' ', 'T') + 'Z';
}

function normalizeRow(row) {
  const out = {};
  for (const [key, value] of Object.entries(row)) {
    out[key] = key.endsWith('_at') ? toIsoZ(value) : value;
  }
  return out;
}

async function copyTable(sqliteDb, pgPool, tableName, { resetSerial = true } = {}) {
  const rows = sqliteDb.prepare(`SELECT * FROM ${tableName}`).all();
  if (!rows.length) {
    console.log(`[migrate-data] ${tableName}: 0 rows, skipping`);
    return 0;
  }

  const columns = Object.keys(rows[0]);
  const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
  const insertSql = `INSERT INTO ${tableName} (${columns.join(', ')}) VALUES (${placeholders})`;

  for (const rawRow of rows) {
    const row = normalizeRow(rawRow);
    await pgPool.query(insertSql, columns.map(c => row[c]));
  }

  if (resetSerial) {
    // Explicit ids were just inserted into a SERIAL column, so its sequence hasn't advanced —
    // without this, the next app-generated INSERT would collide with a migrated row's id.
    await pgPool.query(
      `SELECT setval(pg_get_serial_sequence($1, 'id'), (SELECT COALESCE(MAX(id), 0) FROM ${tableName}) + 1, false)`,
      [tableName]
    );
  }

  console.log(`[migrate-data] ${tableName}: copied ${rows.length} row(s)`);
  return rows.length;
}

async function main() {
  const sqliteDb = new Database(SQLITE_PATH, { readonly: true, fileMustExist: true });
  const pgPool = getPool();

  console.log(`[migrate-data] source: ${SQLITE_PATH}`);
  console.log('[migrate-data] ensuring target schema exists...');
  await runMigrations(pgPool);

  // Dependency order: every REFERENCES target must be populated before the table that points at
  // it (evaluation_logs/field_records/learning_queue all reference generation_logs; notifications
  // references both drafts and users).
  const TABLES = [
    { name: 'users', resetSerial: true },
    { name: 'drafts', resetSerial: false }, // TEXT primary key, no sequence
    { name: 'sessions', resetSerial: false }, // TEXT primary key (token)
    { name: 'invites', resetSerial: false },
    { name: 'password_resets', resetSerial: false },
    { name: 'editorial_style_versions', resetSerial: true },
    { name: 'generation_logs', resetSerial: true },
    { name: 'evaluation_logs', resetSerial: true },
    { name: 'field_records', resetSerial: true },
    { name: 'learning_queue', resetSerial: true },
    { name: 'notifications', resetSerial: true }
  ];

  let total = 0;
  for (const { name, resetSerial } of TABLES) {
    total += await copyTable(sqliteDb, pgPool, name, { resetSerial });
  }

  sqliteDb.close();
  await pgPool.end();
  console.log(`[migrate-data] done — ${total} row(s) copied across ${TABLES.length} tables.`);
}

main().catch(e => {
  console.error('[migrate-data] failed:', e);
  process.exit(1);
});
