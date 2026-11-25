import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import pg from 'pg';
import { buildApp } from '../app.js';
import { createParentStore } from '../auth/parent-store.js';
import { migrate, openDatabase, transaction } from '../db/database.js';
import { demo, seedDemo } from '../db/demo.js';
import { activateTeacher, createTeacher } from '../teacher/store.js';
import { purgeExpiredLiaison } from './store.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const origin = 'https://ent.ecole.example';

test('le cahier de liaison applique la tutelle, les affectations et la conservation', { skip: !databaseUrl }, async (context) => {
  const schema = 'liaison_test_' + randomUUID().replaceAll('-', '');
  const admin = openDatabase(databaseUrl);
  const pool = new pg.Pool({ connectionString: databaseUrl, options: '-c search_path=' + schema });
  const store = createParentStore(pool, randomBytes(32));
  const app = buildApp({ parentAuth: { store, signingKey: randomBytes(32), webOrigin: origin }, direction: { pool, webOrigin: origin } });
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

  const { id: schoolId, code: schoolCode } = demo.school;
  const [classA, classB] = demo.classes;
  const [childA, childB, childC] = demo.students;
  const [guardianA, guardianB] = demo.guardians;
  const otherSchool = randomUUID();
  const otherCode = 'ECOLE-VOISINE';
  await pool.query('INSERT INTO schools (id, code) VALUES ($1, $2)', [otherSchool, otherCode]);
  await pool.query('INSERT INTO classes (school_id, id, name) VALUES ($1, $2, $3)', [otherSchool, classA.id, 'Classe voisine fictive']);
  await pool.query('INSERT INTO guardian_students (school_id, guardian_id, student_id) VALUES ($1, $2, $3)',
    [schoolId, guardianB, childA.id]);

  const call = (method, path, headers, payload) => app.inject({ method, url: '/api/v1' + path, headers, payload });
  const cookie = (response) => {
    assert.equal(response.statusCode, 204);
    return { origin, cookie: response.headers['set-cookie'].split(';')[0] };
  };
  async function teacher(school, schoolCode, login, classId) {
    const password = randomBytes(24).toString('base64url');
    const created = await transaction(pool, (db) => createTeacher(db, school, login, [classId]));
    assert.ok(await activateTeacher(pool, { schoolCode, login, code: created.code, password }));
    return {
      id: created.id,
      headers: cookie(await call('POST', '/teacher/auth/login', { origin }, { schoolCode, login, password })),
    };
  }
  async function parent(guardianId, web) {
    const { code } = await store.invite(schoolCode, guardianId);
    if (web) return cookie(await call('POST', '/parent/web/auth/login', { origin }, { schoolCode, code }));
    const response = await call('POST', '/parent/auth/invitations/redeem', {}, { schoolCode, code });
    assert.equal(response.statusCode, 200);
    return { authorization: 'Bearer ' + response.json().accessToken };
  }

  const a = await teacher(schoolId, schoolCode, 'classe-a', classA.id);
  const b = await teacher(schoolId, schoolCode, 'classe-b', classB.id);
  const neighbor = await teacher(otherSchool, otherCode, 'classe-a', classA.id);
  const familyA = await parent(guardianA, true);
  const familyB = await parent(guardianB, false);
  const forClass = (id) => '/teacher/classes/' + id + '/liaison';
  const forChild = (id) => '/parent/children/' + id + '/liaison';
  const classPath = forClass(classA.id);
  const childPath = forChild(childA.id);
  const listing = await call('GET', classPath, a.headers);
  assert.deepEqual(listing.json().notes, []);
  assert.equal(listing.headers['cache-control'], 'no-store');
  const { today } = listing.json();
  assert.equal((await call('GET', classPath, b.headers)).statusCode, 404);
  assert.deepEqual((await call('GET', classPath, neighbor.headers)).json().notes, []);
  assert.equal((await call('PUT', classPath + '/today', a.headers, { day: '2000-01-01', body: 'Ancienne journée' })).statusCode, 409);
  assert.equal((await call('PUT', classPath + '/today', { ...a.headers, origin: 'https://ailleurs.example' }, { day: today, body: 'Autre origine' })).statusCode, 403);
  assert.equal((await call('PUT', classPath + '/today', a.headers, { day: today, body: ' ' })).statusCode, 400);
  assert.equal((await call('GET', childPath + '?before=2026-02-30', familyA)).statusCode, 400);

  const word = 'Bonjour, <b>apportez le carnet.</b>';
  const published = await Promise.all([0, 1].map(() => call('PUT', classPath + '/today', a.headers, { day: today, body: word })));
  assert.deepEqual(published.map(({ statusCode }) => statusCode), [200, 200]);
  const { id } = published[0].json();
  assert.equal(published[1].json().id, id);
  const familyPage = await call('GET', childPath, familyA);
  assert.deepEqual(familyPage.json().notes, [{ id, day: today, body: word, reply: null }]);
  assert.deepEqual((await call('GET', forChild(childB.id), familyA)).json().notes, []);
  assert.equal((await call('GET', forChild(childC.id), familyA)).statusCode, 404);
  assert.equal((await call('GET', childPath, a.headers)).statusCode, 401);
  const privatePath = childPath + '/' + id + '/reply';
  const teacherReplies = classPath + '/' + id + '/replies';
  assert.equal((await call('PUT', forChild(childB.id) + '/' + id + '/reply', familyA, { body: 'Hors classe' })).statusCode, 404);
  assert.equal((await call('PUT', privatePath, { ...familyA, origin: 'https://ailleurs.example' }, { body: 'Autre origine' })).statusCode, 403);
  const first = 'Bien reçu.';
  const other = 'Une autre réponse privée.';
  assert.equal((await call('PUT', privatePath, familyA, { body: first })).statusCode, 200);
  assert.equal((await call('GET', childPath, familyB)).json().notes[0].reply, null);
  assert.equal((await call('PUT', privatePath, familyB, { body: other })).statusCode, 200);
  assert.equal((await call('PUT', privatePath, familyA, { body: first + ' Merci.' })).statusCode, 200);
  assert.equal((await call('GET', childPath, familyA)).json().notes[0].reply.body, first + ' Merci.');
  assert.equal((await call('GET', childPath, familyB)).json().notes[0].reply.body, other);
  assert.equal((await call('GET', teacherReplies, b.headers)).statusCode, 404);
  assert.equal((await call('GET', teacherReplies, neighbor.headers)).statusCode, 404);
  const replies = (await call('GET', teacherReplies, a.headers)).json().replies;
  assert.deepEqual(replies.map(({ body }) => body).sort(), [first + ' Merci.', other].sort());
  assert.equal(replies.find(({ body }) => body === other).guardianReference, guardianB);
  assert.equal(replies.find(({ body }) => body === other).childId, childA.id);

  await pool.query('UPDATE students SET class_id = $1 WHERE school_id = $2 AND id = $3', [classB.id, schoolId, childA.id]);
  assert.deepEqual((await call('GET', childPath, familyA)).json().notes, []);
  assert.deepEqual((await call('GET', teacherReplies, a.headers)).json().replies, []);
  assert.equal((await call('PUT', privatePath, familyB, { body: 'Classe précédente' })).statusCode, 404);
  await pool.query('UPDATE students SET class_id = $1 WHERE school_id = $2 AND id = $3', [classA.id, schoolId, childA.id]);
  await pool.query('DELETE FROM teacher_classes WHERE school_id = $1 AND teacher_id = $2', [schoolId, a.id]);
  assert.equal((await call('GET', teacherReplies, a.headers)).statusCode, 404);

  await pool.query("UPDATE liaison_notes SET published_at = statement_timestamp() - interval '2 years' WHERE id = $1", [id]);
  assert.deepEqual((await call('GET', childPath, familyA)).json().notes, []);
  assert.equal((await call('PUT', privatePath, familyA, { body: 'Après expiration' })).statusCode, 404);
  await purgeExpiredLiaison(pool);
  assert.equal((await pool.query('SELECT 1 FROM liaison_replies WHERE note_id = $1', [id])).rowCount, 0);
  assert.equal((await pool.query('SELECT 1 FROM liaison_notes WHERE id = $1', [id])).rowCount, 0);
});
