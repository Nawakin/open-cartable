import { generateRefreshToken, refreshDigest } from '../auth/credentials.js';
import { transaction } from '../db/database.js';
import { verifyPassword } from './password.js';

export const directionSessionSeconds = 8 * 60 * 60;

export async function setDirectionPassword(db, schoolId, { salt, hash }) {
  await db.query(`
    INSERT INTO direction_accounts (school_id, password_salt, password_hash) VALUES ($1, $2, $3)
    ON CONFLICT (school_id) DO UPDATE
    SET password_salt = excluded.password_salt, password_hash = excluded.password_hash
  `, [schoolId, salt, hash]);
  await db.query('DELETE FROM direction_sessions WHERE school_id = $1', [schoolId]);
}

export async function signInDirection(pool, schoolCode, password) {
  const { rows } = await pool.query(`
    SELECT a.school_id, a.password_salt, a.password_hash
    FROM direction_accounts a JOIN schools s ON s.id = a.school_id WHERE s.code = $1
  `, [schoolCode]);
  const account = rows[0];
  if (!await verifyPassword(password, account)) return null;

  return transaction(pool, async (client) => {
    const current = await client.query(`
      SELECT 1 FROM direction_accounts WHERE school_id = $1 AND password_salt = $2 FOR UPDATE
    `, [account.school_id, account.password_salt]);
    if (!current.rowCount) return null;

    const token = generateRefreshToken();
    await client.query(`
      INSERT INTO direction_sessions (digest, school_id, expires_at)
      VALUES ($1, $2, statement_timestamp() + $3 * interval '1 second')
    `, [refreshDigest(token), account.school_id, directionSessionSeconds]);
    return token;
  });
}

export async function withDirectionSession(pool, token, operation) {
  return transaction(pool, async (client) => {
    const result = await client.query(`
      SELECT d.school_id, s.code AS school_code, s.name AS school_name
      FROM direction_sessions d JOIN schools s ON s.id = d.school_id
      WHERE d.digest = $1 AND d.expires_at > statement_timestamp()
      FOR SHARE OF d
    `, [refreshDigest(token)]);
    if (!result.rowCount) return { authorized: false };
    return { authorized: true, value: await operation(client, result.rows[0]) };
  });
}

export async function signOutDirection(pool, token) {
  await pool.query('DELETE FROM direction_sessions WHERE digest = $1', [refreshDigest(token)]);
}
