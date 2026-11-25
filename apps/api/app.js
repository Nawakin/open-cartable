import Fastify from 'fastify';

export function buildApp() {
  const app = Fastify({ trustProxy: false, bodyLimit: 64 * 1024 });
  app.get('/healthz', async (_request, reply) => {
    return reply.header('Cache-Control', 'no-store').send({ status: 'ok' });
  });
  return app;
}
