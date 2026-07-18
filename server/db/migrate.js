import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, 'migrations_pg');

// Applies any migrations_pg/*.sql not yet recorded in schema_migrations, in filename order, each
// inside its own transaction. Stops hard on the first failure — no partial application.
export async function runMigrations(pool) {
  // now()::text rather than this app's own iso_now() — that function is itself defined inside
  // 001_init.sql, so it doesn't exist yet the very first time this bootstrap table is created on
  // a brand-new database. Nothing else reads or compares this column, so the exact format doesn't
  // need to match the rest of the app's timestamps.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (now()::text)
    );
  `);

  const { rows } = await pool.query('SELECT filename FROM schema_migrations');
  const applied = new Set(rows.map(row => row.filename));

  const filenames = fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort();

  const pending = filenames.filter(f => !applied.has(f));
  if (pending.length === 0) return;

  for (const filename of pending) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, filename), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [filename]);
      await client.query('COMMIT');
      console.log(`[db] applied migration: ${filename}`);
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }
}
