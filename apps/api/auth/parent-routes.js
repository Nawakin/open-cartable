import rateLimit from '@fastify/rate-limit';
import cookie from '@fastify/cookie';
import { eventCalendar } from '../agenda/ical.js';
import { agendaPeriod, agendaQuerySchema, readAgendaCursor, remindersQuerySchema } from '../agenda/period.js';
import { invitationCodePattern, issueAccessToken, refreshTokenPattern, schoolCodePattern, uuidPattern, verifyAccessToken } from './credentials.js';
import { parentSessionSeconds } from './parent-store.js';
import { homeworkQuerySchema, readPeriod } from '../homework/period.js';
import { registerParentMessages } from '../messaging/routes.js';
import { registerParentLiaison } from '../liaison/routes.js';
import { registerParentBlog } from '../blog/routes.js';

const browserCookie = '__Host-open-cartable';
const cookieOptions = { path: '/', httpOnly: true, secure: true, sameSite: 'strict' };

function jsonBody(fields) {
  return {
    type: 'object',
    required: Object.keys(fields),
    additionalProperties: false,
    properties: Object.fromEntries(Object.entries(fields).map(([name, pattern]) => [
      name, { type: 'string', pattern: pattern.source },
    ])),
  };
}

function unauthorized(reply) {
  return reply.code(401).send({ error: 'Identifiants non valides.' });
}

