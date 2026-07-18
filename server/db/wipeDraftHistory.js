// One-time reset: clears every draft and everything derived from it, so the app looks
// brand-new to whoever opens it next. Deliberately leaves `users`, `sessions`, `invites`,
// `password_resets`, and `editorial_style_versions` untouched — everyone keeps their login,
// only the draft history disappears.
//
//   node server/db/wipeDraftHistory.js
import { getPool, withTransaction } from './pgPool.js';

// Children before parents, respecting every FK in migrations_pg/001-002 — learning_queue and
// evaluation_logs both reference generation_logs (and learning_queue also references
// field_records), so those must go first or the later DELETEs would violate the FK constraint.
// notifications/directory_entries reference drafts ON DELETE CASCADE, so deleting drafts last
// would also clear them automatically — deleting explicitly here anyway for a clear, auditable
// per-table count rather than relying on an implicit cascade.
const DELETE_ORDER = [
  'learning_queue',
  'evaluation_logs',
  'field_records',
  'generation_logs',
  'notifications',
  'directory_entries',
  'drafts'
];

async function main() {
  const pool = getPool();

  const counts = await withTransaction(async (client) => {
    const result = {};
    for (const table of DELETE_ORDER) {
      const { rowCount } = await client.query(`DELETE FROM ${table}`);
      result[table] = rowCount;
    }
    return result;
  });

  for (const [table, n] of Object.entries(counts)) {
    console.log(`[wipe-history] ${table}: deleted ${n} row(s)`);
  }

  await pool.end();
  console.log('[wipe-history] done — users/sessions/invites/style versions untouched.');
}

main().catch(e => {
  console.error('[wipe-history] failed:', e);
  process.exit(1);
});
