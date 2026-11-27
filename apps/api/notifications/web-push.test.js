import assert from 'node:assert/strict';
import { createECDH, randomBytes, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import pg from 'pg';
import { buildApp } from '../app.js';
import { createParentStore } from '../auth/parent-store.js';
import { migrate, openDatabase } from '../db/database.js';
import { demo, seedDemo } from '../db/demo.js';
import { dispatchParentPush, webPushSettings } from './web-push.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const origin = 'https://ent.ecole.example';
const endpoint = '/api/v1/parent/web/notifications';

test('les préférences de notification et les rappels respectent la tutelle et les changements d’état',
  { skip: !databaseUrl }, async (context) => {
    const name = 'push_test_' + randomUUID().replaceAll('-', '');
    const admin = openDatabase(databaseUrl);
    const pool = new pg.Pool({ connectionString: databaseUrl, options: '-c search_path=' + name });
    const store = createParentStore(pool, randomBytes(32));
    const webPush = webPushSettings(randomBytes(32).toString('hex'), origin);
    const app = buildApp({ parentAuth: { store, signingKey: randomBytes(32), webOrigin: origin }, webPush });
    context.after(async () => {
      await app.close();
      await pool.end();
      try { await admin.query('DROP SCHEMA IF EXISTS ' + name + ' CASCADE'); }
      finally { await admin.end(); }
    });
    await admin.query('CREATE SCHEMA ' + name);
    await migrate(pool);
    await seedDemo(pool);

    function call(method, headers, payload) {
      return app.inject({ method, url: endpoint, headers, payload });
    }

    async function connect(guardianId, tag) {
      const { code } = await store.invite(demo.school.code, guardianId);
      const response = await app.inject({ method: 'POST', url: '/api/v1/parent/web/auth/login',
        headers: { origin }, payload: { schoolCode: demo.school.code, code } });
      assert.equal(response.statusCode, 204);
      const headers = { origin, cookie: response.headers['set-cookie'].split(';')[0] };
      const subscription = {
        endpoint: 'https://fcm.googleapis.com/fcm/send/demonstration-' + tag,
        p256dh: createECDH('prime256v1').generateKeys().toString('base64url'), auth: randomBytes(16).toString('base64url'),
        payloadVersion: 2,
      };
      assert.equal((await call('PUT', headers, subscription)).statusCode, 204);
      return { headers, url: subscription.endpoint };
    }

    const guardian = await connect(demo.guardians[0], 'a');
    const other = await connect(demo.guardians[1], 'b');
    const preferences = { categories: ['agenda', 'attendance'], weekends: true };
    assert.equal((await call('PATCH', { ...guardian.headers, origin: 'https://ailleurs.example' }, preferences)).statusCode, 403);
    assert.equal((await call('PATCH', guardian.headers, { ...preferences, categories: ['blog', 'blog'] })).statusCode, 400);
    assert.deepEqual((await call('PATCH', guardian.headers, preferences)).json(), { ...preferences, payloadVersion: 2 });
    assert.equal((await call('PATCH', other.headers, { ...preferences, weekends: false })).statusCode, 200);
    assert.equal((await call('GET', other.headers)).json().weekends, false);

    const [classA] = demo.classes;
    const [childA, , childC] = demo.students;
    const schoolId = demo.school.id;
    const appointment = randomUUID();
    const canceled = randomUUID();
    await pool.query(`
      INSERT INTO agenda_events (school_id,id,class_id,starts_at,ends_at,title,location,description,
        appointment_guardian_id,appointment_student_id)
      VALUES ($1,$2,$3,statement_timestamp() + interval '48 hours',statement_timestamp() + interval '49 hours',
        'Rendez-vous fictif','','',$4,$5),
        ($1,$6,$3,statement_timestamp() + interval '48 hours',statement_timestamp() + interval '49 hours',
        'Sortie annulée','','',NULL,NULL)
    `, [schoolId, appointment, classA.id, demo.guardians[0], childA.id, canceled]);
    const scheduled = async () => (await pool.query(`
      SELECT id, deliver_after, deliver_until FROM parent_push_events WHERE agenda_id = $1 AND kind = 'agenda-reminder'
    `, [appointment])).rows[0];
    const before = await scheduled();
    assert.equal(before.deliver_until - before.deliver_after, 4 * 3_600_000);
    await pool.query(`UPDATE agenda_events SET starts_at = starts_at + interval '1 hour', ends_at = ends_at + interval '1 hour'
      WHERE (school_id,id) = ($1,$2)`, [schoolId, appointment]);
    const after = await scheduled();
    assert.notEqual(after.id, before.id);
    assert.equal(after.deliver_after - before.deliver_after, 3_600_000);
    await pool.query('DELETE FROM agenda_events WHERE (school_id,id) = ($1,$2)', [schoolId, canceled]);
    assert.equal((await pool.query('SELECT 1 FROM parent_push_events WHERE agenda_id = $1', [canceled])).rowCount, 0);

    await pool.query(`
      INSERT INTO attendance_rolls (school_id,class_id,day,revision)
      VALUES ($1,$2,(statement_timestamp() AT TIME ZONE 'Europe/Paris')::date,gen_random_uuid())
    `, [schoolId, classA.id]);
    await pool.query(`
      INSERT INTO attendance_entries (school_id,class_id,day,student_id,status)
      SELECT school_id,class_id,day,student_id,'absent' FROM attendance_rolls
      CROSS JOIN unnest($3::uuid[]) AS student_id WHERE (school_id,class_id) = ($1,$2)
    `, [schoolId, classA.id, [childA.id, childC.id]]);
    const pending = (await pool.query(`
      SELECT to_char(deliver_after AT TIME ZONE 'Europe/Paris','HH24:MI') AS hour
      FROM parent_push_events WHERE kind = 'attendance'
    `)).rows;
    assert.deepEqual(pending.map(({ hour }) => hour), ['09:00', '09:00']);
    await pool.query(`
      INSERT INTO absence_justifications (school_id,class_id,day,student_id,guardian_id,kind,content)
      SELECT school_id,class_id,day,student_id,$3,'pdf',decode('00','hex') FROM attendance_entries
      WHERE (school_id,class_id,student_id) = ($1,$2,$4)
    `, [schoolId, classA.id, demo.guardians[1], childC.id]);
    await pool.query(`
      INSERT INTO homework_entries (school_id,class_id,id,entry_date,title,domain,description)
      VALUES ($1,$2,gen_random_uuid(),CURRENT_DATE,'Travail fictif','Lecture','Préparer le texte.')
    `, [schoolId, classA.id]);

    await pool.query(`
      UPDATE parent_push_events SET deliver_after = statement_timestamp()
      WHERE kind IN ('agenda-reminder','attendance')
    `);
    const received = [];
    const send = async ({ endpoint: recipient }, kind) => received.push([recipient, kind]);
    await Promise.all([dispatchParentPush(pool, webPush, send), dispatchParentPush(pool, webPush, send)]);
    assert.deepEqual(received.sort(), [[guardian.url, 'agenda-reminder'], [guardian.url, 'attendance']]);
    await pool.query("UPDATE parent_push_subscriptions SET attempted_at = '-infinity'");
    await dispatchParentPush(pool, webPush, send);
    assert.equal(received.length, 2, 'Les événements déjà envoyés sont acquittés pour cette session.');

    await pool.query("UPDATE parent_push_subscriptions SET subscribed_at = statement_timestamp() - interval '10 days'");
    await pool.query(`
      INSERT INTO parent_push_events (school_id, class_id, kind, deliver_after, deliver_until)
      VALUES ($1,$2,'agenda',
        (date_trunc('week', statement_timestamp() AT TIME ZONE 'Europe/Paris') - interval '2 days') AT TIME ZONE 'Europe/Paris',
        statement_timestamp() + interval '1 minute')
    `, [schoolId, classA.id]);
    await dispatchParentPush(pool, webPush, send);
    assert.deepEqual(received.slice(2), [[guardian.url, 'agenda']]);

    const nextPreferences = { categories: ['assignments', 'reports', 'agenda-reminder'], weekends: true };
    for (const { headers } of [guardian, other]) {
      assert.equal((await call('PATCH', headers, { payloadVersion: 3 })).statusCode, 200);
      assert.deepEqual((await call('PATCH', headers, nextPreferences)).json(), { ...nextPreferences, payloadVersion: 3 });
    }
    const assignment = randomUUID();
    await pool.query(`
      INSERT INTO homework_entries (school_id,class_id,id,entry_date,title,domain,description,kind)
      VALUES ($1,$2,$3,(statement_timestamp() AT TIME ZONE 'Europe/Paris')::date + 3,
        'Lecture à rendre','Lecture','Préparer le texte.','assignment')
    `, [schoolId, classA.id, assignment]);
    const report = randomUUID();
    await pool.query(`
      INSERT INTO school_reports (school_id,id,class_id,student_id,school_year,term,assessments,revision)
      VALUES ($1,$2,$3,$4,2026,1,'[]',gen_random_uuid())
    `, [schoolId, report, classA.id, childA.id]);
    assert.equal((await pool.query("SELECT 1 FROM parent_push_events WHERE kind = 'reports'")).rowCount, 0);
    await pool.query('UPDATE school_reports SET published = true WHERE (school_id,id) = ($1,$2)', [schoolId, report]);
    await pool.query("UPDATE parent_push_subscriptions SET attempted_at = '-infinity'");
    await dispatchParentPush(pool, webPush, send);
    assert.deepEqual(received.slice(3).sort(), [
      [guardian.url, 'assignments'], [guardian.url, 'reports'], [other.url, 'assignments'],
    ]);
    const upcoming = await app.inject({ url: '/api/v1/parent/assignments/next', headers: guardian.headers });
    assert.equal(upcoming.statusCode, 200);
    assert.deepEqual(upcoming.json().assignments.map(({ id, child }) => [id, child.id]), [[assignment, childA.id]]);
    const date = upcoming.json().assignments[0].date;
    const agenda = await app.inject({
      url: '/api/v1/parent/children/' + childA.id + '/homework?from=' + date + '&to=' + date + '&kind=assignment',
      headers: guardian.headers,
    });
    assert.deepEqual(agenda.json().entries.map(({ id, kind }) => [id, kind]), [[assignment, 'assignment']]);

    assert.equal((await call('PATCH', guardian.headers, preferences)).statusCode, 200);
    assert.equal((await call('PATCH', other.headers, { ...preferences, weekends: false })).statusCode, 200);
    await pool.query('DELETE FROM guardian_students WHERE (school_id,guardian_id,student_id) = ($1,$2,$3)',
      [schoolId, demo.guardians[0], childA.id]);
    await pool.query("UPDATE parent_push_subscriptions SET attempted_at = '-infinity'");
    await pool.query(`
      INSERT INTO parent_push_events (school_id,class_id,student_id,kind)
      VALUES ($1,$2,$3,'attendance')
    `, [schoolId, classA.id, childA.id]);
    await dispatchParentPush(pool, webPush, send);
    assert.equal(received.length, 6);
    assert.equal((await call('DELETE', guardian.headers)).statusCode, 204);
    assert.equal((await call('PATCH', guardian.headers, { payloadVersion: 2 })).statusCode, 404);
  });
