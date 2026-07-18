import { getDb } from '../db/index.js';

const PUBLIC_COLUMNS = 'id, name, email, role, created_at, deactivated_at';

export async function countUsers() {
  const db = await getDb();
  const { rows } = await db.query('SELECT COUNT(*) AS n FROM users');
  return Number(rows[0].n);
}

export async function createUser({ name, email, passwordHash, role }) {
  const db = await getDb();
  const { rows } = await db.query(`
    INSERT INTO users (name, email, password_hash, role)
    VALUES ($1, $2, $3, $4)
    RETURNING ${PUBLIC_COLUMNS}
  `, [name, email, passwordHash, role]);

  return rows[0];
}

export async function getUserByEmail(email) {
  const db = await getDb();
  const { rows } = await db.query('SELECT * FROM users WHERE email = $1', [email]);
  return rows[0] || null;
}

export async function getUserById(id) {
  const db = await getDb();
  const { rows } = await db.query(`SELECT ${PUBLIC_COLUMNS} FROM users WHERE id = $1`, [id]);
  return rows[0] || null;
}

export async function updatePassword(userId, passwordHash) {
  const db = await getDb();
  await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, userId]);
}
