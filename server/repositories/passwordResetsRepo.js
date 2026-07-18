import { getDb } from '../db/index.js';
import { config } from '../config.js';

export async function createPasswordReset(token, userId) {
  const db = await getDb();
  await db.query(`
    INSERT INTO password_resets (token, user_id, expires_at)
    VALUES ($1, $2, iso_future($3))
  `, [token, userId, config.passwordResetTtlHours]);
}

export async function getOpenPasswordReset(token) {
  const db = await getDb();
  const { rows } = await db.query(`
    SELECT * FROM password_resets
    WHERE token = $1 AND used_at IS NULL AND expires_at > iso_now()
  `, [token]);
  return rows[0] || null;
}

export async function markPasswordResetUsed(token) {
  const db = await getDb();
  await db.query(`UPDATE password_resets SET used_at = iso_now() WHERE token = $1`, [token]);
}
