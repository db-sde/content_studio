// Expired sessions/invites/password-resets are already excluded from every query that matters
// (getSessionUser, getOpenInvite, getOpenPasswordReset all filter on expires_at), so this isn't
// fixing a correctness bug — it's just deleting rows that can otherwise accumulate forever.
// Run once per process boot rather than on a timer: an internal tool with a handful of users
// doesn't need a scheduler for this, and every deploy/restart already reaps anything stale.
export async function cleanupExpiredAuthRows(pool) {
  const sessions = await pool.query(`DELETE FROM sessions WHERE expires_at <= iso_now()`);
  const invites = await pool.query(`DELETE FROM invites WHERE expires_at <= iso_now()`);
  const resets = await pool.query(`DELETE FROM password_resets WHERE expires_at <= iso_now()`);

  const total = sessions.rowCount + invites.rowCount + resets.rowCount;
  if (total > 0) {
    console.log(`[db] cleaned up ${total} expired auth row(s) (${sessions.rowCount} sessions, ${invites.rowCount} invites, ${resets.rowCount} password resets)`);
  }
}
