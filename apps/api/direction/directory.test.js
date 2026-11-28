import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import pg from 'pg';
import { buildApp } from '../app.js';
import { createParentStore } from '../auth/parent-store.js';
import { hashPassword } from '../auth/password.js';
import { migrate, openDatabase, transaction } from '../db/database.js';
import { demo, seedDemo } from '../db/demo.js';
import { setDirectionPassword } from './store.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const origin = 'https://ent.ecole.example';

test('un code par responsable donne accès à sa fratrie et isole les échanges privés',
  { skip: !databaseUrl }, async (context) => {
    const schema = 'family_test_' + randomUUID().replaceAll('-', '');
    const admin = openDatabase(databaseUrl);
    const pool = new pg.Pool({ connectionString: databaseUrl, options: '-c search_path=' + schema });
    const invitationKey = randomBytes(32);
    const store = createParentStore(pool, invitationKey);
    const app = buildApp({
      parentAuth: { store, signingKey: randomBytes(32), webOrigin: origin },
      direction: { pool, webOrigin: origin, invitationKey },
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
    const password = randomBytes(24).toString('base64url');
    const credential = await hashPassword(password);
    await transaction(pool, (db) => setDirectionPassword(db, schoolId, credential));

    const call = (method, path, headers, payload) => app.inject({ method, url: '/api/v1' + path, headers, payload });
    function cookie(response) {
      assert.equal(response.statusCode, 204);
      return { origin, cookie: response.headers['set-cookie'].split(';')[0] };
    }
    const direction = cookie(await call('POST', '/direction/auth/login', { origin }, { schoolCode, password }));
    const directory = '/direction/directory';
    const [alice, boris, chloe] = demo.students.map(({ id }) => id);
    const recordA = { displayName: 'Responsable fictif A', studentIds: [alice, boris], active: true };
    const recordB = { displayName: 'Responsable fictif B', studentIds: [alice, boris, chloe], active: true };
    async function createGuardian(record) {
      const response = await call('POST', directory + '/guardians', direction, record);
      assert.equal(response.statusCode, 201);
      return response.json().id;
    }
    const guardianA = await createGuardian(recordA);
    const guardianB = await createGuardian(recordB);
    const issue = await call('POST', directory + '/invitations', direction,
      { guardianIds: [guardianA, guardianB], replaceSessions: false });
    assert.equal(issue.statusCode, 201);
    assert.equal(issue.json().invitations.length, 2);
    const codes = new Map(issue.json().invitations.map(({ id, code }) => [id, code]));
    assert.notEqual(codes.get(guardianA), codes.get(guardianB));

    const first = cookie(await call('POST', '/parent/web/auth/login', { origin }, { schoolCode, code: codes.get(guardianA) }));
    const redeemed = await call('POST', '/parent/auth/invitations/redeem', {}, { schoolCode, code: codes.get(guardianB) });
    assert.equal(redeemed.statusCode, 200);
    const second = { authorization: 'Bearer ' + redeemed.json().accessToken };
    assert.equal((await call('POST', '/parent/auth/invitations/redeem', {}, { schoolCode, code: codes.get(guardianB) })).statusCode, 401);

    async function childrenOf(headers) {
      const response = await call('GET', '/parent/children', headers);
      assert.equal(response.statusCode, 200);
      return response.json().children.map(({ id }) => id);
    }
    const homework = (id, headers) => call('GET',
      '/parent/children/' + id + '/homework?from=2026-11-28&to=2026-11-28', headers);
    assert.deepEqual(await childrenOf(first), [alice, boris]);
    assert.deepEqual(await childrenOf(second), [alice, boris, chloe]);
    for (const child of [alice, boris]) {
      assert.equal((await homework(child, first)).statusCode, 200);
      assert.equal((await homework(child, second)).statusCode, 200);
    }
    assert.equal((await homework(chloe, first)).statusCode, 404);
    assert.equal((await homework(chloe, second)).statusCode, 200);

    const messages = '/parent/messages/conversations';
    const sent = await call('POST', messages, second, { childId: alice, subject: 'Question fictive', body: 'Échange privé.' });
    assert.equal(sent.statusCode, 201);
    const thread = messages + '/' + sent.json().id;
    assert.equal((await call('GET', thread, second)).statusCode, 200);
    assert.equal((await call('GET', thread, first)).statusCode, 404);

    // Une modification dans l’annuaire s’applique aux sessions déjà ouvertes.
    assert.equal((await call('PUT', directory + '/guardians/' + guardianA, direction, { ...recordA, studentIds: [boris] })).statusCode, 200);
    assert.deepEqual(await childrenOf(first), [boris]);
    assert.deepEqual(await childrenOf(second), [alice, boris, chloe]);
    assert.equal((await homework(alice, first)).statusCode, 404);
    assert.equal((await homework(alice, second)).statusCode, 200);

    assert.equal((await call('PUT', directory + '/guardians/' + guardianA, direction, recordA)).statusCode, 200);
    assert.deepEqual(await childrenOf(first), [alice, boris]);
    assert.equal((await call('GET', thread, first)).statusCode, 404);
  });
