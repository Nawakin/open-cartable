import { refreshDigest, schoolCodePattern } from '../auth/credentials.js';
import { transaction } from '../db/database.js';
import { deviceCodePatterns, deviceMetadata, markDevice, redeemDevicePair } from '../devices/store.js';
import { shape } from '../school-life/validation.js';
import { authRateLimit, cookieOptions, nativeStaffClient, nativeStaffDevice, unauthorized, webSessionToken } from '../auth/staff-web.js';
import { beginEnrollment, confirmEnrollment } from './security.js';
import {
  checkDirectionCode, directionDeviceSeconds, factorFields, readDirectionDevice, recordDirectionCodeFailure, rememberDirectionDevice, resumeDirection,
  withDirectionSession,
} from './store.js';
import { authenticatorCode } from './totp.js';

export const directionDeviceCookie = '__Host-open-cartable-direction-device';

export function deviceFor(request) {
  return nativeStaffClient(request) ? nativeStaffDevice(request) : webSessionToken(request, directionDeviceCookie);
}

export function sendDirectionSession(request, reply, session, cookieName) {
  if (nativeStaffClient(request)) {
    return reply.send({ state: session.state, token: session.token, ...(session.deviceToken ? { deviceToken: session.deviceToken } : {}) });
  }
  reply.setCookie(cookieName, session.token, { ...cookieOptions, maxAge: session.seconds });
  if (session.deviceToken) reply.setCookie(directionDeviceCookie, session.deviceToken, { ...cookieOptions, maxAge: directionDeviceSeconds });
  if (session.state === 'enroll') return reply.code(202).send({ state: 'enroll' });
  return reply.code(204).send();
}

const codeOptions = {
  bodyLimit: 1024, config: { rateLimit: { max: 12, timeWindow: '1 minute' } },
  schema: { body: { type: 'object', required: ['code'], additionalProperties: false, properties: { code: authenticatorCode } } },
};

export function registerDirectionAccess(app, { pool, tokenFor, totpKey, requireTotp, cookieName, pairingKey }) {
  const path = '/direction/auth';
  app.get(path + '/state', async (request) => {
    const token = tokenFor(request);
    if (token) {
      const result = await withDirectionSession(pool, token, (_db, actor) => ({
        state: actor.assurance === 'enroll' ? 'enroll' : 'active', deviceDigest: actor.deviceDigest, schoolCode: actor.school_code, schoolName: actor.school_name,
      }), { requireTotp, allowEnrollment: true });
      if (result.authorized) {
        const { deviceDigest, ...state } = result.value;
        await markDevice(pool, 'direction', deviceDigest, deviceMetadata(request));
        return state;
      }
    }
    const remembered = await readDirectionDevice(pool, deviceFor(request));
    return remembered ? { state: 'verify', schoolCode: remembered.schoolCode, schoolName: remembered.schoolName } : { state: 'login' };
  });

  app.post(path + '/resume', codeOptions, async (request, reply) => {
    const deviceToken = deviceFor(request);
    if (!deviceToken) return unauthorized(reply);
    const session = await resumeDirection(pool, deviceToken, totpKey, request.body.code);
    if (session === null) return unauthorized(reply);
    if (session === false) return reply.code(422).send({ error: 'Code d’authentificateur invalide.' });
    return sendDirectionSession(request, reply, session, cookieName);
  });

  if (requireTotp && pairingKey) app.post(path + '/device-link', {
    bodyLimit: 1024, config: authRateLimit, schema: { body: shape({
      schoolCode: { type: 'string', pattern: schoolCodePattern.source },
      code: { type: 'string', pattern: deviceCodePatterns.direction }, authenticator: authenticatorCode,
    }) },
  }, async (request, reply) => {
    const { schoolCode, code, authenticator } = request.body;
    const session = await transaction(pool, (db) => redeemDevicePair(db, pairingKey, 'direction', schoolCode, code, async (schoolId) => {
      const { rows: [account] } = await db.query(`SELECT ${factorFields} FROM direction_accounts WHERE school_id=$1`, [schoolId]);
      if (!account?.totp_secret || !await checkDirectionCode(db, account, schoolId, totpKey, authenticator)) return { rejected: true };
      const result = await rememberDirectionDevice(db, schoolId);
      await markDevice(db, 'direction', refreshDigest(result.deviceToken), deviceMetadata(request));
      return result;
    }));
    if (!session) return unauthorized(reply);
    if (session.rejected) return reply.code(422).send({ error: 'Code d’authentificateur invalide.' });
    return sendDirectionSession(request, reply, session, cookieName);
  });

  function forEnrollment(operation) {
    return async (request, reply) => {
      const token = tokenFor(request);
      if (!token || !requireTotp) return unauthorized(reply);
      const result = await withDirectionSession(pool, token, (db, actor) =>
        actor.assurance === 'enroll' ? operation(request, db, actor) : null,
      { requireTotp, allowEnrollment: true, lockAccount: true });
      if (!result.authorized || !result.value) return unauthorized(reply);
      if (result.value.invalid) return reply.code(422).send({ error: 'Code d’authentificateur invalide.' });
      if (result.value.token) return sendDirectionSession(request, reply, result.value, cookieName);
      return result.value;
    };
  }

  app.post(path + '/enrollment', { config: authRateLimit }, forEnrollment((_request, db, actor) => beginEnrollment(db, actor, totpKey)));
  app.put(path + '/enrollment', codeOptions, forEnrollment(async (request, db, actor) => {
    const { rows: [account] } = await db.query(`
      SELECT totp_failed_attempts, totp_failed_until > statement_timestamp() AS locked_window
      FROM direction_accounts WHERE school_id = $1
    `, [actor.school_id]);
    if (account.locked_window && account.totp_failed_attempts >= 8) {
      throw Object.assign(new Error('Trop de codes de double authentification invalides.'), { statusCode: 429 });
    }
    try {
      await confirmEnrollment(db, actor, totpKey, request.body.code);
    } catch (error) {
      if (error.statusCode !== 422) throw error;
      await recordDirectionCodeFailure(db, account, actor.school_id);
      return { invalid: true };
    }
    await db.query('DELETE FROM direction_sessions WHERE digest = $1', [actor.sessionDigest]);
    return rememberDirectionDevice(db, actor.school_id);
  }));
}
