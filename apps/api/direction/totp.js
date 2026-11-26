import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { Secret, TOTP } from 'otpauth';

export const authenticatorCode = { type: 'string', minLength: 6, maxLength: 6, pattern: '^[0-9]{6}$' };
const period = 30;

function createTotp(secret, label) {
  return new TOTP({ issuer: 'Open Cartable', label, secret, algorithm: 'SHA1', digits: 6, period });
}

function requireKey(key) {
  if (!key) throw Object.assign(new Error('Clé de double authentification indisponible.'), { statusCode: 503 });
  return key;
}

function sealedSecret(secret, key, schoolId) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', requireKey(key), nonce);
  cipher.setAAD(Buffer.from(schoolId));
  const data = Buffer.concat([cipher.update(secret.base32, 'ascii'), cipher.final()]);
  return Buffer.concat([nonce, cipher.getAuthTag(), data]);
}

export function generateEnrollment(key, { school_id, school_code }) {
  const secret = new Secret({ size: 20 });
  return {
    sealed: sealedSecret(secret, key, school_id),
    secret: secret.base32,
    uri: createTotp(secret, school_code).toString(),
  };
}

export function validateAuthenticator(sealed, key, schoolId, code, previousStep = null, timestamp = Date.now()) {
  if (typeof code !== 'string' || code.length !== 6 || !/^[0-9]{6}$/.test(code)) return null;
  const decipher = createDecipheriv('aes-256-gcm', requireKey(key), sealed.subarray(0, 12));
  decipher.setAAD(Buffer.from(schoolId));
  decipher.setAuthTag(sealed.subarray(12, 28));
  const secret = Buffer.concat([decipher.update(sealed.subarray(28)), decipher.final()]).toString('ascii');
  const delta = createTotp(Secret.fromBase32(secret), schoolId).validate({ token: code, timestamp, window: 1 });
  if (delta === null) return null;
  const step = Math.floor(timestamp / (period * 1000)) + delta;
  return previousStep === null || step > Number(previousStep) ? step : null;
}

export async function useAuthenticator(db, account, key, schoolId, code) {
  if (!account.totp_secret) return true;
  const step = validateAuthenticator(account.totp_secret, key, schoolId, code, account.totp_step);
  if (step === null) return false;
  await db.query('UPDATE direction_accounts SET totp_step = $2 WHERE school_id = $1', [schoolId, step]);
  return true;
}
