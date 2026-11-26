import { schoolCodePattern } from '../auth/credentials.js';
import { passwordLimits } from '../auth/password.js';
import { cookieOptions, unauthorized } from '../auth/staff-web.js';
import { emailField } from './recovery-mail.js';
import {
  changeRecoveryEmail, confirmEnrollment, disableAuthenticator, resetDirectionPassword, resetMessage, securityError,
  securityStatus, startEnrollment, verificationMessage, verifyRecoveryAddress,
} from './security.js';
import { needsAuthenticator, withDirectionSession } from './store.js';
import { authenticatorCode } from './totp.js';

const password = { type: 'string', ...passwordLimits };
const token = { type: 'string', minLength: 43, maxLength: 43, pattern: '^[A-Za-z0-9_-]{43}$' };
const rateLimit = { max: 8, timeWindow: '1 minute' };

function body(required, extra = {}) {
  return {
    bodyLimit: 2048,
    config: { rateLimit },
    schema: { body: { type: 'object', required: Object.keys(required), additionalProperties: false, properties: { ...required, ...extra } } },
  };
}

export function registerDirectionSecurity(app, { pool, tokenFor, authenticated, mailer, totpKey, cookieName }) {
  const path = '/direction/security';
  const recovery = '/direction/recovery';
  const status = (db, schoolId) => securityStatus(db, schoolId, mailer, totpKey);
  const withLock = (operation) => authenticated(operation, 200, { lockAccount: true });
  app.get(path, authenticated((_request, db, actor) => status(db, actor.school_id)));

  app.put(path + '/email', body({ email: emailField, password }, { code: authenticatorCode }),
    withLock(async (request, db, actor) => {
      await changeRecoveryEmail(db, actor.school_id, totpKey, request.body);
      return status(db, actor.school_id);
    }));
  app.post(path + '/email/verify', { config: { rateLimit } }, async (request, reply) => {
    const session = tokenFor(request);
    if (!session) return unauthorized(reply);
    const message = await withDirectionSession(pool, session, (db, actor) => {
      if (!mailer) securityError(503);
      return verificationMessage(db, actor.school_id);
    }, { lockAccount: true });
    if (!message.authorized) return unauthorized(reply);
    try {
      await mailer(message.value.address, 'verify', message.value.token);
    } catch {
      securityError(503);
    }
    return reply.send({ sent: true });
  });

  app.post(path + '/totp', body({ password }), withLock((request, db, actor) =>
    startEnrollment(db, actor, totpKey, request.body)));
  app.put(path + '/totp', body({ code: authenticatorCode }), withLock(async (request, db, actor) => {
    await confirmEnrollment(db, actor, totpKey, request.body.code);
    return status(db, actor.school_id);
  }));
  app.delete(path + '/totp', body({ password, code: authenticatorCode }), withLock(async (request, db, actor) => {
    await disableAuthenticator(db, actor, totpKey, request.body);
    return status(db, actor.school_id);
  }));

  app.post(recovery + '/request', body({ schoolCode: { type: 'string', pattern: schoolCodePattern.source }, email: emailField }),
    async (request, reply) => {
      const message = mailer && await resetMessage(pool, request.body);
      if (message) {
        // La réponse ne doit pas dépendre du temps de réponse du relais SMTP.
        void Promise.resolve().then(() => mailer(message.address, 'reset', message.token)).catch(() => {});
      }
      return reply.code(202).send({ requested: true });
    });
  app.post(recovery + '/verify', body({ token }), async (request, reply) => {
    if (!await verifyRecoveryAddress(pool, request.body.token)) securityError(400);
    return reply.code(204).send();
  });
  app.post(recovery + '/reset', body({ token, password }, { code: authenticatorCode }), async (request, reply) => {
    const result = await resetDirectionPassword(pool, totpKey, request.body);
    if (result === needsAuthenticator) return reply.code(428).send({ error: 'Code de double authentification requis.' });
    if (!result) securityError(400);
    return reply.clearCookie(cookieName, cookieOptions).code(204).send();
  });
}
