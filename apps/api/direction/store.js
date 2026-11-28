import { generateRefreshToken, refreshDigest } from '../auth/credentials.js';
import { transaction } from '../db/database.js';
import { verifyPassword } from '../auth/password.js';
import { useAuthenticator } from './totp.js';

export const directionSessionSeconds = 8 * 60 * 60;
export const directionEnrollmentSeconds = 10 * 60;
export const directionDeviceSeconds = 180 * 24 * 60 * 60;
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
  await db.query('DELETE FROM direction_devices WHERE school_id = $1', [schoolId]);
  await db.query('DELETE FROM direction_recovery_tokens WHERE school_id = $1', [schoolId]);
}

export async function checkDirectionCode(db, account, schoolId, totpKey, code) {
  if (account.locked_window && account.totp_failed_attempts >= 8) {
    throw Object.assign(new Error('Trop de codes de double authentification invalides.'), { statusCode: 429 });
  }
  if (!await useAuthenticator(db, account, totpKey, schoolId, code)) {
    await recordDirectionCodeFailure(db, account, schoolId);
    return false;
  }
  if (account.totp_failed_attempts) {
    await db.query('UPDATE direction_accounts SET totp_failed_attempts = 0, totp_failed_until = NULL WHERE school_id = $1', [schoolId]);
  }
  return true;
}

export async function recordDirectionCodeFailure(db, account, schoolId) {
  await db.query(`
    UPDATE direction_accounts SET totp_failed_attempts = $2,
      totp_failed_until = CASE WHEN $3 THEN totp_failed_until ELSE statement_timestamp() + interval '1 minute' END
    WHERE school_id = $1
  `, [schoolId, account.locked_window ? account.totp_failed_attempts + 1 : 1, Boolean(account.locked_window)]);
}

export const factorFields = 'totp_secret, totp_step, totp_failed_attempts, totp_failed_until > statement_timestamp() AS locked_window';

async function makeSession(db, schoolId, assurance, deviceDigest = null) {
  const token = generateRefreshToken();
  const seconds = assurance === 'enroll' ? directionEnrollmentSeconds : directionSessionSeconds;
  await db.query(`
    INSERT INTO direction_sessions (digest, school_id, expires_at, assurance, device_digest)
    VALUES ($1, $2, statement_timestamp() + $3 * interval '1 second', $4, $5)
  `, [refreshDigest(token), schoolId, seconds, assurance, deviceDigest]);
  return { token, state: assurance === 'enroll' ? 'enroll' : 'active', seconds };
}

export async function rememberDirectionDevice(db, schoolId, previous = null) {
  const { rows: [old] } = previous ? await db.query(`
    DELETE FROM direction_devices WHERE (school_id,digest)=($1,$2)
    RETURNING public_id,device_name,device_os,device_type
  `, [schoolId, refreshDigest(previous)]) : { rows: [] };
  const deviceToken = generateRefreshToken();
  const digest = refreshDigest(deviceToken);
  await db.query(`
    INSERT INTO direction_devices (digest,school_id,expires_at,public_id,device_name,device_os,device_type)
    VALUES ($1,$2,statement_timestamp()+$3*interval '1 second',coalesce($4,gen_random_uuid()),$5,$6,$7)
  `, [digest, schoolId, directionDeviceSeconds, old?.public_id, old?.device_name, old?.device_os, old?.device_type]);
  return { ...await makeSession(db, schoolId, 'totp', digest), deviceToken };
}

export async function signInDirection(pool, schoolCode, password, authenticatorCode, totpKey, { requireTotp = false, deviceToken } = {}) {
  const { rows } = await pool.query(`
    SELECT a.school_id, a.password_salt, a.password_hash
    FROM direction_accounts a JOIN schools s ON s.id = a.school_id WHERE s.code = $1
  `, [schoolCode]);
  const account = rows[0];
  if (!await verifyPassword(password, account)) return null;

  return transaction(pool, async (client) => {
    const { rows: [current] } = await client.query(`
      SELECT ${factorFields}
      FROM direction_accounts WHERE school_id = $1 AND password_salt = $2 FOR UPDATE
    `, [account.school_id, account.password_salt]);
    if (!current) return null;
    if (current.totp_secret && !authenticatorCode) return needsAuthenticator;
    if (current.totp_secret) {
      if (!await checkDirectionCode(client, current, account.school_id, totpKey, authenticatorCode)) return null;
      return requireTotp ? rememberDirectionDevice(client, account.school_id, deviceToken) : makeSession(client, account.school_id, 'totp');
    }
    return makeSession(client, account.school_id, requireTotp ? 'enroll' : 'legacy');
  });
}

export async function withDirectionSession(pool, token, operation, { lockAccount = false, requireTotp = false, allowEnrollment = false } = {}) {
  return transaction(pool, async (client) => {
    const digest = refreshDigest(token);
    const result = await client.query(`
      SELECT d.school_id, d.assurance, d.device_digest AS "deviceDigest", s.code AS school_code, s.name AS school_name
      FROM direction_sessions d JOIN schools s ON s.id = d.school_id
      JOIN direction_accounts a ON a.school_id = s.id
      WHERE d.digest = $1 AND d.expires_at > statement_timestamp()
        AND CASE WHEN d.assurance = 'enroll' THEN $3 AND a.totp_secret IS NULL
          WHEN $2 THEN d.assurance = 'totp' AND a.totp_secret IS NOT NULL ELSE true END
    `, [digest, requireTotp, allowEnrollment]);
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

export async function readDirectionDevice(pool, token) {
  if (!token) return null;
  const { rows: [actor] } = await pool.query(`
    SELECT d.school_id, s.code AS "schoolCode", s.name AS "schoolName"
    FROM direction_devices d JOIN schools s ON s.id = d.school_id
    JOIN direction_accounts a ON a.school_id = s.id
    WHERE d.digest = $1 AND d.expires_at > statement_timestamp() AND a.totp_secret IS NOT NULL
  `, [refreshDigest(token)]);
  return actor ?? null;
}

export async function resumeDirection(pool, token, totpKey, code) {
  return transaction(pool, async (db) => {
    const device = await readDirectionDevice(db, token);
    if (!device) return null;
    const { rows: [account] } = await db.query(`
      SELECT ${factorFields} FROM direction_accounts WHERE school_id = $1 FOR UPDATE
    `, [device.school_id]);
    if (!account?.totp_secret || !await readDirectionDevice(db, token)) return null;
    if (!await checkDirectionCode(db, account, device.school_id, totpKey, code)) return false;
    return rememberDirectionDevice(db, device.school_id, token);
  });
}

export async function signOutDirection(pool, token, deviceToken) {
  await transaction(pool, async (db) => {
    await db.query(`
      SELECT a.school_id FROM direction_accounts a WHERE a.school_id IN (
        SELECT school_id FROM direction_sessions WHERE digest = $1
        UNION SELECT school_id FROM direction_devices WHERE digest = $2
      ) ORDER BY a.school_id FOR UPDATE
    `, [token ? refreshDigest(token) : null, deviceToken ? refreshDigest(deviceToken) : null]);
    if (deviceToken) await db.query('DELETE FROM direction_devices WHERE digest = $1', [refreshDigest(deviceToken)]);
    if (token) await db.query('DELETE FROM direction_sessions WHERE digest = $1', [refreshDigest(token)]);
  });
}
