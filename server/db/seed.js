import { STYLE_V1 } from '../ai/styleV1.js';

// Inserts the v1 editorial style as the active version if no active version exists yet.
// Never overwrites an existing active row — style versions are only ever changed via the
// (currently deferred) reviewable Style Evolution workflow, never automatically.
export async function seedStyleIfMissing(pool) {
  const { rows } = await pool.query(`SELECT id FROM editorial_style_versions WHERE status = 'active' LIMIT 1`);
  if (rows.length) return;

  await pool.query(`
    INSERT INTO editorial_style_versions (version, status, style_json, notes, activated_at)
    VALUES ($1, 'active', $2, $3, iso_now())
  `, [STYLE_V1.version, JSON.stringify(STYLE_V1), 'Bootstrap default — no prior DegreeBaba style guide existed to seed from.']);

  console.log(`[db] seeded editorial_style_versions ${STYLE_V1.version} as active`);
}
