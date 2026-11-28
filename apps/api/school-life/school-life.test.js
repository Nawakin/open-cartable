import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { PDFDocument } from 'pdf-lib';
import pg from 'pg';
import { Secret, TOTP } from 'otpauth';
import { buildApp } from '../app.js';
import { createParentStore } from '../auth/parent-store.js';
import { hashPassword } from '../auth/password.js';
import { migrate, openDatabase, transaction } from '../db/database.js';
import { demo, seedDemo } from '../db/demo.js';
import { setDirectionPassword } from '../direction/store.js';
import { activateTeacher, createTeacher } from '../teacher/store.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const origin = 'https://ecole.example';
const paris = new Intl.DateTimeFormat('sv-SE', { dateStyle: 'short', timeZone: 'Europe/Paris' });
const next = (days, minutes = 0) => new Date(Date.now() + days * 86_400_000 + minutes * 60_000).toISOString();

test('parcours famille, publications programmées, rentrée et jumelage des appareils',
  { skip: !databaseUrl }, async (context) => {
    const schema = 'school_life_' + randomUUID().replaceAll('-', '');
    const admin = openDatabase(databaseUrl);
    const pool = new pg.Pool({ connectionString: databaseUrl, options: '-c search_path=' + schema });
    const invitationKey = randomBytes(32);
    const store = createParentStore(pool, invitationKey);
    const app = buildApp({
      parentAuth: { store, signingKey: randomBytes(32), webOrigin: origin, pairingKey: invitationKey },
      direction: { pool, webOrigin: origin, invitationKey, totpKey: randomBytes(32), requireTotp: true },
      blogMediaKey: randomBytes(32), webOrigin: origin,
    });
    context.after(async () => {
      await app.close();
      await pool.end();
      try { await admin.query('DROP SCHEMA IF EXISTS ' + schema + ' CASCADE'); }
      finally { await admin.end(); }
    });
    await admin.query('CREATE SCHEMA ' + schema);
    await migrate(pool);
    await seedDemo(pool);
    const { id: schoolId, code: schoolCode } = demo.school;
    const [classA, classB] = demo.classes.map(({ id }) => id);
    const [alice, boris, chloe] = demo.students.map(({ id }) => id);
    const password = randomBytes(24).toString('base64url');
    const credential = await hashPassword(password);
    await transaction(pool, async (db) => {
      await setDirectionPassword(db, schoolId, credential);
      await db.query('INSERT INTO guardian_students (school_id,guardian_id,student_id) VALUES ($1,$2,$3)',
        [schoolId, demo.guardians[1], alice]);
    });
    const call = (method, path, headers = { origin }, payload) => app.inject({ method, url: '/api/v1' + path, headers, payload });
    const check = (res, status = 200) => {
      assert.equal(res.statusCode, status, res.statusCode === status ? undefined : res.body);
      return res.body ? res.json() : undefined;
    };
    function cookies(response, status = 204) {
      assert.equal(response.statusCode, status, response.body);
      return { origin, cookie: response.cookies.map(({ name, value }) => name + '=' + value).join('; ') };
    }

    const stage = cookies(await call('POST', '/direction/auth/login', { origin }, { schoolCode, password }), 202);
    const { secret } = check(await call('POST', '/direction/auth/enrollment', stage));
    const totp = new TOTP({ secret: Secret.fromBase32(secret) });
    const direction = cookies(await call('PUT', '/direction/auth/enrollment', stage, {
      code: totp.generate({ timestamp: Date.now() - 30_000 }),
    }));
    check(await call('GET', '/direction/auth/state', direction));
    const roomTeacher = await transaction(pool, (db) => createTeacher(db, schoolId, 'enseignant-a', [classA]));
    await activateTeacher(pool, { schoolCode, login: 'enseignant-a', code: roomTeacher.code, password });
    const teacher = cookies(await call('POST', '/teacher/auth/login', { origin }, { schoolCode, login: 'enseignant-a', password }));
    check(await call('GET', '/teacher/auth/state', teacher));
    async function parentAt(index) {
      const { code } = await store.invite(schoolCode, demo.guardians[index]);
      return cookies(await call('POST', '/parent/web/auth/login', { origin }, { schoolCode, code }));
    }
    const [first, second] = await Promise.all([parentAt(0), parentAt(1)]);
    check(await call('GET', '/parent/children', first));
    check(await call('GET', '/parent/children', second));

    const activity = { kind: 'announcement', classIds: [], title: 'Note scolaire fictive', body: 'Lisez le document.',
      needsReceipt: true, publishAt: null, startsAt: null, endsAt: null };
    const { guardians } = check(await call('POST', '/direction/activities/audience', direction, { classIds: [] }));
    assert.equal(guardians, 2);
    assert.equal((await call('POST', '/teacher/activities', teacher, activity)).statusCode, 403);
    assert.equal((await call('POST', '/teacher/activities', teacher, { ...activity, classIds: [classB] })).statusCode, 404);
    const { id } = check(await call('POST', '/direction/activities', direction, activity), 201);
    const pdf = await PDFDocument.create();
    pdf.addPage().drawText('Document fictif');
    check(await call('PUT', '/direction/activities/' + id + '/document', direction,
      { content: Buffer.from(await pdf.save()).toString('base64') }), 204);
    assert.equal((await call('GET', '/parent/activities/' + id, first)).statusCode, 404);
    assert.equal((await call('GET', '/parent/activities/' + id + '/document', first)).statusCode, 404);
    check(await call('PUT', '/direction/activities/' + id, direction, { ...activity, publishAt: next(1) }));
    assert.equal((await call('GET', '/parent/activities/' + id, first)).statusCode, 404);
    check(await call('PUT', '/direction/activities/' + id, direction, { ...activity, publishAt: 'now' }));
    const media = await call('GET', '/parent/activities/' + id + '/document', first);
    assert.equal(media.statusCode, 200);
    assert.equal(media.headers['content-type'], 'application/pdf');
    assert.equal(check(await call('GET', '/parent/home?childId=' + alice, first)).actions[0].id, id);
    assert.equal((await call('GET', '/parent/home?childId=' + chloe, first)).statusCode, 404);
    assert.equal((await call('PUT', '/parent/activities/' + id + '/response', { ...first, origin: 'https://autre.example' },
      { childId: null, answer: 'read' })).statusCode, 403);
    check(await call('PUT', '/parent/activities/' + id + '/response', first, { childId: null, answer: 'read' }));
    assert.equal(check(await call('GET', '/parent/home', first)).actions.length, 0);
    assert.equal(check(await call('GET', '/parent/home', second)).actions.length, 1);
    assert.equal(check(await call('GET', '/direction/activities/' + id + '/responses', direction)).responses.length, 1);

    const slotContent = { ...activity, kind: 'slot', title: 'Créneau fictif', needsReceipt: false,
      classIds: [classA], startsAt: next(2), endsAt: next(2, 30), publishAt: 'now' };
    const slot = check(await call('POST', '/teacher/activities', teacher, slotContent), 201);
    assert.equal((await call('POST', '/teacher/activities', teacher, slotContent)).statusCode, 409);
    const booking = { childId: alice, answer: 'booked' };
    const bookings = await Promise.all([first, second].map((parent) =>
      call('PUT', '/parent/activities/' + slot.id + '/response', parent, booking)));
    assert.deepEqual(bookings.map(({ statusCode }) => statusCode).sort(), [200,409]);
    const winner = bookings[0].statusCode === 200 ? first : second;
    const loser = winner === first ? second : first;
    assert.equal(check(await call('GET', '/parent/home', winner)).events[0].title, slotContent.title);
    assert.equal(check(await call('GET', '/parent/home', loser)).events.length, 0);
    check(await call('PUT', '/parent/activities/' + slot.id + '/response', winner, { childId: alice, answer: 'withdraw' }));
    check(await call('PUT', '/parent/activities/' + slot.id + '/response', loser, booking));
    const invitation = check(await call('POST', '/teacher/activities', teacher, {
      ...slotContent, kind: 'invitation', title: 'Réunion fictive', startsAt: next(3), endsAt: next(3, 60),
    }), 201);
    check(await call('PUT', '/parent/activities/' + invitation.id + '/response', first, { childId: alice, answer: 'yes' }));
    check(await call('PUT', '/parent/activities/' + invitation.id + '/response', second, { childId: alice, answer: 'no' }));
    assert.equal(check(await call('GET', '/teacher/activities/' + invitation.id + '/responses', teacher)).responses.length, 2);

    const day = paris.format(new Date(next(3)));
    const absent = (child) => '/parent/children/' + child + '/planned-absences';
    check(await call('PUT', absent(alice), first, { day, reason: 'Rendez-vous' }), 204);
    check(await call('PUT', absent(boris), first, { day, reason: '' }), 204);
    assert.equal((await call('PUT', absent(chloe), first, { day, reason: '' })).statusCode, 404);
    assert.equal(check(await call('GET', absent(alice), second)).absences.length, 0);
    assert.deepEqual(check(await call('GET', '/teacher/planned-absences', teacher)).absences.map(({ childId }) => childId), [alice]);

    const work = { title: 'Lecture fictive', domain: 'Français', description: 'Lire une page.', kind: 'assignment' };
    check(await call('POST', '/teacher/templates', teacher, { name: 'Lecture', kind: 'homework', content: work }), 201);
    assert.deepEqual(check(await call('GET', '/teacher/templates?kind=homework', teacher)).templates[0].content, work);
    const homework = '/teacher/classes/' + classA + '/homework';
    const entry = check(await call('POST', homework, teacher, { date: day, ...work, publishAt: null }), 201);
    assert.equal(check(await call('GET', '/parent/home', first)).assignments.length, 0);
    check(await call('PUT', homework + '/' + entry.id, teacher, { date: day, ...work, publishAt: next(1) }), 204);
    const { rows: [event] } = await pool.query('SELECT deliver_after FROM parent_push_events WHERE homework_id=$1', [entry.id]);
    assert.ok(event.deliver_after > new Date());
    check(await call('PUT', homework + '/' + entry.id, teacher, { date: day, ...work, publishAt: 'now' }), 204);
    assert.equal(check(await call('GET', '/parent/home?childId=' + alice, first)).assignments[0].id, entry.id);
    assert.equal(check(await call('GET', '/parent/home?childId=' + boris, first)).assignments.length, 0);
    const liaison = '/teacher/classes/' + classA + '/liaison';
    const note = check(await call('PUT', liaison + '/schedule', teacher, { day, body: 'Mot à venir.' }));
    assert.equal(check(await call('GET', '/parent/children/' + alice + '/liaison', first)).notes.length, 0);
    check(await call('DELETE', liaison + '/schedule/' + note.id, teacher), 204);
    assert.equal((await pool.query('SELECT 1 FROM parent_push_events WHERE liaison_note_id=$1', [note.id])).rowCount, 0);

    const directory = '/direction/directory';
    const csv = 'type;reference;nom;classe;eleves\nclasse;c1;CP import fictif;;\neleve;e1;Élève importé;c1;\n'
      + 'responsable;r1;Responsable importé;;e1|' + alice;
    const preview = check(await call('POST', directory + '/import/preview', direction, { csv }));
    assert.deepEqual(preview.errors, []);
    assert.deepEqual(preview.items[2].children, ['Élève importé', demo.students[0].name]);
    check(await call('POST', directory + '/import', direction, { csv, tag: preview.tag, acceptHomonyms: false }), 201);
    assert.equal((await call('POST', directory + '/import', direction, { csv, tag: preview.tag, acceptHomonyms: false })).statusCode, 409);
    assert.equal(check(await call('GET', directory + '/access-log', direction)).entries.filter(({ action }) => action === 'linked').length, 2);

    const parentCode = check(await call('POST', '/parent/devices/pair', first)).code;
    const paired = check(await call('POST', '/parent/auth/device-link', {
      'x-open-cartable-platform': 'android', 'x-open-cartable-device-type': 'tablet',
    }, { schoolCode, code: parentCode }));
    assert.equal((await call('POST', '/parent/auth/device-link', {}, { schoolCode, code: parentCode })).statusCode, 401);
    const { devices } = check(await call('GET', '/parent/devices', first));
    assert.equal(devices[0].current, true);
    const linked = devices.find(({ current }) => !current);
    assert.equal(linked.os, 'Android');
    assert.equal(linked.type, 'Tablette');
    check(await call('PUT', '/parent/devices/' + linked.id, first, { name: 'Tablette fictive' }), 204);
    assert.equal((await call('DELETE', '/parent/devices/' + linked.id, second)).statusCode, 404);
    check(await call('DELETE', '/parent/devices/' + linked.id, first), 204);
    assert.equal((await call('GET', '/parent/children', { authorization: 'Bearer ' + paired.accessToken })).statusCode, 401);

    const teacherCode = check(await call('POST', '/teacher/devices/pair', teacher)).code;
    cookies(await call('POST', '/teacher/auth/device-link', { origin }, { schoolCode, code: teacherCode }));
    assert.equal(check(await call('GET', '/teacher/devices', teacher)).devices.length, 2);

    const directorCode = check(await call('POST', '/direction/devices/pair', direction)).code;
    assert.equal((await call('POST', '/direction/auth/device-link', { origin }, { schoolCode, code: directorCode })).statusCode, 400);
    const newDirection = cookies(await call('POST', '/direction/auth/device-link', { origin }, {
      schoolCode, code: directorCode, authenticator: totp.generate(),
    }));
    check(await call('GET', '/direction/classes', newDirection));
    const newDevice = check(await call('GET', '/direction/devices', direction)).devices.find(({ current }) => !current);
    check(await call('DELETE', '/direction/devices/' + newDevice.id, direction), 204);
    assert.equal((await call('GET', '/direction/classes', newDirection)).statusCode, 401);
  });
