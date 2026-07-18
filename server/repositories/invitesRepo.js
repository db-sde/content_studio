import { getDb } from '../db/index.js';
import { config } from '../config.js';

export async function createInvite(token, { role, invitedByUserId }) {
  const db = await getDb();
  await db.query(`
    INSERT INTO invites (token, role, invited_by_user_id, expires_at)
    VALUES ($1, $2, $3, iso_future($4))
  `, [token, role, invitedByUserId, config.inviteTtlHours]);
}

// Only returns a still-open (unused, unexpired) invite — callers treat "not found" as
// "this link is invalid or already used," without needing to check those fields separately.
export async function getOpenInvite(token) {
  const db = await getDb();
  const { rows } = await db.query(`
    SELECT * FROM invites
    WHERE token = $1 AND used_at IS NULL AND expires_at > iso_now()
  `, [token]);
  return rows[0] || null;
}

export async function markInviteUsed(token, usedByUserId) {
  const db = await getDb();
  await db.query(`
    UPDATE invites SET used_at = iso_now(), used_by_user_id = $1 WHERE token = $2
  `, [usedByUserId, token]);
}
