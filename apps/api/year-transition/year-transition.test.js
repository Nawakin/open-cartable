import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import pg from 'pg';
import { buildApp } from '../app.js';
import { hashPassword } from '../auth/password.js';
import { migrate, openDatabase, transaction } from '../db/database.js';
import { demo, seedDemo } from '../db/demo.js';
import { setDirectionPassword } from '../direction/store.js';
import { createTeacher } from '../teacher/store.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const origin = 'https://ent.ecole.example';

test('la direction prépare les passages dans un brouillon isolé et révise les décisions devenues obsolètes',
  { skip: !databaseUrl }, async (context) => {
    const schema = 'transition_test_' + randomUUID().replaceAll('-', '');
    const admin = openDatabase(databaseUrl);
    const pool = new pg.Pool({ connectionString: databaseUrl, options: '-c search_path=' + schema });
    const app = buildApp({ direction: { pool, webOrigin: origin } });
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
    const [studentA, studentB, studentC] = demo.students;
    const foreignSchool = randomUUID();
    const foreignId = randomUUID();
    await pool.query("INSERT INTO schools (id, code) VALUES ($1, 'ECOLE-VOISINE')", [foreignSchool]);
    await pool.query("INSERT INTO classes (school_id, id, name) VALUES ($1, $2, 'Classe voisine')", [foreignSchool, classA.id]);
    await pool.query("INSERT INTO students (school_id, id, class_id, display_name) VALUES ($1, $2, $3, 'Élève voisin fictif')",
      [foreignSchool, foreignId, classA.id]);
    const password = randomBytes(24).toString('base64url');
    const passwordHash = await hashPassword(password);
    await transaction(pool, async (db) => {
      await setDirectionPassword(db, school.id, passwordHash);
      await setDirectionPassword(db, foreignSchool, passwordHash);
    });
    const call = (method, path, headers = {}, payload) => app.inject({ method, url: '/api/v1' + path, headers, payload });
    async function login(schoolCode) {
      const result = await call('POST', '/direction/auth/login', { origin }, { schoolCode, password });
      assert.equal(result.statusCode, 204);
      return { origin, cookie: result.headers['set-cookie'].split(';')[0] };
    }
    const local = await login(school.code);
    const foreign = await login('ECOLE-VOISINE');
    const endpoint = '/direction/year-transition';
    const fetch = (headers = local) => call('GET', endpoint, headers);
    const write = (body, headers = local) => call('PUT', endpoint, headers, body);
    const initial = { startYear: 2026, revision: null, classes: [], sourceLevels: [], overrides: [], assignments: [] };
    assert.equal((await fetch({})).statusCode, 401);
    assert.equal((await fetch()).headers['cache-control'], 'no-store');
    assert.equal((await fetch()).json().plan, null);
    assert.equal((await write(initial, { ...local, origin: 'https://ailleurs.example' })).statusCode, 403);
    assert.equal((await write({ ...initial, startYear: '2026' })).statusCode, 400);
    const writes = await Promise.all([write(initial), write(initial)]);
    assert.deepEqual(writes.map(({ statusCode }) => statusCode).sort(), [200, 409]);
    let data = writes.find(({ statusCode }) => statusCode === 200).json();
    assert.equal(data.plan.startYear, 2026);
    assert.deepEqual(data.sources.flatMap(({ students }) => students.map(({ id }) => id)).sort(),
      [studentA.id, studentB.id, studentC.id].sort());
    assert.equal((await fetch(foreign)).json().plan, null);

    async function save(fields) {
      const result = await write({ ...data.plan, ...fields });
      assert.equal(result.statusCode, 200);
      data = result.json();
    }
    const pupil = (id) => data.sources.flatMap(({ students }) => students).find((entry) => entry.id === id);
    const identity = (studentId, sourceClassId = classA.id) => ({ studentId, sourceClassId });
    await save({
      classes: [{ id: null, name: classA.name, levels: ['CE1', 'CE2'] }],
      sourceLevels: [{ classId: classA.id, level: 'CE1' }, { classId: classB.id, level: 'CM2' }],
    });
    const [target] = data.plan.classes;
    const suggestion = { classId: target.id, level: 'CE2' };
    assert.deepEqual(pupil(studentA.id).proposal, suggestion);
    assert.equal(pupil(studentA.id).assignment, null);
    assert.equal(pupil(studentB.id).proposal, null);
    assert.equal((await write({ ...data.plan, classes: [...data.plan.classes, {
      id: null, name: '  ' + classA.name.toUpperCase(), levels: ['CE1'],
    }] })).statusCode, 400);
    assert.equal((await write({ ...data.plan, overrides: [{ ...identity(foreignId), level: 'CE1' }] })).statusCode, 409);
    assert.equal((await write({ ...data.plan, revision: randomUUID() })).statusCode, 409);

    await save({ classes: [...data.plan.classes, { id: null, name: 'Classe de rentrée B', levels: ['CE2'] }] });
    assert.equal(pupil(studentA.id).proposal, null);
    const [sameTarget, otherTarget] = data.plan.classes;
    await save({ assignments: [
      { ...identity(studentA.id), sourceLevel: 'CE1', target: { classId: otherTarget.id, level: 'CE2' } },
      { ...identity(studentC.id), sourceLevel: 'CE1', target: { classId: sameTarget.id, level: 'CE1' } },
      { ...identity(studentB.id, classB.id), sourceLevel: 'CM2', target: null },
    ] });
    assert.equal(pupil(studentA.id).assignment.target.classId, otherTarget.id);
    assert.equal(pupil(studentC.id).assignment.target.level, 'CE1');
    assert.equal(pupil(studentB.id).assignment.target, null);
    assert.deepEqual((await fetch()).json().plan, data.plan);
    assert.deepEqual((await pool.query('SELECT id, class_id FROM students WHERE school_id = $1 ORDER BY id', [school.id])).rows,
      [studentA, studentB, studentC].map(({ id, classIndex }) => ({ id, class_id: demo.classes[classIndex].id })));
    assert.equal((await pool.query('SELECT 1 FROM classes WHERE school_id = $1', [school.id])).rowCount, 2);
    assert.equal((await fetch(foreign)).json().plan, null);

    await save({ overrides: [{ ...identity(studentA.id), level: 'CE2' }] });
    assert.equal(pupil(studentA.id).assignment, null);
    assert.equal(pupil(studentC.id).assignment.target.level, 'CE1');
    await save({ classes: [otherTarget] });
    assert.equal(pupil(studentC.id).assignment, null);
    assert.deepEqual(pupil(studentC.id).proposal, { classId: otherTarget.id, level: 'CE2' });
    await pool.query('UPDATE students SET class_id = $1 WHERE school_id = $2 AND id = $3', [classB.id, school.id, studentA.id]);
    assert.equal((await write(data.plan)).statusCode, 409);
    data = (await fetch()).json();
    assert.deepEqual(data.plan.overrides, []);
    assert.equal(pupil(studentA.id).level, 'CM2');

    const apply = (confirmation = 2027, headers = local) => call('POST', endpoint + '/apply', headers, {
      revision: data.plan.revision, confirmation,
    });
    assert.equal((await apply()).statusCode, 409);
    assert.equal((await apply(2028)).statusCode, 400);
    assert.equal((await apply(2027, foreign)).statusCode, 409);
    const teacher = await transaction(pool, (db) => createTeacher(db, school.id, 'preparation-rentree', [classA.id]));
    const homework = '/direction/classes/' + classA.id + '/homework';
    await pool.query(`
      INSERT INTO homework_entries (school_id, class_id, id, entry_date, title, domain, description)
      VALUES ($1, $2, gen_random_uuid(), '2026-11-01', 'Exercice fictif', 'Lecture', 'Un texte archivé.')
    `, [school.id, classA.id]);
    await pool.query(`
      INSERT INTO liaison_notes (school_id, class_id, id, note_day, body)
      VALUES ($1, $2, gen_random_uuid(), CURRENT_DATE, 'Un mot archivé.')
    `, [school.id, classA.id]);
    await save({ assignments: [
      { ...identity(studentA.id, classB.id), sourceLevel: 'CM2', target: null },
      { ...identity(studentB.id, classB.id), sourceLevel: 'CM2', target: { classId: otherTarget.id, level: 'CE2' } },
      { ...identity(studentC.id), sourceLevel: 'CE1', target: { classId: otherTarget.id, level: 'CE2' } },
    ], teacherAssignments: [{ teacherId: teacher.id, classId: otherTarget.id }] });
    assert.equal(data.summary.ready, true);
    const openings = await Promise.all([apply(), apply()]);
    assert.deepEqual(openings.map(({ statusCode }) => statusCode), [200, 200]);
    assert.deepEqual(openings.map((result) => result.json().activeStartYear), [2027, 2027]);
    assert.equal((await pool.query('SELECT 1 FROM school_year_changes WHERE school_id = $1', [school.id])).rowCount, 1);
    assert.deepEqual((await call('GET', '/direction/classes', local)).json().classes.map(({ id }) => id), [otherTarget.id]);
    assert.deepEqual((await pool.query('SELECT class_id FROM teacher_classes WHERE teacher_id = $1', [teacher.id])).rows,
      [{ class_id: otherTarget.id }]);
    const { rows: [departed] } = await pool.query('SELECT class_id, left_at FROM students WHERE id = $1', [studentA.id]);
    assert.equal(departed.class_id, classB.id);
    assert.ok(departed.left_at);
    assert.equal((await call('GET', homework + '?from=2026-11-01&to=2026-11-30', local)).statusCode, 404);
    const archives = '/direction/school-archives/' + classA.id;
    assert.equal((await call('GET', archives + '?kind=homework', local)).json().entries[0].title, 'Exercice fictif');
    assert.equal((await call('GET', archives + '?kind=liaison', local)).json().entries[0].body, 'Un mot archivé.');
    assert.equal((await call('GET', archives + '?kind=homework', foreign)).statusCode, 404);
  });
