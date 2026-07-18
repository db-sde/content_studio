import { getDb } from '../db/index.js';
import { withTransaction } from '../db/pgPool.js';

export async function getActiveStyleVersion() {
  const db = await getDb();
  const { rows } = await db.query(`SELECT * FROM editorial_style_versions WHERE status = 'active' LIMIT 1`);
  return rows[0] || null;
}

export async function getAllStyleVersions() {
  const db = await getDb();
  const { rows } = await db.query(`SELECT * FROM editorial_style_versions ORDER BY created_at DESC`);
  return rows;
}

// Archives whichever version is currently active and activates a brand-new one in the same
// transaction — there's only ever meant to be one active row at a time (getActiveStyleVersion
// assumes exactly that), so this must never leave two active rows even briefly.
export async function createAndActivateStyleVersion({ version, styleJson, notes }) {
  await getDb();
  await withTransaction(async (client) => {
    await client.query(`UPDATE editorial_style_versions SET status = 'archived' WHERE status = 'active'`);
    await client.query(`
      INSERT INTO editorial_style_versions (version, status, style_json, notes, activated_at)
      VALUES ($1, 'active', $2, $3, iso_now())
    `, [version, JSON.stringify(styleJson), notes || null]);
  });
  return getActiveStyleVersion();
}
