import { getDb } from '../db/index.js';
import { config } from '../config.js';

export async function createSession(token, userId) {
  const db = await getDb();
  await db.query(`
    INSERT INTO sessions (token, user_id, expires_at)
    VALUES ($1, $2, iso_future($3))
  `, [token, userId, config.sessionTtlHours]);
}

// Joins to users so a single query gives the caller everything needed for req.currentUser,
// and returns nothing for an expired session (rather than a session row the caller must
// separately check the expiry on).
export async function getSessionUser(token) {
  const db = await getDb();
  const { rows } = await db.query(`
    SELECT u.id, u.name, u.email, u.role, u.deactivated_at
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token = $1 AND s.expires_at > iso_now()
  `, [token]);
  return rows[0] || null;
}

export async function deleteSession(token) {
  const db = await getDb();
  await db.query('DELETE FROM sessions WHERE token = $1', [token]);
}
