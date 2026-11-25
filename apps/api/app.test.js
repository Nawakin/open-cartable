import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildApp } from './app.js';

test('le point de contrôle répond sans révéler la configuration', async (context) => {
  const app = buildApp();
  context.after(() => app.close());

  const response = await app.inject('/healthz');

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.deepEqual(response.json(), { status: 'ok' });
});

test('le parcours parent reste désactivé sans configuration', async (context) => {
  const app = buildApp();
  context.after(() => app.close());

  const response = await app.inject('/api/v1/parent/children');

  assert.equal(response.statusCode, 404);
});
