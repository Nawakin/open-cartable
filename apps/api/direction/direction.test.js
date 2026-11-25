import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import pg from 'pg';
import { buildApp } from '../app.js';
import { createParentStore } from '../auth/parent-store.js';
import { migrate, openDatabase, transaction } from '../db/database.js';
import { demo, seedDemo } from '../db/demo.js';
import { hashPassword } from '../auth/password.js';
import { setDirectionPassword } from './store.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const webOrigin = 'https://ent.ecole.example';

test('la direction publie uniquement dans son école avec une session distincte', { skip: !databaseUrl }, async (context) => {
  const schema = 'direction_test_' + randomUUID().replaceAll('-', '');
  const admin = openDatabase(databaseUrl);
  const pool = new pg.Pool({ connectionString: databaseUrl, options: '-c search_path=' + schema });
  const store = createParentStore(pool, randomBytes(32));
  const app = buildApp({
    parentAuth: { store, signingKey: randomBytes(32), webOrigin },
    direction: { pool, webOrigin },
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
  await seedDemo(pool);

  const schoolCode = demo.school.code;
  const password = randomBytes(24).toString('base64url');
  const credential = await hashPassword(password);
  await transaction(pool, (db) => setDirectionPassword(db, demo.school.id, credential));

  const foreignSchool = randomUUID();
  const foreignClass = randomUUID();
  await pool.query('INSERT INTO schools (id, code) VALUES ($1, $2)', [foreignSchool, 'AUTRE-ECOLE']);
  await pool.query('INSERT INTO classes (school_id, id, name) VALUES ($1, $2, $3)',
    [foreignSchool, foreignClass, 'Autre classe fictive']);

  const call = (method, path, { cookie, payload, origin = webOrigin, remoteAddress } = {}) => app.inject({
    method, url: '/api/v1/direction' + path, payload, remoteAddress,
    headers: { origin, ...(cookie ? { cookie } : {}) },
  });
  const login = (payload, options) => call('POST', '/auth/login', { ...options, payload });
  const credentials = { schoolCode, password };

  const invalid = await login({ ...credentials, password: randomBytes(24).toString('base64url') });
  const unknown = await login({ ...credentials, schoolCode: 'INCONNUE' });
  assert.equal(invalid.statusCode, 401);
  assert.equal(unknown.statusCode, 401);
  assert.deepEqual(invalid.json(), unknown.json());
  assert.equal((await login(credentials, { origin: 'https://autre.ecole.example' })).statusCode, 403);

  const directionLogin = await login(credentials);
  assert.equal(directionLogin.statusCode, 204);
  assert.equal(directionLogin.headers['cache-control'], 'no-store');
  const setCookie = directionLogin.headers['set-cookie'];
  assert.match(setCookie, /^__Host-open-cartable-direction=[A-Za-z0-9_-]{43};/);
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /Secure/);
  assert.match(setCookie, /SameSite=Strict/);
  const cookie = setCookie.split(';')[0];
  const classes = await call('GET', '/classes', { cookie });
  assert.deepEqual(classes.json().classes, demo.classes);
  assert.equal((await app.inject({ url: '/api/v1/parent/children', headers: { cookie } })).statusCode, 401);

  const { code } = await store.invite(schoolCode, demo.guardians[0]);
  const parentLogin = await app.inject({
    method: 'POST', url: '/api/v1/parent/web/auth/login', headers: { origin: webOrigin }, payload: { schoolCode, code },
  });
  assert.equal(parentLogin.statusCode, 204);
  const parentCookie = parentLogin.headers['set-cookie'].split(';')[0];
  const classId = demo.classes[0].id;
  const classPath = `/classes/${classId}/homework`;
  const foreignPath = `/classes/${foreignClass}/homework`;
  const period = '?from=2026-11-01&to=2026-11-30';
  const entry = { date: '2026-11-25', title: 'Fiche fictive', domain: 'Français', description: 'Texte de test' };
  assert.equal((await call('POST', classPath, { cookie: parentCookie, payload: entry })).statusCode, 401);
  assert.equal((await call('POST', classPath, { cookie, payload: entry, origin: 'https://autre.ecole.example' })).statusCode, 403);
  assert.equal((await call('GET', foreignPath + period, { cookie })).statusCode, 404);
  assert.equal((await call('POST', foreignPath, { cookie, payload: entry })).statusCode, 404);
  assert.equal((await call('POST', classPath, { cookie, payload: { ...entry, date: '2026-11-31' } })).statusCode, 400);

  const published = await call('POST', classPath, { cookie, payload: entry });
  assert.equal(published.statusCode, 201);
  const { id } = published.json();
  const entryPath = classPath + '/' + id;
  assert.deepEqual((await call('GET', classPath + period, { cookie })).json().entries, [{ id, ...entry }]);
  assert.equal((await call('PUT', foreignPath + '/' + id, { cookie, payload: entry })).statusCode, 404);
  assert.equal((await call('DELETE', foreignPath + '/' + id, { cookie })).statusCode, 404);

  const parentPath = `/api/v1/parent/children/${demo.students[0].id}/homework${period}`;
  const parentEntries = async () => (await app.inject({ url: parentPath, headers: { cookie: parentCookie } })).json().entries;
  assert.deepEqual(await parentEntries(), [{ id, ...entry }]);
  const edited = { ...entry, title: 'Fiche modifiée' };
  assert.equal((await call('PUT', entryPath, { cookie, payload: edited })).statusCode, 204);
  assert.deepEqual(await parentEntries(), [{ id, ...edited }]);
  assert.equal((await call('DELETE', entryPath, { cookie })).statusCode, 204);
  assert.deepEqual(await parentEntries(), []);

  const replacement = randomBytes(24).toString('base64url');
  const updatedCredential = await hashPassword(replacement);
  await transaction(pool, (db) => setDirectionPassword(db, demo.school.id, updatedCredential));
  assert.equal((await call('GET', '/classes', { cookie })).statusCode, 401);
  assert.equal((await login(credentials, { remoteAddress: '192.0.2.9' })).statusCode, 401);
  const secondLogin = await login({ schoolCode, password: replacement }, { remoteAddress: '192.0.2.9' });
  assert.equal(secondLogin.statusCode, 204);
  const secondCookie = secondLogin.headers['set-cookie'].split(';')[0];
  assert.equal((await call('POST', '/auth/logout', { cookie: secondCookie })).statusCode, 204);
  assert.equal((await call('GET', '/classes', { cookie: secondCookie })).statusCode, 401);
});
