import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

test('le site exporté est servi avec ses en-têtes de sécurité', async (context) => {
  const webRoot = await mkdtemp(join(tmpdir(), 'open-cartable-site-'));
  const app = buildApp({ webRoot });
  context.after(async () => {
    await app.close();
    await rm(webRoot, { recursive: true });
  });
  await writeFile(join(webRoot, 'index.html'), '<title>Open Cartable</title>');

  const response = await app.inject('/');
  assert.equal(response.statusCode, 200);
  assert.match(response.headers['content-security-policy'], /frame-ancestors 'none'/);
  assert.equal(response.headers['x-content-type-options'], 'nosniff');
  assert.equal(response.body, '<title>Open Cartable</title>');
});
