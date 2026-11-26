import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { parentRoutes } from './auth/parent-routes.js';
import { installationRoutes } from './installation/setup.js';
import { directionRoutes } from './direction/routes.js';
import { teacherRoutes } from './teacher/routes.js';

export function buildApp({ parentAuth, webRoot, installation, direction, blogMediaKey, webPush } = {}) {
  const app = Fastify({
    trustProxy: false,
    bodyLimit: 64 * 1024,
    ajv: { customOptions: { coerceTypes: false, removeAdditional: false } },
  });
  app.get('/healthz', async (_request, reply) => {
    return reply.header('Cache-Control', 'no-store').send({ status: 'ok' });
  });
  if (parentAuth) {
    app.register(parentRoutes, { prefix: '/api/v1', ...parentAuth, blogMediaKey, webPush });
  }
  if (installation) app.register(installationRoutes, { prefix: '/api/v1', ...installation });
  if (direction) {
    app.register(directionRoutes, { prefix: '/api/v1', ...direction, blogMediaKey });
    app.register(teacherRoutes, { prefix: '/api/v1', ...direction, blogMediaKey });
  }
  if (webRoot) {
    app.register(fastifyStatic, {
      root: webRoot,
      setHeaders(reply) {
        reply.headers({
          'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; object-src 'none'; form-action 'self'",
          'X-Content-Type-Options': 'nosniff',
          'Referrer-Policy': 'no-referrer',
        });
      },
    });
  }
  return app;
}
