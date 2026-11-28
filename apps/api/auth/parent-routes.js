import { linkedChildClass } from './class-access.js';
import { deviceCodePatterns, deviceMetadata, registerAccountDevices } from '../devices/store.js';
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

import { registerParentActivities } from '../school-life/activities.js';
import { registerParentPlannedAbsences } from '../school-life/absences.js';
import { nextAssignments, registerParentHome } from '../school-life/home.js';

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

export async function parentRoutes(app, { store, signingKey, webOrigin, blogMediaKey, webPush, nativePush, pairingKey }) {
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
  registerAccountDevices(app, '/parent', { role: 'parent', authenticated, writes, key: pairingKey });
  registerParentActivities(app, { authenticated, writes, key: blogMediaKey });
  registerParentPlannedAbsences(app, { authenticated, writes });
  registerParentHome(app, authenticated);
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

  const pairingOptions = {
    ...invitationOptions, config: { rateLimit: { max: 6, timeWindow: '1 minute' } },
    schema: { body: jsonBody({ schoolCode: schoolCodePattern, code: new RegExp(deviceCodePatterns.parent) }) },
  };
  if (pairingKey) app.post('/parent/auth/device-link', pairingOptions, async (request, reply) =>
    signIn(reply, await store.pairDevice(request.body.schoolCode, request.body.code, false, deviceMetadata(request))));

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

    if (pairingKey) app.post('/parent/web/auth/device-link', { ...pairingOptions, onRequest: requireWebOrigin }, async (request, reply) => {
      const result = await store.pairDevice(request.body.schoolCode, request.body.code, true, deviceMetadata(request));
      if (!result) return unauthorized(reply);
      return reply.setCookie(browserCookie, result.browserToken, { ...cookieOptions, maxAge: parentSessionSeconds }).code(204).send();
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
    await store.seenDevice(claims.sessionId, deviceMetadata(request));
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

  app.get('/parent/assignments/next', authenticated(async (_request, db, actor) =>
    ({ assignments: await nextAssignments(db, actor) })));

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

  app.get('/parent/children/:childId/homework/:entryId', {
    schema: { params: jsonBody({ childId: uuidPattern, entryId: uuidPattern }) },
  }, authenticated(async ({ params }, db, actor) => {
    const childClass = await linkedChildClass(db, actor, params.childId);
    if (!childClass) return null;
    const { rows: [entry] } = await db.query(`
      SELECT id,entry_date::text AS date,title,domain,description,kind,attachment_kind IS NOT NULL AS "hasDocument"
      FROM homework_entries WHERE (school_id,class_id,id)=($1,$2,$3) AND publish_at<=statement_timestamp()
    `, [actor.school_id, childClass, params.entryId]);
    return entry ?? null;
  }));

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

  app.get(calendar + '/:eventId', {
    schema: { params: jsonBody({ childId: uuidPattern, eventId: uuidPattern }) },
  }, async (request, reply) => {
    const claims = await parentIdentity(request, reply);
    if (!claims) return unauthorized(reply);
    const { childId, eventId } = request.params;
    const { authenticated, event } = await store.agendaEvent(claims, childId, eventId);
    if (!authenticated) return unauthorized(reply);
    return event ?? reply.code(404).send({ error: 'Événement introuvable.' });
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
