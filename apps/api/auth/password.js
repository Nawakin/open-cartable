import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

export const passwordLimits = { minLength: 15, maxLength: 128 };
const derive = promisify(scrypt);
const scryptOptions = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };
const dummySalt = randomBytes(16);
const dummyHash = randomBytes(32);

export function validPassword(password) {
  if (typeof password !== 'string' || !password.trim() || password.includes('\0')) return false;
  const length = [...password].length;
  return length >= passwordLimits.minLength && length <= passwordLimits.maxLength;
}

export async function hashPassword(password) {
  if (!validPassword(password)) throw new Error('Le mot de passe doit contenir 15 à 128 caractères.');
  const salt = randomBytes(16);
  return { salt, hash: await derive(password, salt, 32, scryptOptions) };
}

export async function verifyPassword(password, account) {
  if (!validPassword(password)) return false;
  const derived = await derive(password, account?.password_salt ?? dummySalt, 32, scryptOptions);
  return timingSafeEqual(derived, account?.password_hash ?? dummyHash) && Boolean(account);
}
