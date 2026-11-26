import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import pg from 'pg';
import { PDFDocument } from 'pdf-lib';
import { buildApp } from '../app.js';
import { createParentStore } from '../auth/parent-store.js';
import { hashPassword } from '../auth/password.js';
import { migrate, openDatabase, transaction } from '../db/database.js';
import { demo, seedDemo } from '../db/demo.js';
import { setDirectionPassword } from '../direction/store.js';
import { activateTeacher, createTeacher } from '../teacher/store.js';
import { purgeExpiredAttendance } from './store.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const origin = 'https://ent.ecole.example';

test('l’appel est versionné et les absences restent dans le périmètre de chaque rôle', { skip: !databaseUrl }, async (context) => {
  const schema = 'attendance_test_' + randomUUID().replaceAll('-', '');
  const admin = openDatabase(databaseUrl);
  const pool = new pg.Pool({ connectionString: databaseUrl, options: '-c search_path=' + schema });
  const store = createParentStore(pool, randomBytes(32));
  const app = buildApp({ parentAuth: { store, signingKey: randomBytes(32), webOrigin: origin },
    direction: { pool, webOrigin: origin }, blogMediaKey: randomBytes(32) });
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
  const [classA, classB] = demo.classes;
  const [childA, childB, childC] = demo.students;
  const { rows: [dates] } = await pool.query(`
    WITH calendar AS (SELECT (transaction_timestamp() AT TIME ZONE 'Europe/Paris')::date AS today)
    SELECT today::text, (today + 1)::text AS tomorrow, (today - 1)::text AS yesterday,
      ((today - interval '3 years')::date - 1)::text AS expired,
      (date_trunc('month', today)::date - interval '1 month')::date::text AS previous
    FROM calendar
  `);
  const currentMonth = dates.today.slice(0, 7);
  const previousMonth = dates.previous.slice(0, 7);
  const call = (method, path, headers = {}, payload) => app.inject({ method, url: '/api/v1' + path, headers, payload });
  const credentials = (response) => {
    assert.equal(response.statusCode, 204);
    return { origin, cookie: response.headers['set-cookie'].split(';')[0] };
  };
  const password = randomBytes(24).toString('base64url');
  const passwordHash = await hashPassword(password);
  await transaction(pool, (db) => setDirectionPassword(db, school.id, passwordHash));
  const direction = credentials(await call('POST', '/direction/auth/login', { origin }, { schoolCode: school.code, password }));
  const foreignSchool = randomUUID();
  await pool.query("INSERT INTO schools (id, code) VALUES ($1, 'ECOLE-VOISINE')", [foreignSchool]);
  await transaction(pool, (db) => setDirectionPassword(db, foreignSchool, passwordHash));
  const foreign = credentials(await call('POST', '/direction/auth/login', { origin }, { schoolCode: 'ECOLE-VOISINE', password }));
  async function teacher(login, classId) {
    const account = await transaction(pool, (db) => createTeacher(db, school.id, login, [classId]));
    assert.ok(await activateTeacher(pool, { schoolCode: school.code, login, code: account.code, password }));
    return credentials(await call('POST', '/teacher/auth/login', { origin }, { schoolCode: school.code, login, password }));
  }
  const teacherA = await teacher('appel-a', classA.id);
  const teacherB = await teacher('appel-b', classB.id);
  const invite = await store.invite(school.code, demo.guardians[0]);
  const parent = credentials(await call('POST', '/parent/web/auth/login', { origin }, { schoolCode: school.code, code: invite.code }));
  const mobileInvite = await store.invite(school.code, demo.guardians[1]);
  const mobileLogin = await call('POST', '/parent/auth/invitations/redeem', {}, { schoolCode: school.code, code: mobileInvite.code });
  assert.equal(mobileLogin.statusCode, 200);
  const mobile = { authorization: 'Bearer ' + mobileLogin.json().accessToken };

  const roll = '/teacher/classes/' + classA.id + '/attendance/';
  const dashboard = '/direction/classes/' + classA.id + '/attendance';
  const history = (child, month = currentMonth) => '/parent/children/' + child.id + '/attendance?month=' + month;
  const first = await call('GET', roll + dates.today, teacherA);
  assert.equal(first.statusCode, 200);
  assert.equal(first.headers['cache-control'], 'no-store');
  assert.deepEqual(first.json(), { revision: null, day: dates.today, canStart: true, students: [
    { id: childA.id, displayName: childA.name, status: 'present' }, { id: childC.id, displayName: childC.name, status: 'present' },
  ] });
  assert.equal((await call('GET', roll + dates.today)).statusCode, 401);
  assert.equal((await call('GET', roll + dates.today, teacherB)).statusCode, 404);
  assert.equal((await call('GET', roll + dates.tomorrow, teacherA)).statusCode, 404);
  assert.equal((await call('GET', roll + '2026-02-30', teacherA)).statusCode, 400);
  assert.equal((await call('GET', history(childA, '2026-13'), parent)).statusCode, 400);
  const entries = [{ studentId: childA.id, status: 'absent' }, { studentId: childC.id, status: 'late' }];
  const submit = (roster, revision = null, headers = teacherA, day = dates.today) =>
    call('PUT', roll + day, headers, { revision, entries: roster });
  assert.equal((await submit(entries, null, teacherB)).statusCode, 404);
  assert.equal((await submit(entries, null, { ...teacherA, origin: 'https://ailleurs.example' })).statusCode, 403);
  assert.equal((await submit(entries, null, teacherA, dates.yesterday)).statusCode, 409);
  assert.equal((await submit([entries[0], entries[0]])).statusCode, 409);
  assert.equal((await submit([entries[0], { studentId: childB.id, status: 'present' }])).statusCode, 409);
  assert.equal((await call('GET', roll + dates.today, teacherA)).json().revision, null);

  const writes = await Promise.all([submit(entries), submit(entries)]);
  assert.deepEqual(writes.map(({ statusCode }) => statusCode).sort(), [200, 409]);
  const saved = writes.find(({ statusCode }) => statusCode === 200).json();
  const expected = { day: dates.today, classId: classA.id, className: classA.name, status: 'absent', justified: false };
  assert.deepEqual((await call('GET', history(childA), parent)).json(), { entries: [expected] });
  assert.deepEqual((await call('GET', history(childB), parent)).json(), { entries: [] });
  assert.equal((await call('GET', history(childC), parent)).statusCode, 404);
  assert.equal((await call('GET', history(childA), mobile)).statusCode, 404);
  assert.deepEqual((await call('GET', history(childC), mobile)).json().entries.map(({ status }) => status), ['late']);
  assert.equal((await call('GET', dashboard + '?month=' + currentMonth, foreign)).statusCode, 404);
  assert.equal((await call('GET', dashboard + '?month=' + currentMonth, teacherA)).statusCode, 401);

  const justification = (child, revision, justified, headers = direction) =>
    call('PUT', dashboard + '/' + dates.today + '/students/' + child.id, headers, { revision, justified });
  assert.equal((await justification(childA, saved.revision, true, foreign)).statusCode, 404);
  assert.equal((await justification(childC, saved.revision, true)).statusCode, 404);
  const justified = await justification(childA, saved.revision, true);
  assert.equal(justified.statusCode, 200);
  assert.equal((await justification(childA, saved.revision, false)).statusCode, 409);
  assert.equal((await submit(entries, saved.revision)).statusCode, 409);
  const corrected = await submit([entries[0], { studentId: childC.id, status: 'left' }], justified.json().revision);
  assert.equal(corrected.statusCode, 200);
  assert.deepEqual((await call('GET', history(childA), parent)).json().entries, [{ ...expected, justified: true }]);
  assert.deepEqual((await call('GET', history(childC), mobile)).json().entries.map(({ status }) => status), ['left']);

  await pool.query(`
    INSERT INTO attendance_rolls (school_id, class_id, day, revision)
    SELECT $1, $2, day, gen_random_uuid()
    FROM unnest(ARRAY[$3::date, $3::date + 1, $3::date + 2, $4::date]) period(day)
  `, [school.id, classA.id, dates.previous, dates.expired]);
  await pool.query(`
    INSERT INTO attendance_entries (school_id, class_id, day, student_id, status)
    SELECT school_id, class_id, day, $3, 'absent' FROM attendance_rolls
    WHERE (school_id, class_id) = ($1, $2) AND day <> $4
  `, [school.id, classA.id, childA.id, dates.today]);
  const month = (await call('GET', dashboard + '?month=' + previousMonth, direction)).json();
  assert.equal(month.alertThreshold, 3);
  assert.equal(month.students[0].absences, 3);
  assert.equal(month.students[0].unjustified, 3);
  const pdf = await PDFDocument.create();
  pdf.addPage().drawText('Justificatif fictif');
  const content = Buffer.from(await pdf.save()).toString('base64');
  const form = '/parent/children/' + childA.id + '/attendance/' + classA.id + '/' + dates.previous + '/justification';
  const review = dashboard + '/' + dates.previous + '/students/' + childA.id + '/justification';
  assert.equal((await call('PUT', form, mobile, { content })).statusCode, 404);
  assert.equal((await call('PUT', form, parent, { content })).statusCode, 200);
  assert.equal((await call('GET', review, foreign)).statusCode, 404);
  const document = await call('GET', review, direction);
  assert.equal(document.statusCode, 200);
  assert.equal(document.headers['content-type'], 'application/pdf');
  const { rows: [uploaded] } = await pool.query('SELECT revision FROM attendance_rolls WHERE day = $1', [dates.previous]);
  assert.equal((await call('PUT', review, direction, { revision: uploaded.revision, accepted: true })).statusCode, 200);
  assert.ok((await call('GET', history(childA, previousMonth), parent)).json().entries.some(({ justificationStatus, justified }) =>
    justificationStatus === 'accepted' && justified));
  assert.equal((await call('GET', history(childA, dates.expired.slice(0, 7)), parent)).json().entries.length, 0);
  assert.equal((await call('GET', roll + dates.expired, teacherA)).statusCode, 404);
  await purgeExpiredAttendance(pool);
  assert.equal((await pool.query('SELECT 1 FROM attendance_entries WHERE day = $1', [dates.expired])).rowCount, 0);

  await pool.query('UPDATE students SET class_id = $3 WHERE (school_id, id) = ($1, $2)', [school.id, childA.id, classB.id]);
  assert.equal((await call('GET', history(childA, previousMonth), parent)).json().entries.length, 3);
  assert.ok((await call('GET', roll + dates.today, teacherA)).json().students.some(({ id }) => id === childA.id));
  await pool.query('DELETE FROM guardian_students WHERE (school_id, student_id) = ($1, $2)', [school.id, childA.id]);
  assert.equal((await call('GET', history(childA), parent)).statusCode, 404);
});