export async function parentRoutes(app, { store, signingKey, webOrigin }) {
  await app.register(rateLimit, { global: false, cache: 10_000 });
  if (webOrigin) await app.register(cookie);
  app.addHook('onRequest', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
  });
  app.setErrorHandler((error, _request, reply) => {
    if (error.statusCode === 429) return reply.code(429).send({ error: 'Trop de tentatives. Réessayez plus tard.' });
    if (error.statusCode >= 400 && error.statusCode < 500) {
      return reply.code(error.statusCode).send({ error: 'Requête non valide.' });
    }
    return reply.code(500).send({ error: 'Erreur du serveur.' });
  });

  async function signIn(reply, result) {
    if (!result) return unauthorized(reply);
    const access = await issueAccessToken(signingKey, result.session);
    return { ...access, refreshToken: result.refreshToken };
  }

  function bearerIdentity(request) {
    const match = /^Bearer (\S+)$/i.exec(request.headers.authorization ?? '');
    return verifyAccessToken(signingKey, match?.[1]);
  }

  function browserIdentity(request) {
    const token = request.cookies?.[browserCookie];
    return typeof token === 'string' && refreshTokenPattern.test(token) ? store.browserIdentity(token) : null;
  }

  function parentIdentity(request) {
    return request.headers.authorization === undefined && webOrigin
      ? browserIdentity(request) : bearerIdentity(request);
  }

  function authenticated(operation, success = 200) {
    return async (request, reply) => {
      const claims = await parentIdentity(request);
      if (!claims) return unauthorized(reply);
      const result = await store.withParentSession(claims, (db, actor) => operation(request, db, actor));
      if (!result.authorized) return unauthorized(reply);
      if (result.value === null) return reply.code(404).send({ error: 'Ressource introuvable.' });
      return reply.code(success).send(result.value);
    };
  }

  const writes = {
    async onRequest(request, reply) {
      if (request.headers.authorization !== undefined) return;
      if (!webOrigin || request.headers.origin !== webOrigin) {
        return reply.code(403).send({ error: 'Origine non autorisée.' });
      }
    },
  };
  registerParentMessages(app, { authenticated, writes });
  registerParentLiaison(app, { authenticated, writes });
  registerParentBlog(app, { authenticated });

  const invitationOptions = {
    bodyLimit: 1024,
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    schema: { body: jsonBody({ schoolCode: schoolCodePattern, code: invitationCodePattern }) },
  };

  app.post('/parent/auth/invitations/redeem', invitationOptions, async (request, reply) => {
    const { schoolCode, code } = request.body;
    return signIn(reply, await store.redeem(schoolCode, code));
  });

  app.post('/parent/auth/refresh', {
    bodyLimit: 1024,
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    schema: { body: jsonBody({ refreshToken: refreshTokenPattern }) },
  }, async (request, reply) => signIn(reply, await store.rotate(request.body.refreshToken)));

  app.post('/parent/auth/logout', { bodyLimit: 1024 }, async (request, reply) => {
    if (request.headers.authorization === undefined) {
      const token = request.body?.refreshToken;
      if (typeof token !== 'string' || !refreshTokenPattern.test(token)) return unauthorized(reply);
      await store.revokeRefreshToken(token);
      return reply.code(204).send();
    }
    const claims = await bearerIdentity(request);
    if (!claims) return unauthorized(reply);
    await store.revoke(claims);
    return reply.code(204).send();
  });

  if (webOrigin) {
    async function requireWebOrigin(request, reply) {
      if (request.headers.origin !== webOrigin) {
        return reply.code(403).send({ error: 'Origine de la requête non autorisée.' });
      }
    }

    app.post('/parent/web/auth/login', { ...invitationOptions, onRequest: requireWebOrigin }, async (request, reply) => {
      const { schoolCode, code } = request.body;
      const result = await store.redeem(schoolCode, code, { browser: true });
      if (!result) return unauthorized(reply);
      return reply.setCookie(browserCookie, result.browserToken, {
        ...cookieOptions, maxAge: parentSessionSeconds,
      }).code(204).send();
    });

    app.post('/parent/web/auth/logout', { onRequest: requireWebOrigin }, async (request, reply) => {
      const claims = await browserIdentity(request);
      if (claims) await store.revoke(claims);
      return reply.clearCookie(browserCookie, cookieOptions).code(204).send();
    });
  }

  app.get('/parent/children', {
    schema: {
      response: {
        200: {
          type: 'object',
          required: ['children'],
          properties: {
            children: {
              type: 'array',
              items: {
                type: 'object',
                required: ['id', 'displayName', 'className'],
                properties: { id: { type: 'string' }, displayName: { type: 'string' }, className: { type: 'string' } },
              },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    const claims = await parentIdentity(request);
    if (!claims) return unauthorized(reply);
    const children = await store.children(claims);
    if (!children) return unauthorized(reply);
    return { children };
  });

  app.get('/parent/tutor-reference', async (request, reply) => {
    const claims = await parentIdentity(request);
    if (!claims) return unauthorized(reply);
    const reference = await store.tutorReference(claims);
    return reference ? { reference } : unauthorized(reply);
  });

  app.get('/parent/agenda/reminders', { schema: { querystring: remindersQuerySchema } }, async (request, reply) => {
    const claims = await parentIdentity(request);
    if (!claims) return unauthorized(reply);
    const page = readAgendaCursor(request.query.cursor);
    if (!page) return reply.code(400).send({ error: 'Page non valide.' });
    const reminders = await store.agendaReminders(claims, page);
    return reminders ?? unauthorized(reply);
  });

  app.get('/parent/children/:childId/homework', {
    schema: {
      params: jsonBody({ childId: uuidPattern }),
      querystring: homeworkQuerySchema,
    },
  }, async (request, reply) => {
    const claims = await parentIdentity(request);
    if (!claims) return unauthorized(reply);
    const period = readPeriod(request.query);
    if (!period) return reply.code(400).send({ error: 'Période ou page non valide.' });

    const { authenticated, child, entries, nextCursor } = await store.homework(claims, request.params.childId, period);
    if (!authenticated) return unauthorized(reply);
    if (!child) return reply.code(404).send({ error: 'Enfant introuvable.' });
    return { child, entries, nextCursor };
  });

  const calendar = '/parent/children/:childId/agenda';
  app.get(calendar, {
    schema: { params: jsonBody({ childId: uuidPattern }), querystring: agendaQuerySchema },
  }, async (request, reply) => {
    const claims = await parentIdentity(request);
    if (!claims) return unauthorized(reply);
    const period = agendaPeriod(request.query);
    if (!period) return reply.code(400).send({ error: 'Période ou page non valide.' });
    const { authenticated, child, events, nextCursor } = await store.agenda(claims, request.params.childId, period);
    if (!authenticated) return unauthorized(reply);
    if (!child) return reply.code(404).send({ error: 'Enfant introuvable.' });
    return { child, events, nextCursor };
  });

  app.get(calendar + '/:eventId/ical', {
    schema: { params: jsonBody({ childId: uuidPattern, eventId: uuidPattern }) },
  }, async (request, reply) => {
    const claims = await parentIdentity(request);
    if (!claims) return unauthorized(reply);
    const { childId, eventId } = request.params;
    const { authenticated, event } = await store.agendaEvent(claims, childId, eventId);
    if (!authenticated) return unauthorized(reply);
    if (!event) return reply.code(404).send({ error: 'Événement introuvable.' });
    return reply.type('text/calendar; charset=utf-8')
      .header('Content-Disposition', 'attachment; filename="open-cartable-agenda.ics"')
      .header('X-Content-Type-Options', 'nosniff')
      .send(eventCalendar(event));
  });
}
