import Fastify from 'fastify';
import { parentRoutes } from './auth/parent-routes.js';

export function buildApp({ parentAuth } = {}) {
  const app = Fastify({
    trustProxy: false,
    bodyLimit: 64 * 1024,
    ajv: { customOptions: { coerceTypes: false, removeAdditional: false } },
  });
  app.get('/healthz', async (_request, reply) => {
    return reply.header('Cache-Control', 'no-store').send({ status: 'ok' });
  });
  if (parentAuth) {
    app.register(parentRoutes, { prefix: '/api/v1', ...parentAuth });
  }
  return app;
}
