import { generateRefreshToken, refreshDigest } from '../auth/credentials.js';
import { transaction } from '../db/database.js';
import { verifyPassword } from '../auth/password.js';
import { useAuthenticator } from './totp.js';

export const directionSessionSeconds = 8 * 60 * 60;
export const needsAuthenticator = Symbol('Code de double authentification requis');

export async function setDirectionPassword(db, schoolId, { salt, hash }) {
  await db.query(`
    INSERT INTO direction_accounts (school_id, password_salt, password_hash) VALUES ($1, $2, $3)
    ON CONFLICT (school_id) DO UPDATE
    SET password_salt = excluded.password_salt, password_hash = excluded.password_hash,
      totp_pending = NULL, totp_pending_session = NULL, totp_pending_until = NULL,
      totp_failed_attempts = 0, totp_failed_until = NULL
  `, [schoolId, salt, hash]);
  await db.query('DELETE FROM direction_sessions WHERE school_id = $1', [schoolId]);
  await db.query('DELETE FROM direction_recovery_tokens WHERE school_id = $1', [schoolId]);
}

export async function signInDirection(pool, schoolCode, password, authenticatorCode, totpKey) {
  const { rows } = await pool.query(`
    SELECT a.school_id, a.password_salt, a.password_hash
    FROM direction_accounts a JOIN schools s ON s.id = a.school_id WHERE s.code = $1
  `, [schoolCode]);
  const account = rows[0];
  if (!await verifyPassword(password, account)) return null;

  return transaction(pool, async (client) => {
    const { rows: [current] } = await client.query(`
      SELECT totp_secret, totp_step, totp_failed_attempts, totp_failed_until > statement_timestamp() AS locked_window
      FROM direction_accounts WHERE school_id = $1 AND password_salt = $2 FOR UPDATE
    `, [account.school_id, account.password_salt]);
    if (!current) return null;
    if (current.totp_secret && !authenticatorCode) return needsAuthenticator;
    if (current.totp_secret) {
      if (current.locked_window && current.totp_failed_attempts >= 8) {
        throw Object.assign(new Error('Trop de codes de double authentification invalides.'), { statusCode: 429 });
      }
      if (!await useAuthenticator(client, current, totpKey, account.school_id, authenticatorCode)) {
        await client.query(`
          UPDATE direction_accounts SET totp_failed_attempts = $2,
            totp_failed_until = CASE WHEN $3 THEN totp_failed_until ELSE statement_timestamp() + interval '1 minute' END
          WHERE school_id = $1
        `, [account.school_id, current.locked_window ? current.totp_failed_attempts + 1 : 1, Boolean(current.locked_window)]);
        return null;
      }
      if (current.totp_failed_attempts) {
        await client.query('UPDATE direction_accounts SET totp_failed_attempts = 0, totp_failed_until = NULL WHERE school_id = $1',
          [account.school_id]);
      }
    }

    const token = generateRefreshToken();
    await client.query(`
      INSERT INTO direction_sessions (digest, school_id, expires_at)
      VALUES ($1, $2, statement_timestamp() + $3 * interval '1 second')
    `, [refreshDigest(token), account.school_id, directionSessionSeconds]);
    return token;
  });
}

export async function withDirectionSession(pool, token, operation, { lockAccount = false } = {}) {
  return transaction(pool, async (client) => {
    const digest = refreshDigest(token);
    const result = await client.query(`
      SELECT d.school_id, s.code AS school_code, s.name AS school_name
      FROM direction_sessions d JOIN schools s ON s.id = d.school_id
      WHERE d.digest = $1 AND d.expires_at > statement_timestamp()
    `, [digest]);
    if (!result.rowCount) return { authorized: false };
    const actor = result.rows[0];
    if (lockAccount) {
      const account = await client.query('SELECT 1 FROM direction_accounts WHERE school_id = $1 FOR UPDATE', [actor.school_id]);
      if (!account.rowCount) return { authorized: false };
    }
    const session = await client.query(`
      SELECT 1 FROM direction_sessions WHERE digest = $1 AND expires_at > statement_timestamp() FOR SHARE
    `, [digest]);
    if (!session.rowCount) return { authorized: false };
    return { authorized: true, value: await operation(client, { ...actor, sessionDigest: digest }) };
  });
}

export async function signOutDirection(pool, token) {
  await pool.query('DELETE FROM direction_sessions WHERE digest = $1', [refreshDigest(token)]);
}
