import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import pg from 'pg';
import { buildApp } from '../app.js';
import { hashPassword } from '../auth/password.js';
import { migrate, openDatabase, transaction } from '../db/database.js';
import { demo, seedDemo } from '../db/demo.js';
import { setDirectionPassword } from '../direction/store.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const webOrigin = 'https://ent.ecole.example';

test('l’activation et les affectations limitent les droits de l’enseignant à ses classes', { skip: !databaseUrl }, async (context) => {
  const schema = 'teacher_test_' + randomUUID().replaceAll('-', '');
  const admin = openDatabase(databaseUrl);
  const pool = new pg.Pool({ connectionString: databaseUrl, options: '-c search_path=' + schema });
  const app = buildApp({ direction: { pool, webOrigin } });
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
  const [classA, classB] = demo.classes;
  const foreignSchool = randomUUID();
  const foreignClass = randomUUID();
  await pool.query('INSERT INTO schools (id, code) VALUES ($1, $2)', [foreignSchool, 'AUTRE-ECOLE']);
  await pool.query('INSERT INTO classes (school_id, id, name) VALUES ($1, $2, $3)',
    [foreignSchool, foreignClass, 'Autre classe fictive']);
  const directionPassword = randomBytes(24).toString('base64url');
  const directionCredential = await hashPassword(directionPassword);
  await transaction(pool, (db) => setDirectionPassword(db, demo.school.id, directionCredential));
  await transaction(pool, (db) => setDirectionPassword(db, foreignSchool, directionCredential));

  let address = 0;
  const call = (method, path, { cookie, payload, origin = webOrigin } = {}) => app.inject({
    method, url: '/api/v1' + path, payload, remoteAddress: '192.0.2.' + ++address,
    headers: { origin, ...(cookie ? { cookie } : {}) },
  });
  const cookieFrom = (response) => response.headers['set-cookie'].split(';')[0];
  const directionLogin = (code) => call('POST', '/direction/auth/login', { payload: { schoolCode: code, password: directionPassword } });
  const direction = cookieFrom(await directionLogin(schoolCode));
  const foreign = cookieFrom(await directionLogin('AUTRE-ECOLE'));
  const teachersPath = '/direction/teachers';
  const login = 'enseignant-fictif';
  assert.equal((await call('POST', teachersPath, { cookie: direction, payload: { login, classIds: [foreignClass] } })).statusCode, 404);
  assert.equal((await call('POST', teachersPath, { cookie: direction, origin: 'https://autre.ecole.example', payload: { login, classIds: [classA.id] } })).statusCode, 403);
  const created = await call('POST', teachersPath, { cookie: direction, payload: { login, classIds: [classA.id] } });
  assert.equal(created.statusCode, 201);
  const { id, code } = created.json();
  assert.match(code, /^ENS-[A-Za-z0-9_-]{22}$/);
  assert.equal(created.headers['cache-control'], 'no-store');
  const list = await call('GET', teachersPath, { cookie: direction });
  assert.deepEqual(list.json().teachers, [{ id, login, classIds: [classA.id], status: 'pending' }]);
  assert.equal(list.body.includes(code), false);
  assert.equal((await call('POST', teachersPath, { cookie: direction, payload: { login, classIds: [classA.id] } })).statusCode, 409);

  const password = randomBytes(24).toString('base64url');
  const credentials = { schoolCode, login, password };
  const activate = (activation) => call('POST', '/teacher/auth/activate', { payload: { ...credentials, code: activation } });
  const signIn = () => call('POST', '/teacher/auth/login', { payload: credentials });
  assert.equal((await signIn()).statusCode, 401);
  const activations = await Promise.all([activate(code), activate(code)]);
  assert.deepEqual(activations.map(({ statusCode }) => statusCode).sort(), [204, 401]);
  const teacherLogin = await signIn();
  assert.equal(teacherLogin.statusCode, 204);
  assert.match(teacherLogin.headers['set-cookie'], /__Host-open-cartable-teacher=.*HttpOnly.*Secure.*SameSite=Strict/);
  const teacher = cookieFrom(teacherLogin);
  assert.equal((await call('GET', '/teacher/classes', { cookie: direction })).statusCode, 401);
  assert.equal((await call('GET', teachersPath, { cookie: teacher })).statusCode, 401);
  assert.deepEqual((await call('GET', '/teacher/classes', { cookie: teacher })).json().classes, [classA]);

  const homework = (classId) => '/teacher/classes/' + classId + '/homework';
  const range = '?from=2026-11-01&to=2026-11-30';
  const entry = { date: '2026-11-25', title: 'Publication fictive', domain: 'Sciences', description: 'Ressource de test.' };
  assert.equal((await call('POST', homework(classB.id), { cookie: teacher, payload: entry })).statusCode, 404);
  assert.equal((await call('GET', homework(foreignClass) + range, { cookie: teacher })).statusCode, 404);
  const published = await call('POST', homework(classA.id), { cookie: teacher, payload: entry });
  assert.equal(published.statusCode, 201);
  const entryId = published.json().id;
  const entryPath = homework(classA.id) + '/' + entryId;
  assert.equal((await call('PUT', entryPath, { cookie: teacher, payload: { ...entry, title: 'Publication corrigée' } })).statusCode, 204);

  const accountPath = teachersPath + '/' + id;
  assert.equal((await call('POST', accountPath + '/activation', { cookie: foreign })).statusCode, 404);
  assert.equal((await call('PUT', accountPath + '/classes', { cookie: foreign, payload: { classIds: [foreignClass] } })).statusCode, 404);
  assert.equal((await call('PUT', accountPath + '/classes', { cookie: direction, payload: { classIds: [classB.id] } })).statusCode, 204);
  assert.deepEqual((await call('GET', '/teacher/classes', { cookie: teacher })).json().classes, [classB]);
  assert.equal((await call('GET', homework(classA.id) + range, { cookie: teacher })).statusCode, 404);
  assert.equal((await call('PUT', entryPath, { cookie: teacher, payload: entry })).statusCode, 404);
  assert.equal((await call('DELETE', entryPath, { cookie: teacher })).statusCode, 404);

  const activationReset = await call('POST', accountPath + '/activation', { cookie: direction });
  assert.equal(activationReset.statusCode, 200);
  const newCode = activationReset.json().code;
  assert.notEqual(newCode, code);
  assert.equal((await call('GET', '/teacher/classes', { cookie: teacher })).statusCode, 401);
  assert.equal((await signIn()).statusCode, 401);
  assert.equal((await activate(code)).statusCode, 401);
  assert.equal((await activate(newCode)).statusCode, 204);
  const nextSession = cookieFrom(await signIn());
  assert.equal((await call('DELETE', accountPath, { cookie: direction })).statusCode, 204);
  assert.equal((await call('GET', '/teacher/classes', { cookie: nextSession })).statusCode, 401);

  const schoolHomework = '/direction/classes/' + classA.id + '/homework' + range;
  assert.deepEqual((await call('GET', schoolHomework, { cookie: direction })).json().entries,
    [{ ...entry, id: entryId, title: 'Publication corrigée' }]);
});
