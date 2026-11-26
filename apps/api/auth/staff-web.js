import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import { refreshTokenPattern, uuidPattern } from './credentials.js';

export const cookieOptions = { path: '/', httpOnly: true, secure: true, sameSite: 'strict' };
export const parentCookieName = '__Host-open-cartable';
export const teacherCookieName = '__Host-open-cartable-teacher';
export const authRateLimit = { rateLimit: { max: 5, timeWindow: '1 minute' } };

export function webSessionToken(request, cookieName) {
  const token = request.cookies?.[cookieName];
  return typeof token === 'string' && refreshTokenPattern.test(token) ? token : null;
}

export function unauthorized(reply) {
  return reply.code(401).send({ error: 'Identifiants non valides.' });
}

export function uuidParams(...names) {
  const uuid = { type: 'string', pattern: uuidPattern.source };
  return {
    type: 'object', required: names, additionalProperties: false,
    properties: Object.fromEntries(names.map((name) => [name, uuid])),
  };
}

export async function registerStaffWeb(app, { webOrigin, cookieName, withSession }) {
  await app.register(cookie);
  await app.register(rateLimit, { global: false, cache: 10_000 });
  app.addHook('onRequest', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    if (request.method !== 'GET' && request.method !== 'HEAD' && request.headers.origin !== webOrigin) {
      return reply.code(403).send({ error: 'Origine non autorisée.' });
    }
  });
  app.setErrorHandler((error, _request, reply) => {
    if (error.statusCode === 429) return reply.code(429).send({ error: 'Trop de tentatives. Réessayez plus tard.' });
    if (error.statusCode >= 400 && error.statusCode < 500) {
      return reply.code(error.statusCode).send({ error: 'Requête non valide.' });
    }
    return reply.code(500).send({ error: 'L’opération a échoué.' });
  });

  function tokenFor(request) {
    return webSessionToken(request, cookieName);
  }

  function authenticated(operation, success = 200, options) {
    return async (request, reply) => {
      const token = tokenFor(request);
      if (!token) return unauthorized(reply);
      const result = await withSession(token, (db, actor) => operation(request, db, actor, reply), options);
      if (!result.authorized) return unauthorized(reply);
      if (result.value === null) return reply.code(404).send({ error: 'Ressource introuvable.' });
      return reply.code(reply.statusCode === 200 ? success : reply.statusCode).send(result.value);
    };
  }

  return { tokenFor, authenticated };
}
