import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import pg from 'pg';
import { buildApp } from '../app.js';
import { migrate, openDatabase, transaction } from '../db/database.js';
import { demo, seedDemo } from '../db/demo.js';
import { activateTeacher, createTeacher, resetTeacher } from '../teacher/store.js';
import { createParentStore } from './parent-store.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const origin = 'https://ent.ecole.example';

test('les raccourcis n’associent que deux comptes vérifiés de la même école et gardent leurs droits séparés',
  { skip: !databaseUrl }, async (context) => {
    const schema = 'account_links_test_' + randomUUID().replaceAll('-', '');
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

    const { id: schoolId, code: schoolCode } = demo.school;
    const [classA, classB] = demo.classes;
    const [guardianA, guardianB] = demo.guardians;
    const [childA, childB] = demo.students;
    const otherSchool = randomUUID();
    const otherCode = 'ECOLE-VOISINE';
    await pool.query('INSERT INTO schools (id, code) VALUES ($1, $2)', [otherSchool, otherCode]);
    await pool.query("INSERT INTO classes (school_id, id, name) VALUES ($1, $2, 'Classe voisine')", [otherSchool, classA.id]);
    await pool.query("INSERT INTO students (school_id, id, class_id, display_name) VALUES ($1, $2, $3, 'Élève voisin')",
      [otherSchool, childA.id, classA.id]);
    await pool.query('INSERT INTO guardians (school_id, id) VALUES ($1, $2)', [otherSchool, guardianA]);
    await pool.query('INSERT INTO guardian_students (school_id, guardian_id, student_id) VALUES ($1, $2, $3)',
      [otherSchool, guardianA, childA.id]);

    let requests = 0;
    const call = (method, path, cookies = [], payload, reqOrigin = origin) => app.inject({
      method, url: '/api/v1' + path, payload, headers: { origin: reqOrigin, cookie: cookies.join('; ') },
      remoteAddress: '192.0.2.' + (++requests),
    });
    const cookie = (response) => {
      assert.equal(response.statusCode, 204);
      return response.headers['set-cookie'].split(';')[0];
    };
    async function parent(guardianId, code = schoolCode) {
      const invite = await store.invite(code, guardianId);
      return cookie(await call('POST', '/parent/web/auth/login', [], { schoolCode: code, code: invite.code }));
    }

    async function teacher(login, classId) {
      const password = randomBytes(24).toString('base64url');
      const created = await transaction(pool, (db) => createTeacher(db, schoolId, login, [classId]));
      assert.ok(await activateTeacher(pool, { schoolCode, login, code: created.code, password }));
      const session = cookie(await call('POST', '/teacher/auth/login', [], { schoolCode, login, password }));
      return { ...created, password, session };
    }

    const [family, otherFamily, foreignFamily, teacherA, teacherB] = await Promise.all([
      parent(guardianA), parent(guardianB), parent(guardianA, otherCode), teacher('classe-a', classA.id), teacher('classe-b', classB.id),
    ]);
    const staff = '/teacher/parent-link';
    const home = '/parent/web/teacher-link';
    const both = [family, teacherB.session];
    assert.deepEqual((await call('GET', home, [family])).json(), { linked: false });
    assert.equal((await call('POST', home + '/open', [family])).statusCode, 404);
    assert.equal((await call('GET', '/teacher/classes', [family])).statusCode, 401);
    assert.equal((await call('GET', '/direction/classes', both)).statusCode, 401);
    assert.deepEqual((await call('GET', staff, [teacherB.session, foreignFamily])).json(), { linked: false, candidate: null });
    assert.deepEqual((await call('GET', staff, both)).json(), {
      linked: false, candidate: { id: guardianA, children: [childA.name, childB.name] },
    });

    const input = { parentId: guardianA, password: teacherB.password };
    assert.equal((await call('PUT', staff, both, input, 'https://autre.example')).statusCode, 403);
    assert.equal((await call('PUT', staff, [teacherB.session, foreignFamily], input)).statusCode, 409);
    assert.equal((await call('PUT', staff, [teacherB.session, otherFamily], input)).statusCode, 409);
    assert.equal((await call('PUT', staff, both, { ...input, password: teacherA.password })).statusCode, 422);
    assert.deepEqual((await call('PUT', staff, both, input)).json(), { linked: true, candidate: null });
    assert.equal((await call('PUT', staff, [family, teacherA.session], { ...input, password: teacherA.password })).statusCode, 409);
    assert.deepEqual((await call('GET', home, [family])).json(), { linked: true });
    assert.deepEqual((await call('GET', home, [foreignFamily])).json(), { linked: false });
    assert.deepEqual((await call('GET', home, [otherFamily, teacherB.session])).json(), { linked: false });
    assert.deepEqual((await call('GET', '/parent/children', both)).json().children.map(({ id }) => id).sort(), [childA.id, childB.id].sort());
    assert.deepEqual((await call('GET', '/teacher/classes', both)).json().classes.map(({ id }) => id), [classB.id]);

    for (const path of [home, staff]) {
      const opened = await call('POST', path + '/open', both);
      assert.equal(opened.statusCode, 204);
      assert.equal(opened.headers['set-cookie'], undefined);
    }
    const wrongTeacher = await call('POST', home + '/open', [family, teacherA.session]);
    assert.equal(wrongTeacher.statusCode, 204);
    assert.match(wrongTeacher.headers['set-cookie'], /^__Host-open-cartable-teacher=;/);
    const wrongFamily = await call('POST', staff + '/open', [otherFamily, teacherB.session]);
    assert.equal(wrongFamily.statusCode, 204);
    assert.match(wrongFamily.headers['set-cookie'], /^__Host-open-cartable=;/);
    assert.equal((await call('DELETE', home, [family])).statusCode, 204);
    assert.equal((await call('POST', staff + '/open', both)).statusCode, 404);
    assert.equal((await call('PUT', staff, both, input)).statusCode, 200);
    await transaction(pool, (db) => resetTeacher(db, schoolId, teacherB.id));
    assert.deepEqual((await call('GET', home, [family])).json(), { linked: false });
    assert.equal((await call('GET', staff, both)).statusCode, 401);
    assert.equal((await call('GET', '/parent/children', [family])).json().children.length, 2);
  });
