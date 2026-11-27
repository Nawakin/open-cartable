import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import pg from 'pg';
import { buildApp } from '../app.js';
import { createParentStore } from '../auth/parent-store.js';
import { migrate, openDatabase } from '../db/database.js';
import { demo, seedDemo } from '../db/demo.js';
import { dispatchParentPush } from './web-push.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const origin = 'https://ent.ecole.example';
const endpoint = '/api/v1/parent/notifications/fcm';

test('le push natif respecte la session, la tutelle et la réattribution explicite de l’appareil',
  { skip: !databaseUrl }, async (context) => {
    const name = 'native_push_test_' + randomUUID().replaceAll('-', '');
    const admin = openDatabase(databaseUrl);
    const pool = new pg.Pool({ connectionString: databaseUrl, options: '-c search_path=' + name });
    const store = createParentStore(pool, randomBytes(32));
    const sent = [];
    const nativePush = { key: randomBytes(32), transports: { fcm: {
      async send(token, kind) { sent.push({ token, kind }); },
    } } };
    const app = buildApp({ parentAuth: { store, signingKey: randomBytes(32), webOrigin: origin }, nativePush });
    context.after(async () => {
      await app.close();
      await pool.end();
      try { await admin.query('DROP SCHEMA IF EXISTS ' + name + ' CASCADE'); }
      finally { await admin.end(); }
    });
    await admin.query('CREATE SCHEMA ' + name);
    await migrate(pool);
    await seedDemo(pool);

    function call(method, url, headers, payload) {
      return app.inject({ method, url, headers, payload });
    }
    async function parent(id, browser = false) {
      const { code } = await store.invite(demo.school.code, id);
      const url = '/api/v1/parent/' + (browser ? 'web/auth/login' : 'auth/invitations/redeem');
      const response = await call('POST', url, { origin }, { code, schoolCode: demo.school.code });
      assert.equal(response.statusCode, browser ? 204 : 200);
      return browser ? { cookie: response.headers['set-cookie'].split(';')[0] }
        : { authorization: 'Bearer ' + response.json().accessToken };
    }

    const browser = await parent(demo.guardians[0], true);
    const first = await parent(demo.guardians[0]);
    const other = await parent(demo.guardians[1]);
    const token = 'A'.repeat(64);
    const rotated = 'B'.repeat(64);
    assert.equal((await call('GET', endpoint, browser)).statusCode, 401);
    assert.equal((await call('GET', endpoint.replace('fcm', 'apns'), first)).statusCode, 404);
    assert.equal((await call('PATCH', endpoint + '/token', first, { token })).statusCode, 404);
    assert.equal((await call('PUT', endpoint, first, { token })).statusCode, 204);
    assert.equal((await call('PATCH', endpoint, first, { categories: ['homework'], weekends: true })).statusCode, 200);
    assert.equal((await call('PATCH', endpoint + '/token', first, { token: rotated })).statusCode, 204);
    const preferences = (await call('GET', endpoint, first)).json();
    assert.deepEqual(preferences.categories, ['homework']);
    assert.equal(Object.hasOwn(preferences, 'token'), false);
    const { rows: [stored] } = await pool.query('SELECT subscription, device_digest, transport FROM parent_push_subscriptions');
    assert.equal(stored.transport, 'fcm');
    assert.equal(stored.device_digest.length, 32);
    assert.equal(stored.subscription.includes(Buffer.from(rotated)), false);

    async function publish(classroom) {
      await pool.query(`
        INSERT INTO homework_entries (school_id,class_id,id,entry_date,title,domain,description)
        VALUES ($1,$2,gen_random_uuid(),CURRENT_DATE,'Travail fictif','Lecture','Lire une page.')
      `, [demo.school.id, classroom.id]);
    }
    await publish(demo.classes[1]);
    await dispatchParentPush(pool, nativePush);
    assert.deepEqual(sent, [{ token: rotated, kind: 'homework' }]);
    assert.equal((await call('PUT', endpoint, other, { token: rotated })).statusCode, 204);
    assert.equal((await call('GET', endpoint, first)).json().enabled, false);
    assert.equal((await call('PATCH', endpoint + '/token', first, { token: rotated })).statusCode, 404);
    await publish(demo.classes[1]);
    await dispatchParentPush(pool, nativePush);
    assert.equal(sent.length, 1);
    await publish(demo.classes[0]);
    await dispatchParentPush(pool, nativePush);
    assert.equal(sent.length, 2);
    assert.equal((await call('POST', '/api/v1/parent/auth/logout', other)).statusCode, 204);
    await publish(demo.classes[0]);
    await dispatchParentPush(pool, nativePush);
    assert.equal(sent.length, 2);
    assert.equal((await pool.query("SELECT 1 FROM parent_push_subscriptions WHERE transport = 'fcm'")).rowCount, 0);
  });
