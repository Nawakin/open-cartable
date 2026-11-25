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
import { eventCalendar } from './ical.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const webOrigin = 'https://ent.ecole.example';

test('iCalendar échappe le texte et replie les lignes UTF-8 à 75 octets', () => {
  const calendar = eventCalendar({
    id: randomUUID(), startsAt: '2026-11-25T09:00:00.000Z', endsAt: '2026-11-25T10:00:00.000Z',
    title: 'Sortie, puis atelier; eau', location: 'Salle \\ A',
    description: 'É'.repeat(60) + '\r\nCLASS:PRIVATE',
  }, new Date('2026-11-01T08:00:00.000Z'));
  for (const line of calendar.split('\r\n')) assert.ok(Buffer.byteLength(line) <= 75);
  const unfolded = calendar.replaceAll('\r\n ', '');
  assert.match(unfolded, /DTSTART:20261125T090000Z\r\nDTEND:20261125T100000Z/);
  assert.ok(unfolded.includes('SUMMARY:Sortie\\, puis atelier\\; eau\r\n'));
  assert.ok(unfolded.includes('LOCATION:Salle \\\\ A\r\n'));
  assert.ok(unfolded.includes('DESCRIPTION:' + 'É'.repeat(60) + '\\nCLASS:PRIVATE\r\n'));
  assert.doesNotMatch(unfolded, /\r\nCLASS:/);
});

