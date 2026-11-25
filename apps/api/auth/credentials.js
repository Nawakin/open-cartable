import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { jwtVerify, SignJWT } from 'jose';
import { readSecret } from '../installation/secrets.js';

const issuer = 'open-cartable';
const audience = 'open-cartable-parent-api';
const accessLifetimeSeconds = 15 * 60;
const invitationAlphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

export const schoolCodePattern = /^[A-Z0-9][A-Z0-9-]{1,31}$/;
export const invitationCodePattern = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}(?:-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}){2}$/;
export const refreshTokenPattern = /^[A-Za-z0-9_-]{43}$/;
export const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function readKey(env, name) {
  const value = readSecret(env, name);
  if (typeof value !== 'string' || !/^[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(`${name} doit être une clé de 32 octets encodée en hexadécimal.`);
  }
  return Buffer.from(value, 'hex');
}

export function readInvitationKey(env) {
  return readKey(env, 'AUTH_INVITE_KEY');
}

export function readAuthKeys(env) {
  const signingKey = readKey(env, 'AUTH_SIGNING_KEY');
  const invitationKey = readInvitationKey(env);
  if (timingSafeEqual(signingKey, invitationKey)) {
    throw new Error('Les clés de signature et d’invitation doivent être distinctes.');
  }
  return { signingKey, invitationKey };
}

export function generateInvitationCode() {
  const groups = Array.from({ length: 3 }, () =>
    Array.from({ length: 4 }, () => invitationAlphabet[randomInt(invitationAlphabet.length)]).join(''));
  return groups.join('-');
}

export function invitationDigest(key, schoolCode, code) {
  return createHmac('sha256', key).update(schoolCode).update('\0').update(code).digest();
}

export function generateRefreshToken() {
  return randomBytes(32).toString('base64url');
}

export function refreshDigest(token) {
  return createHash('sha256').update(token).digest();
}

export async function issueAccessToken(key, session) {
  const now = Math.floor(Date.now() / 1000);
  const expires = Math.min(now + accessLifetimeSeconds, Math.floor(session.expires_at.getTime() / 1000));
  const token = await new SignJWT({ sid: session.id })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer(issuer)
    .setAudience(audience)
    .setSubject(session.guardian_id)
    .setIssuedAt(now)
    .setExpirationTime(expires)
    .sign(key);
  return { accessToken: token, expiresIn: Math.max(0, expires - now) };
}

export async function verifyAccessToken(key, token) {
  if (typeof token !== 'string' || token.length > 1024) return null;
  try {
    const { payload } = await jwtVerify(token, key, {
      algorithms: ['HS256'],
      issuer,
      audience,
      typ: 'JWT',
      requiredClaims: ['sub', 'sid', 'iat', 'exp'],
      maxTokenAge: accessLifetimeSeconds,
    });
    if (typeof payload.sub !== 'string' || !uuidPattern.test(payload.sub)
        || typeof payload.sid !== 'string' || !uuidPattern.test(payload.sid)) return null;
    return { sessionId: payload.sid, guardianId: payload.sub };
  } catch {
    return null;
  }
}
