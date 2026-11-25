import rateLimit from '@fastify/rate-limit';
import { invitationCodePattern, issueAccessToken, refreshTokenPattern, schoolCodePattern, verifyAccessToken } from './credentials.js';

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

export async function parentRoutes(app, { store, signingKey }) {
  await app.register(rateLimit, { global: false, cache: 10_000 });
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

  function identity(request) {
    const match = /^Bearer (\S+)$/i.exec(request.headers.authorization ?? '');
    return verifyAccessToken(signingKey, match?.[1]);
  }

  app.post('/parent/auth/invitations/redeem', {
    bodyLimit: 1024,
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    schema: { body: jsonBody({ schoolCode: schoolCodePattern, code: invitationCodePattern }) },
  }, async (request, reply) => {
    const { schoolCode, code } = request.body;
    return signIn(reply, await store.redeem(schoolCode, code));
  });

  app.post('/parent/auth/refresh', {
    bodyLimit: 1024,
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    schema: { body: jsonBody({ refreshToken: refreshTokenPattern }) },
  }, async (request, reply) => signIn(reply, await store.rotate(request.body.refreshToken)));

  app.post('/parent/auth/logout', async (request, reply) => {
    const claims = await identity(request);
    if (!claims) return unauthorized(reply);
    await store.revoke(claims);
    return reply.code(204).send();
  });

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
    const claims = await identity(request);
    if (!claims) return unauthorized(reply);
    const children = await store.children(claims);
    if (!children) return unauthorized(reply);
    return { children };
  });
}
