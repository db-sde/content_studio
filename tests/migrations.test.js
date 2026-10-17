// The migration chain must build a working schema from nothing and be safe to re-run on every boot.
import './helpers/env.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { startTestApp } from './helpers/testApp.js';
import { runMigrations } from '../server/db/migrate.js';
import { getPool } from '../server/db/pgPool.js';
import { NOTIFICATION_TYPE_VERBS } from '../src/utils/notificationFormat.js';

let t;
before(async () => { t = await startTestApp(); });
after(async () => { await t.close(); });

const files = fs.readdirSync(new URL('../server/db/migrations_pg', import.meta.url)).filter(f => f.endsWith('.sql')).sort();

test('every migration file is applied, in order, exactly once', async () => {
  const { rows } = await t.query('SELECT filename FROM schema_migrations ORDER BY filename');
  assert.deepEqual(rows.map(r => r.filename), files);
});

test('re-running migrations (every server boot) applies nothing and changes nothing', async () => {
  const before = (await t.query('SELECT count(*)::int n FROM schema_migrations')).rows[0].n;
  await runMigrations(getPool());
  const after = (await t.query('SELECT count(*)::int n FROM schema_migrations')).rows[0].n;
  assert.equal(after, before);
});

test('migration filenames are numbered and unique (a duplicate number would apply in the wrong order)', () => {
  const numbers = files.map(f => f.slice(0, 3));
  assert.ok(numbers.every(n => /^\d{3}$/.test(n)), files.join(', '));
  assert.equal(new Set(numbers).size, numbers.length, `duplicate migration number in: ${files.join(', ')}`);
});

test('the columns and indexes the app relies on exist', async () => {
  const cols = (await t.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'drafts'")).rows.map(r => r.column_name);
  for (const c of ['assigned_to_user_id', 'submitted_by_user_id', 'last_edited_by_user_id', 'prioritized_at']) assert.ok(cols.includes(c), `drafts.${c} missing`);
  const idx = (await t.query("SELECT indexname FROM pg_indexes WHERE tablename IN ('generation_logs', 'evaluation_logs')")).rows.map(r => r.indexname);
  for (const i of ['idx_generation_logs_created_at', 'idx_evaluation_logs_created_at']) assert.ok(idx.includes(i), `${i} missing - the daily AI budget check would scan the whole table`);
});

test('the database accepts every notification type the UI knows how to show, and nothing else', async () => {
  const { rows: [u] } = await t.query("INSERT INTO users (name,email,password_hash,role) VALUES ('M','m@degreebaba.com','x','senior') RETURNING id");
  await t.query("INSERT INTO drafts (id,page_type,form_data_json,created_by_user_id) VALUES ('draft_1','course','{}',$1)", [u.id]);
  for (const type of Object.keys(NOTIFICATION_TYPE_VERBS)) {
    await t.query('INSERT INTO notifications (draft_id,type,created_by_user_id,recipient_user_id) VALUES ($1,$2,$3,$3)', ['draft_1', type, u.id]);
  }
  await assert.rejects(t.query('INSERT INTO notifications (draft_id,type,created_by_user_id,recipient_user_id) VALUES ($1,$2,$3,$3)', ['draft_1', 'bogus', u.id]));
});
