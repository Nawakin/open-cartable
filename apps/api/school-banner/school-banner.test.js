import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import pg from 'pg';
import { buildApp } from '../app.js';
import { createParentStore } from '../auth/parent-store.js';
import { hashPassword } from '../auth/password.js';
import { migrate, openDatabase, transaction } from '../db/database.js';
import { demo, seedDemo } from '../db/demo.js';
import { setDirectionPassword } from '../direction/store.js';
import { activateTeacher, createTeacher } from '../teacher/store.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const origin = 'https://ent.ecole.example';

test('le bandeau est modifiable par la direction et reste limité à son école', { skip: !databaseUrl }, async (context) => {
  const schema = 'school_banner_' + randomUUID().replaceAll('-', '');
  const admin = openDatabase(databaseUrl);
  const pool = new pg.Pool({ connectionString: databaseUrl, options: '-c search_path=' + schema });
  const store = createParentStore(pool, randomBytes(32));
  const app = buildApp({
    parentAuth: { store, signingKey: randomBytes(32), webOrigin: origin },
    direction: { pool, webOrigin: origin },
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
  await migrate(pool);
  await seedDemo(pool);

  const school = demo.school;
  const otherSchool = randomUUID();
  const otherCode = 'ECOLE-VOISINE';
  await pool.query('INSERT INTO schools (id, code) VALUES ($1, $2)', [otherSchool, otherCode]);
  const password = randomBytes(24).toString('base64url');
  const digest = await hashPassword(password);
  await transaction(pool, async (db) => {
    await setDirectionPassword(db, school.id, digest);
    await setDirectionPassword(db, otherSchool, digest);
  });

  const call = (method, path, headers, payload) => app.inject({ method, url: '/api/v1' + path, headers, payload });
  const cookie = (response) => {
    assert.equal(response.statusCode, 204);
    return { origin, cookie: response.headers['set-cookie'].split(';')[0] };
  };
  const directionLogin = async (schoolCode) => cookie(await call(
    'POST', '/direction/auth/login', { origin }, { schoolCode, password },
  ));
  const direction = await directionLogin(school.code);
  const otherDirection = await directionLogin(otherCode);
  const login = 'enseignant-fictif';
  const teacherRecord = await transaction(pool, (db) => createTeacher(db, school.id, login, [demo.classes[0].id]));
  assert.ok(await activateTeacher(pool, { schoolCode: school.code, login, code: teacherRecord.code, password }));
  const teacher = cookie(await call('POST', '/teacher/auth/login', { origin }, { schoolCode: school.code, login, password }));

  const invitation = await store.invite(school.code, demo.guardians[0]);
  const family = cookie(await call('POST', '/parent/web/auth/login', { origin }, { schoolCode: school.code, code: invitation.code }));
  const nativeInvitation = await store.invite(school.code, demo.guardians[0]);
  const native = await call('POST', '/parent/auth/invitations/redeem', {}, { schoolCode: school.code, code: nativeInvitation.code });
  assert.equal(native.statusCode, 200);
  const device = { authorization: 'Bearer ' + native.json().accessToken };

  const directionURL = '/direction/school-banner';
  const teacherURL = '/teacher/school-banner';
  const parentURL = '/parent/school-banner';
  const draft = { title: 'École des Amandiers', textColor: '#FFFFFF', backgroundColor: '#26343D', revision: null };
  assert.deepEqual((await call('GET', directionURL, direction)).json(), { banner: null });
  assert.equal((await call('GET', parentURL, {})).statusCode, 401);
  assert.equal((await call('PUT', directionURL, teacher, draft)).statusCode, 401);
  assert.equal((await call('PUT', teacherURL, teacher, draft)).statusCode, 404);
  assert.equal((await call('PUT', parentURL, family, draft)).statusCode, 404);
  assert.equal((await call('PUT', directionURL, { ...direction, origin: 'https://ailleurs.example' }, draft)).statusCode, 403);
  assert.equal((await call('PUT', directionURL, direction, { ...draft, schoolId: otherSchool })).statusCode, 400);
  assert.equal((await call('PUT', directionURL, direction, { ...draft, title: 'Titre\nCaché' })).statusCode, 400);
  assert.equal((await call('PUT', directionURL, direction, { ...draft, backgroundColor: 'red' })).statusCode, 400);
  assert.equal((await call('PUT', directionURL, direction, { ...draft, textColor: '#FFFFFF\n' })).statusCode, 400);
  assert.equal((await call('PUT', directionURL, direction, { ...draft, textColor: '#eeeeee', backgroundColor: '#ffffff' })).statusCode, 422);

  const outcomes = await Promise.all(['École des Amandiers', 'École des Lilas'].map((title) =>
    call('PUT', directionURL, direction, { ...draft, title })));
  assert.deepEqual(outcomes.map(({ statusCode }) => statusCode).sort(), [200, 409]);
  const saved = outcomes.find((response) => response.statusCode === 200).json().banner;
  assert.equal(saved.textColor, '#ffffff');
  assert.equal(saved.backgroundColor, '#26343d');
  for (const [path, headers] of [[directionURL, direction], [teacherURL, teacher], [parentURL, family], [parentURL, device]]) {
    const response = await call('GET', path, headers);
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.deepEqual(response.json().banner, saved);
  }
  assert.deepEqual((await call('GET', directionURL, otherDirection)).json(), { banner: null });
  assert.equal((await call('DELETE', directionURL, direction, { revision: null })).statusCode, 409);
  const unchanged = await call('PUT', directionURL, direction, saved);
  assert.equal(unchanged.json().banner.revision, saved.revision);
  const reset = await call('DELETE', directionURL, direction, { revision: saved.revision });
  assert.deepEqual(reset.json(), { banner: null });
  assert.deepEqual((await call('GET', parentURL, family)).json(), { banner: null });
});
