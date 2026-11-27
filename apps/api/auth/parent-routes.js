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
import { registerFamilyPhotoAuthorizations } from '../photo-authorizations/routes.js';
import { registerSchoolBanner } from '../school-banner/routes.js';
import { registerParentAttendance } from '../attendance/routes.js';
import { registerParentJustifications } from '../attendance/justifications.js';
import { registerParentReports } from '../school-reports/routes.js';
import { registerParentHomeworkAttachments } from '../homework/attachments.js';
import { registerParentMedia } from '../files/class-media.js';
import { registerParentPush } from '../notifications/web-push.js';
import { registerNativePush } from '../notifications/native-routes.js';
import { registerParentAccountLink } from './account-links.js';
import { cookieOptions, parentCookieName as browserCookie, webSessionToken } from './staff-web.js';

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

export async function parentRoutes(app, { store, signingKey, webOrigin, blogMediaKey, webPush, nativePush }) {
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

  async function browserIdentity(request, reply) {
    const token = webSessionToken(request, browserCookie);
    if (!token) return null;
    const identity = await store.browserIdentity(token, Boolean(reply));
    if (identity?.renewed) reply.setCookie(browserCookie, token, { ...cookieOptions, maxAge: parentSessionSeconds });
    return identity;
  }

  function parentIdentity(request, reply) {
    return request.headers.authorization === undefined && webOrigin
      ? browserIdentity(request, reply) : bearerIdentity(request);
  }

  function authenticated(operation, success = 200, identify = parentIdentity) {
    return async (request, reply) => {
      const claims = await identify(request, reply);
      if (!claims) return unauthorized(reply);
      const result = await store.withParentSession(claims, (db, actor) => operation(request, db, actor, reply, claims));
      if (!result.authorized) return unauthorized(reply);
      if (result.value === null) return reply.code(404).send({ error: 'Ressource introuvable.' });
      return reply.code(reply.statusCode === 200 ? success : reply.statusCode).send(result.value);
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
  registerParentMessages(app, { authenticated, writes, key: blogMediaKey });
  registerParentHomeworkAttachments(app, authenticated, blogMediaKey);
  registerParentMedia(app, authenticated, blogMediaKey);
  registerParentLiaison(app, { authenticated, writes });
  registerParentBlog(app, { authenticated, mediaKey: blogMediaKey });
  registerFamilyPhotoAuthorizations(app, authenticated);
  registerSchoolBanner(app, '/parent', authenticated);
  registerParentAttendance(app, authenticated);
  registerParentJustifications(app, authenticated, writes, blogMediaKey);
  registerParentReports(app, authenticated);
  if (nativePush) registerNativePush(app, (operation, success) => authenticated(operation, success, bearerIdentity), nativePush);

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

    registerParentAccountLink(app, (operation, success) => authenticated(operation, success, browserIdentity), requireWebOrigin);
    if (webPush) registerParentPush(app, (operation, success) => authenticated(operation, success, browserIdentity), requireWebOrigin, webPush);

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
    const claims = await parentIdentity(request, reply);
    if (!claims) return unauthorized(reply);
    const children = await store.children(claims);
    if (!children) return unauthorized(reply);
    return { children };
  });

  app.get('/parent/tutor-reference', async (request, reply) => {
    const claims = await parentIdentity(request, reply);
    if (!claims) return unauthorized(reply);
    const reference = await store.tutorReference(claims);
    return reference ? { reference } : unauthorized(reply);
  });

  app.get('/parent/agenda/reminders', { schema: { querystring: remindersQuerySchema } }, async (request, reply) => {
    const claims = await parentIdentity(request, reply);
    if (!claims) return unauthorized(reply);
    const page = readAgendaCursor(request.query.cursor);
    if (!page) return reply.code(400).send({ error: 'Page non valide.' });
    const reminders = await store.agendaReminders(claims, page);
    return reminders ?? unauthorized(reply);
  });

  app.get('/parent/assignments/next', authenticated(async (_request, db, actor) => {
    const { rows } = await db.query(`
      WITH calendar AS (SELECT (statement_timestamp() AT TIME ZONE 'Europe/Paris')::date AS today)
      SELECT h.id, h.title, h.domain, h.entry_date::text AS date,
        json_build_object('id',s.id,'displayName',s.display_name,'className',c.name) AS child
      FROM guardian_students l JOIN students s ON (s.school_id,s.id) = (l.school_id,l.student_id)
      JOIN classes c ON (c.school_id,c.id) = (s.school_id,s.class_id)
      JOIN homework_entries h ON (h.school_id,h.class_id) = (c.school_id,c.id)
      CROSS JOIN calendar
      WHERE (l.school_id,l.guardian_id) = ($1,$2) AND s.left_at IS NULL AND c.archived_year IS NULL
        AND h.kind = 'assignment' AND h.entry_date BETWEEN today AND today + 13
      ORDER BY h.entry_date,s.display_name,h.id,s.id LIMIT 12
    `, [actor.school_id, actor.guardian_id]);
    return { assignments: rows };
  }));

  app.get('/parent/children/:childId/homework', {
    schema: {
      params: jsonBody({ childId: uuidPattern }),
      querystring: homeworkQuerySchema,
    },
  }, async (request, reply) => {
    const claims = await parentIdentity(request, reply);
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
    const claims = await parentIdentity(request, reply);
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
    const claims = await parentIdentity(request, reply);
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