test('l’agenda et son export respectent l’école, la classe et la tutelle', { skip: !databaseUrl }, async (context) => {
  const schema = 'agenda_test_' + randomUUID().replaceAll('-', '');
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
  const [classA, classB] = demo.classes;
  const [childA, childB, childC] = demo.students;
  const otherSchool = randomUUID();
  await pool.query('INSERT INTO schools (id, code) VALUES ($1, $2)', [otherSchool, 'AUTRE-ECOLE']);
  await transaction(pool, (db) => setDirectionPassword(db, otherSchool, credential));

  let address = 0;
  const call = (method, path, { cookie, origin = webOrigin, payload } = {}) => app.inject({
    method, url: '/api/v1' + path, payload, remoteAddress: '192.0.2.' + ++address,
    headers: { origin, ...(cookie ? { cookie } : {}) },
  });
  const cookieFrom = (response) => {
    assert.equal(response.statusCode, 204);
    return response.headers['set-cookie'].split(';')[0];
  };
  const directionLogin = (code) => call('POST', '/direction/auth/login', { payload: { schoolCode: code, password } });
  const director = cookieFrom(await directionLogin(schoolCode));
  const foreign = cookieFrom(await directionLogin('AUTRE-ECOLE'));

  const login = 'enseignant-fictif';
  const teacherAccount = await call('POST', '/direction/teachers', { cookie: director, payload: { login, classIds: [classA.id] } });
  assert.equal(teacherAccount.statusCode, 201);
  const teacherCredentials = { schoolCode, login, password };
  assert.equal((await call('POST', '/teacher/auth/activate', {
    payload: { ...teacherCredentials, code: teacherAccount.json().code },
  })).statusCode, 204);
  const teacher = cookieFrom(await call('POST', '/teacher/auth/login', { payload: teacherCredentials }));

  async function parent(guardianId) {
    const { code } = await store.invite(schoolCode, guardianId);
    return cookieFrom(await call('POST', '/parent/web/auth/login', { payload: { schoolCode, code } }));
  }
  const firstParent = await parent(demo.guardians[0]);
  const secondParent = await parent(demo.guardians[1]);
  const schoolRoute = '/direction/agenda';
  const teacherClass = (id) => '/teacher/classes/' + id + '/agenda';
  const parentRoute = (id) => '/parent/children/' + id + '/agenda';
  const range = '?from=2026-11-23T00:00:00.000Z&until=2026-11-30T00:00:00.000Z';
  const draft = {
    startsAt: '2026-11-25T09:00:00.000Z', endsAt: '2026-11-25T10:00:00.000Z',
    title: 'Réunion fictive', location: 'Salle A', description: 'Ordre du jour fictif.',
  };
  const create = (path, cookie, fields = {}) => call('POST', path, { cookie, payload: { ...draft, ...fields } });
  assert.equal((await create(schoolRoute, firstParent)).statusCode, 401);
  assert.equal((await create(schoolRoute, teacher)).statusCode, 401);
  assert.equal((await create(teacherClass(classB.id), teacher)).statusCode, 404);
  assert.equal((await call('POST', schoolRoute, {
    cookie: director, origin: 'https://autre.ecole.example', payload: draft,
  })).statusCode, 403);
  assert.equal((await create(schoolRoute, director, { endsAt: draft.startsAt })).statusCode, 400);
  const schoolEvent = await create(schoolRoute, director, {
    startsAt: '2026-11-22T21:00:00.000Z', endsAt: '2026-11-23T08:00:00.000Z', title: 'Événement commun',
  });
  assert.equal(schoolEvent.statusCode, 201);
  const schoolEventId = schoolEvent.json().id;
  const classEvent = await create(teacherClass(classA.id), teacher, { title: 'Atelier de la classe A' });
  assert.equal(classEvent.statusCode, 201);
  const classEventId = classEvent.json().id;
  assert.equal((await create(schoolRoute, foreign, { title: 'Événement de l’autre école' })).statusCode, 201);
  assert.equal((await create(schoolRoute, director, {
    startsAt: '2026-11-30T00:00:00.000Z', endsAt: '2026-11-30T01:00:00.000Z', title: 'Hors période',
  })).statusCode, 201);

  const agenda = (cookie, child) => call('GET', parentRoute(child.id) + range, { cookie });
  const titles = async (cookie, child) => (await agenda(cookie, child)).json().events.map(({ title }) => title);
  assert.equal((await agenda(undefined, childA)).statusCode, 401);
  assert.deepEqual(await titles(firstParent, childA), ['Événement commun', 'Atelier de la classe A']);
  assert.deepEqual(await titles(firstParent, childB), ['Événement commun']);
  assert.deepEqual(await titles(secondParent, childC), ['Événement commun', 'Atelier de la classe A']);
  assert.equal((await agenda(secondParent, childB)).statusCode, 404);

  const exportEvent = (cookie, child, eventId) => call('GET', parentRoute(child.id) + '/' + eventId + '/ical', { cookie });
  const ical = await exportEvent(firstParent, childA, classEventId);
  assert.equal(ical.statusCode, 200);
  assert.equal(ical.headers['cache-control'], 'no-store');
  assert.match(ical.headers['content-type'], /^text\/calendar/);
  assert.match(ical.headers['content-disposition'], /^attachment/);
  assert.match(ical.body, /SUMMARY:Atelier de la classe A/);
  assert.equal((await exportEvent(firstParent, childB, classEventId)).statusCode, 404);
  assert.equal((await exportEvent(secondParent, childB, schoolEventId)).statusCode, 404);
  assert.equal((await call('DELETE', schoolRoute + '/' + schoolEventId, { cookie: foreign })).statusCode, 404);

  const classItem = teacherClass(classA.id) + '/' + classEventId;
  assert.equal((await call('PUT', classItem, { cookie: teacher, payload: { ...draft, title: 'Atelier corrigé' } })).statusCode, 204);
  assert.deepEqual(await titles(firstParent, childA), ['Événement commun', 'Atelier corrigé']);
  assert.equal((await call('DELETE', classItem, { cookie: teacher })).statusCode, 204);
  assert.equal((await exportEvent(firstParent, childA, classEventId)).statusCode, 404);

  await pool.query(`
    INSERT INTO agenda_events (school_id, id, starts_at, ends_at, title, location, description)
    SELECT $1, gen_random_uuid(), $2, $3, 'Événement ' || n, '', '' FROM generate_series(1, 32) n
  `, [demo.school.id, draft.startsAt, draft.endsAt]);
  const page = (await agenda(firstParent, childA)).json();
  assert.equal(page.events.length, 30);
  const next = (await call('GET', parentRoute(childA.id) + range + '&cursor=' + encodeURIComponent(page.nextCursor), { cookie: firstParent })).json();
  assert.equal(next.events.length, 3);
  assert.equal(next.nextCursor, null);
  assert.equal(new Set([...page.events, ...next.events].map(({ id }) => id)).size, 33);

  const [guardianA, guardianB] = demo.guardians;
  // Cette fois, les deux tuteurs peuvent consulter le même enfant.
  await pool.query('INSERT INTO guardian_students (school_id, guardian_id, student_id) VALUES ($1, $2, $3)',
    [demo.school.id, guardianB, childA.id]);
  assert.deepEqual((await call('GET', '/parent/tutor-reference', { cookie: firstParent })).json(), { reference: guardianA });
  assert.deepEqual((await call('GET', '/parent/tutor-reference', { cookie: secondParent })).json(), { reference: guardianB });
  assert.equal((await call('GET', '/parent/tutor-reference', { cookie: teacher })).statusCode, 401);

  const coworkerLogin = { schoolCode, login: 'deuxieme-enseignant', password };
  const coworkerAccount = await call('POST', '/direction/teachers', {
    cookie: director, payload: { login: coworkerLogin.login, classIds: [classA.id] },
  });
  assert.equal(coworkerAccount.statusCode, 201);
  assert.equal((await call('POST', '/teacher/auth/activate', {
    payload: { ...coworkerLogin, code: coworkerAccount.json().code },
  })).statusCode, 204);
  const coworker = cookieFrom(await call('POST', '/teacher/auth/login', { payload: coworkerLogin }));

  const privateRoute = '/teacher/classes/' + classA.id + '/appointments';
  const directionAppointments = '/direction/classes/' + classA.id + '/appointments';
  const hiredStudents = await call('GET', privateRoute + '/students', { cookie: teacher });
  assert.deepEqual(hiredStudents.json().students, [childA, childC].map(({ id, name }) => ({ id, displayName: name })));
  assert.equal((await call('GET', '/teacher/classes/' + classB.id + '/appointments/students', { cookie: teacher })).statusCode, 404);

  const appointment = { ...draft, title: 'Rendez-vous fictif', startsAt: '2026-12-01T16:00:00.000Z', endsAt: '2026-12-01T16:30:00.000Z' };
  const recipient = { studentId: childA.id, guardianReference: guardianA };
  const book = (path, cookie, details = recipient) => call('POST', path, { cookie, payload: { ...details, event: appointment } });
  assert.equal((await book(privateRoute, firstParent)).statusCode, 401);
  assert.equal((await book(privateRoute, teacher, { ...recipient, guardianReference: randomUUID() })).statusCode, 404);
  assert.equal((await book(privateRoute, teacher, { ...recipient, studentId: childC.id })).statusCode, 404);
  const createdAppointment = await book(privateRoute, teacher);
  assert.equal(createdAppointment.statusCode, 201);
  const appointmentId = createdAppointment.json().id;
  const privateRange = '?from=2026-12-01T00:00:00.000Z&until=2026-12-07T00:00:00.000Z';
  const privateList = (path, cookie) => call('GET', path + privateRange, { cookie });
  const parentEvents = (child, cookie) => privateList(parentRoute(child.id), cookie);
  const delivered = await parentEvents(childA, firstParent);
  assert.deepEqual(delivered.json().events, [{ ...appointment, id: appointmentId, scope: 'private' }]);
  assert.deepEqual((await parentEvents(childA, secondParent)).json().events, []);
  assert.deepEqual((await parentEvents(childB, firstParent)).json().events, []);
  assert.deepEqual((await privateList(teacherClass(classA.id), teacher)).json().events, []);
  assert.deepEqual((await privateList(privateRoute, coworker)).json().events, []);
  assert.equal((await privateList(directionAppointments, director)).json().events[0].guardianReference, guardianA);
  assert.equal((await call('PUT', privateRoute + '/' + appointmentId, { cookie: coworker, payload: appointment })).statusCode, 404);
  assert.equal((await call('DELETE', teacherClass(classA.id) + '/' + appointmentId, { cookie: teacher })).statusCode, 404);
  assert.equal((await call('PUT', privateRoute + '/' + appointmentId, { cookie: teacher, payload: appointment })).statusCode, 204);

  const calendar = await exportEvent(firstParent, childA, appointmentId);
  assert.equal(calendar.statusCode, 200);
  assert.match(calendar.body, /\r\nCLASS:PRIVATE\r\n/);
  assert.equal(calendar.body.includes(guardianA), false);
  assert.equal((await exportEvent(secondParent, childA, appointmentId)).statusCode, 404);
  assert.equal((await exportEvent(firstParent, childB, appointmentId)).statusCode, 404);

  await pool.query('UPDATE students SET class_id = $1 WHERE school_id = $2 AND id = $3', [classB.id, demo.school.id, childA.id]);
  assert.deepEqual((await parentEvents(childA, firstParent)).json().events, []);
  assert.deepEqual((await privateList(privateRoute, teacher)).json().events, []);
  assert.equal((await exportEvent(firstParent, childA, appointmentId)).statusCode, 404);
  assert.equal((await call('DELETE', privateRoute + '/' + appointmentId, { cookie: teacher })).statusCode, 404);
  assert.equal((await call('DELETE', directionAppointments + '/' + appointmentId, { cookie: director })).statusCode, 204);

  await pool.query('UPDATE students SET class_id = $1 WHERE school_id = $2 AND id = $3', [classA.id, demo.school.id, childA.id]);
  const linkedAppointment = await book(privateRoute, teacher);
  assert.equal(linkedAppointment.statusCode, 201);
  await pool.query('DELETE FROM guardian_students WHERE school_id = $1 AND guardian_id = $2 AND student_id = $3',
    [demo.school.id, guardianA, childA.id]);
  assert.deepEqual((await privateList(directionAppointments, director)).json().events, []);
  assert.equal((await exportEvent(firstParent, childA, linkedAppointment.json().id)).statusCode, 404);
});
