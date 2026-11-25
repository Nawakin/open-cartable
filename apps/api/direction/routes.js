import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import { refreshTokenPattern, schoolCodePattern, uuidPattern } from '../auth/credentials.js';
import { createEntry, deleteEntry, listClassEntries, readEntry, updateEntry } from '../homework/entries.js';
import { homeworkQuerySchema, readPeriod } from '../homework/period.js';
import { passwordLimits } from './password.js';
import { directionSessionSeconds, signInDirection, signOutDirection, withDirectionSession } from './store.js';

const cookieName = '__Host-open-cartable-direction';
const cookieOptions = { path: '/', httpOnly: true, secure: true, sameSite: 'strict' };
const uuid = { type: 'string', pattern: uuidPattern.source };
const classParams = {
  type: 'object', required: ['classId'], additionalProperties: false, properties: { classId: uuid },
};
const entryParams = {
  type: 'object', required: ['classId', 'entryId'],
  additionalProperties: false, properties: { classId: uuid, entryId: uuid },
};

function unauthorized(reply) {
  return reply.code(401).send({ error: 'Identifiants non valides.' });
}

function tokenFor(request) {
  const token = request.cookies[cookieName];
  return typeof token === 'string' && refreshTokenPattern.test(token) ? token : null;
}

function requireEntry(input) {
  const entry = readEntry(input);
  if (!entry) throw Object.assign(new Error('Entrée non valide.'), { statusCode: 400 });
  return entry;
}

export async function directionRoutes(app, { pool, webOrigin }) {
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

  function schoolRoute(operation, success = 200) {
    return async (request, reply) => {
      const token = tokenFor(request);
      if (!token) return unauthorized(reply);
      const result = await withDirectionSession(pool, token, (db, school) => operation(request, db, school));
      if (!result.authorized) return unauthorized(reply);
      if (result.value === null) return reply.code(404).send({ error: 'Classe ou entrée introuvable.' });
      return reply.code(success).send(result.value);
    };
  }

  app.post('/direction/auth/login', {
    bodyLimit: 2048,
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    schema: {
      body: {
        type: 'object', required: ['schoolCode', 'password'], additionalProperties: false,
        properties: {
          schoolCode: { type: 'string', pattern: schoolCodePattern.source },
          password: { type: 'string', ...passwordLimits },
        },
      },
    },
  }, async (request, reply) => {
    const { schoolCode, password } = request.body;
    const token = await signInDirection(pool, schoolCode, password);
    if (!token) return unauthorized(reply);
    return reply.setCookie(cookieName, token, { ...cookieOptions, maxAge: directionSessionSeconds }).code(204).send();
  });

  app.post('/direction/auth/logout', async (request, reply) => {
    const token = tokenFor(request);
    if (token) await signOutDirection(pool, token);
    return reply.clearCookie(cookieName, cookieOptions).code(204).send();
  });

  app.get('/direction/classes', schoolRoute(async (_request, db, school) => {
    const { rows } = await db.query('SELECT id, name FROM classes WHERE school_id = $1 ORDER BY name, id', [school.school_id]);
    return { schoolName: school.school_name ?? school.school_code, classes: rows };
  }));

  const classPath = '/direction/classes/:classId/homework';
  app.get(classPath, {
    schema: { params: classParams, querystring: homeworkQuerySchema },
  }, schoolRoute((request, db, school) => {
    const period = readPeriod(request.query);
    if (!period) throw Object.assign(new Error('Période non valide.'), { statusCode: 400 });
    return listClassEntries(db, school.school_id, request.params.classId, period);
  }));

  app.post(classPath, { bodyLimit: 32 * 1024, schema: { params: classParams } },
    schoolRoute(async (request, db, school) => {
      const id = await createEntry(db, school.school_code, request.params.classId, requireEntry(request.body));
      return id ? { id } : null;
    }, 201));

  app.put(classPath + '/:entryId', { bodyLimit: 32 * 1024, schema: { params: entryParams } },
    schoolRoute(async (request, db, school) => {
      const { classId, entryId } = request.params;
      const updated = await updateEntry(db, school.school_code, classId, entryId, requireEntry(request.body));
      return updated ? undefined : null;
    }, 204));

  app.delete(classPath + '/:entryId', { schema: { params: entryParams } },
    schoolRoute(async (request, db, school) => {
      const { classId, entryId } = request.params;
      const removed = await deleteEntry(db, school.school_code, classId, entryId);
      return removed ? undefined : null;
    }, 204));
}
