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

test('les données élèves ne sont pas exposées par le socle', async (context) => {
  const app = buildApp();
  context.after(() => app.close());

  const response = await app.inject('/api/v1/eleves');

  assert.equal(response.statusCode, 404);
});
