import { createHash, randomBytes } from 'node:crypto';
import { hashPassword, validPassword, verifyPassword } from '../auth/password.js';
import { transaction } from '../db/database.js';
import { recoveryEmail } from './recovery-mail.js';
import { needsAuthenticator, setDirectionPassword } from './store.js';
import { generateEnrollment, useAuthenticator, validateAuthenticator } from './totp.js';

export function securityError(statusCode) {
  throw Object.assign(new Error('Opération de sécurité du compte direction refusée.'), { statusCode });
}

const tokenDigest = (value) => createHash('sha256').update(value).digest();

async function accountFor(db, schoolId) {
  const { rows: [account] } = await db.query('SELECT * FROM direction_accounts WHERE school_id = $1', [schoolId]);
  return account;
}

export async function securityStatus(db, schoolId, mailer, key) {
  const { rows: [record] } = await db.query(`
    SELECT recovery_email AS email, recovery_verified AS verified, totp_secret IS NOT NULL AS "totpEnabled"
    FROM direction_accounts WHERE school_id = $1
  `, [schoolId]);
  return record ? { ...record, mailAvailable: Boolean(mailer), totpAvailable: Boolean(key) } : null;
}

async function requirePassword(db, schoolId, key, { password, code }) {
  const account = await accountFor(db, schoolId);
  if (!await verifyPassword(password, account)) securityError(422);
  if (!await useAuthenticator(db, account, key, schoolId, code)) securityError(422);
  return account;
}

async function issueToken(db, schoolId, purpose) {
  const token = randomBytes(32).toString('base64url');
  const result = await db.query(`
    INSERT INTO direction_recovery_tokens (school_id, purpose, digest, expires_at)
    VALUES ($1, $2, $3, transaction_timestamp() + interval '30 minutes')
    ON CONFLICT (school_id, purpose) DO UPDATE SET digest = excluded.digest, attempts = 0, issued_at = excluded.issued_at,
      expires_at = excluded.expires_at
    WHERE direction_recovery_tokens.issued_at <= transaction_timestamp() - interval '1 minute'
  `, [schoolId, purpose, tokenDigest(token)]);
  return result.rowCount ? token : null;
}

export async function changeRecoveryEmail(db, schoolId, key, credentials) {
  const email = recoveryEmail(credentials.email);
  if (!email) securityError(400);
  const account = await requirePassword(db, schoolId, key, credentials);
  if (email === account.recovery_email) return;
  await db.query('UPDATE direction_accounts SET recovery_email = $2, recovery_verified = false WHERE school_id = $1', [schoolId, email]);
  await db.query('DELETE FROM direction_recovery_tokens WHERE school_id = $1', [schoolId]);
}

export async function verificationMessage(db, schoolId) {
  const account = await accountFor(db, schoolId);
  if (!account.recovery_email || account.recovery_verified) securityError(422);
  const token = await issueToken(db, schoolId, 'verify');
  if (!token) securityError(429);
  return { address: account.recovery_email, token };
}

export async function resetMessage(pool, { schoolCode, email }) {
  const address = recoveryEmail(email);
  if (!address) return null;
  return transaction(pool, async (db) => {
    const { rows: [account] } = await db.query(`
      SELECT a.school_id FROM direction_accounts a JOIN schools s ON s.id = a.school_id
      WHERE s.code = $1 AND a.recovery_verified AND a.recovery_email = $2 FOR UPDATE OF a
    `, [schoolCode, address]);
    if (!account) return null;
    const token = await issueToken(db, account.school_id, 'reset');
    return token ? { address, token } : null;
  });
}

async function recoveryAccount(db, token, purpose) {
  const digest = tokenDigest(token);
  const { rows: [target] } = await db.query(`
    SELECT school_id FROM direction_recovery_tokens
    WHERE digest = $1 AND purpose = $2 AND expires_at > statement_timestamp() AND attempts < 8
  `, [digest, purpose]);
  if (!target) return null;
  const { rows: [account] } = await db.query('SELECT * FROM direction_accounts WHERE school_id = $1 FOR UPDATE', [target.school_id]);
  const matched = await db.query(`
    SELECT 1 FROM direction_recovery_tokens
    WHERE digest = $1 AND purpose = $2 AND expires_at > statement_timestamp() AND attempts < 8
  `, [digest, purpose]);
  return account && matched.rowCount ? account : null;
}

