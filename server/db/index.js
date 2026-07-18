import { getPool } from './pgPool.js';
import { runMigrations } from './migrate.js';
import { seedStyleIfMissing } from './seed.js';
import { cleanupExpiredAuthRows } from './cleanup.js';

let readyPromise = null;

// Memoized so migrations/seed/cleanup run exactly once per process, no matter how many call
// sites (every repository) independently await getDb() before their first query.
export async function getDb() {
  const pool = getPool();

  if (!readyPromise) {
    readyPromise = (async () => {
      await runMigrations(pool);
      await seedStyleIfMissing(pool);
      await cleanupExpiredAuthRows(pool);
    })();
  }

  await readyPromise;
  return pool;
}
