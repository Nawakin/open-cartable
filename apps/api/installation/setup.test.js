import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import pg from 'pg';
import { buildApp } from '../app.js';
import { createParentStore } from '../auth/parent-store.js';
import { migrate, openDatabase } from '../db/database.js';

const databaseUrl = process.env.TEST_DATABASE_URL;

test('le premier lancement crée une seule école et permet la connexion du tuteur', { skip: !databaseUrl }, async (context) => {
  const schema = 'installation_test_' + randomUUID().replaceAll('-', '');
  const admin = openDatabase(databaseUrl);
  const pool = new pg.Pool({ connectionString: databaseUrl, options: '-c search_path=' + schema });
  const invitationKey = randomBytes(32);
  const token = randomBytes(32).toString('hex');
  const webOrigin = 'https://ent.ecole.example';
  const app = buildApp({
    parentAuth: { signingKey: randomBytes(32), store: createParentStore(pool, invitationKey), webOrigin },
    installation: { pool, token, invitationKey, webOrigin },
  });
  context.after(async () => {
    await app.close();
    await pool.end();
    try {
      await admin.query('DROP SCHEMA IF EXISTS ' + schema + ' CASCADE');
    } finally {
      await admin.end();
    }
  });
  await admin.query('CREATE SCHEMA ' + schema);
  assert.equal((await pool.query('SELECT current_schema() AS name')).rows[0].name, schema);
  await migrate(pool);

  const status = await app.inject('/api/v1/installation');
  assert.deepEqual(status.json(), { installed: false });
  assert.equal(status.headers['cache-control'], 'no-store');

  const form = {
    token, schoolCode: 'ECOLE-TEST', schoolName: 'École fictive', className: 'Classe fictive', studentName: 'Élève fictif',
    directionPassword: randomBytes(24).toString('base64url'),
  };
  const submit = (payload = form, origin = webOrigin) => app.inject({
    method: 'POST', url: '/api/v1/installation', headers: { origin }, payload,
  });
  assert.equal((await submit(form, 'https://autre.ecole.example')).statusCode, 403);
  assert.equal((await submit({ ...form, token: randomBytes(32).toString('hex') })).statusCode, 403);
  assert.equal((await submit({ ...form, schoolName: '   ' })).statusCode, 400);

  const submissions = await Promise.all([submit(), submit()]);
  assert.deepEqual(submissions.map((response) => response.statusCode).sort(), [201, 409]);
  assert.deepEqual((await app.inject('/api/v1/installation')).json(), { installed: true });
  assert.equal((await pool.query('SELECT count(*)::int AS total FROM schools')).rows[0].total, 1);
  const created = submissions.find((response) => response.statusCode === 201);
  const { schoolCode, code } = created.json();
  assert.equal(created.headers['cache-control'], 'no-store');
  assert.equal(schoolCode, form.schoolCode);
  assert.equal(created.body.includes(token), false);

  const login = await app.inject({
    method: 'POST', url: '/api/v1/parent/web/auth/login', headers: { origin: webOrigin }, payload: { schoolCode, code },
  });
  assert.equal(login.statusCode, 204);
  const cookie = login.headers['set-cookie'].split(';')[0];
  const roster = await app.inject({ url: '/api/v1/parent/children', headers: { cookie } });
  assert.deepEqual(roster.json().children.map(({ displayName, className }) => [displayName, className]), [
    [form.studentName, form.className],
  ]);
  assert.equal((await submit()).statusCode, 409);
});