export async function verifyRecoveryAddress(pool, token) {
  return transaction(pool, async (db) => {
    const account = await recoveryAccount(db, token, 'verify');
    if (!account?.recovery_email) return false;
    await db.query('UPDATE direction_accounts SET recovery_verified = true WHERE school_id = $1', [account.school_id]);
    await db.query("DELETE FROM direction_recovery_tokens WHERE school_id = $1 AND purpose = 'verify'", [account.school_id]);
    return true;
  });
}

export async function resetDirectionPassword(pool, key, { token, password, code }) {
  if (!validPassword(password)) return false;
  return transaction(pool, async (db) => {
    const account = await recoveryAccount(db, token, 'reset');
    if (!account?.recovery_verified) return false;
    if (account.totp_secret && !code) return needsAuthenticator;
    if (!await useAuthenticator(db, account, key, account.school_id, code)) {
      await db.query('UPDATE direction_recovery_tokens SET attempts = attempts + 1 WHERE digest = $1', [tokenDigest(token)]);
      return false;
    }
    await setDirectionPassword(db, account.school_id, await hashPassword(password));
    return true;
  });
}

export async function startEnrollment(db, actor, key, credentials) {
  const account = await accountFor(db, actor.school_id);
  if (account.totp_secret) securityError(409);
  await requirePassword(db, actor.school_id, key, credentials);
  const { sealed, ...enrollment } = generateEnrollment(key, actor);
  await db.query(`
    UPDATE direction_accounts SET totp_pending = $2, totp_pending_session = $3,
      totp_pending_until = statement_timestamp() + interval '10 minutes' WHERE school_id = $1
  `, [actor.school_id, sealed, actor.sessionDigest]);
  return enrollment;
}

export async function confirmEnrollment(db, actor, key, code) {
  const { rows: [record] } = await db.query(`
    SELECT totp_pending FROM direction_accounts WHERE school_id = $1 AND totp_secret IS NULL
      AND totp_pending_session = $2 AND totp_pending_until > statement_timestamp()
  `, [actor.school_id, actor.sessionDigest]);
  if (!record) securityError(409);
  const step = validateAuthenticator(record.totp_pending, key, actor.school_id, code);
  if (step === null) securityError(422);
  await db.query(`
    UPDATE direction_accounts SET totp_secret = totp_pending, totp_step = $2, totp_pending = NULL,
      totp_pending_session = NULL, totp_pending_until = NULL, totp_failed_attempts = 0,
      totp_failed_until = NULL WHERE school_id = $1
  `, [actor.school_id, step]);
  await revokeOtherSessions(db, actor);
}

export async function disableAuthenticator(db, actor, key, credentials) {
  const account = await requirePassword(db, actor.school_id, key, credentials);
  if (!account.totp_secret) return;
  await db.query(`
    UPDATE direction_accounts SET totp_secret = NULL, totp_step = NULL, totp_pending = NULL,
      totp_pending_session = NULL, totp_pending_until = NULL, totp_failed_attempts = 0,
      totp_failed_until = NULL WHERE school_id = $1
  `, [actor.school_id]);
  await revokeOtherSessions(db, actor);
}

async function revokeOtherSessions(db, actor) {
  await db.query('DELETE FROM direction_sessions WHERE school_id = $1 AND digest <> $2', [actor.school_id, actor.sessionDigest]);
  await db.query("DELETE FROM direction_recovery_tokens WHERE school_id = $1 AND purpose = 'reset'", [actor.school_id]);
}

export async function purgeExpiredDirectionSecurity(pool) {
  await pool.query('DELETE FROM direction_recovery_tokens WHERE expires_at <= statement_timestamp()');
  await pool.query(`
    UPDATE direction_accounts SET totp_pending = NULL, totp_pending_session = NULL, totp_pending_until = NULL
    WHERE totp_pending_until <= statement_timestamp()
  `);
}
