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
import { purgeExpiredMessages } from './retention.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const webOrigin = 'https://ent.ecole.example';
const parentPath = '/parent/messages/conversations';
const directionPath = '/direction/messages/conversations';

test('La messagerie isole les familles et écoles, pagine et purge les messages privés', { skip: !databaseUrl }, async (context) => {
  const schema = 'messages_test_' + randomUUID().replaceAll('-', '');
  const admin = openDatabase(databaseUrl);
  const pool = new pg.Pool({ connectionString: databaseUrl, options: '-c search_path=' + schema });
  const store = createParentStore(pool, randomBytes(32));
  const app = buildApp({ parentAuth: { store, signingKey: randomBytes(32), webOrigin }, direction: { pool, webOrigin } });
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

  const schoolCode = demo.school.code;
  const password = randomBytes(24).toString('base64url');
  const credential = await hashPassword(password);
  const foreignSchool = randomUUID();
  const foreignCode = 'AUTRE-ECOLE';
  await transaction(pool, async (db) => {
    await db.query('INSERT INTO schools (id, code) VALUES ($1, $2)', [foreignSchool, foreignCode]);
    await setDirectionPassword(db, demo.school.id, credential);
    await setDirectionPassword(db, foreignSchool, credential);
    await db.query('INSERT INTO guardian_students (school_id, guardian_id, student_id) VALUES ($1, $2, $3)',
      [demo.school.id, demo.guardians[1], demo.students[0].id]);
  });

  const call = (method, path, headers, payload) => app.inject({ method, url: '/api/v1' + path, headers, payload });
  function cookie(response) {
    assert.equal(response.statusCode, 204);
    return { cookie: response.headers['set-cookie'].split(';')[0], origin: webOrigin };
  }
  const direction = cookie(await call('POST', '/direction/auth/login', { origin: webOrigin }, { schoolCode, password }));
  const foreign = cookie(await call('POST', '/direction/auth/login', { origin: webOrigin }, { schoolCode: foreignCode, password }));
  const firstInvite = await store.invite(schoolCode, demo.guardians[0]);
  const firstLogin = await call('POST', '/parent/auth/invitations/redeem', {}, { schoolCode, code: firstInvite.code });
  assert.equal(firstLogin.statusCode, 200);
  const first = { authorization: 'Bearer ' + firstLogin.json().accessToken };
  const secondInvite = await store.invite(schoolCode, demo.guardians[1]);
  const second = cookie(await call('POST', '/parent/web/auth/login', { origin: webOrigin }, { schoolCode, code: secondInvite.code }));
  const ownInvite = await store.invite(schoolCode, demo.guardians[0]);
  const firstBrowser = cookie(await call('POST', '/parent/web/auth/login', { origin: webOrigin }, { schoolCode, code: ownInvite.code }));

  const draft = { childId: demo.students[0].id, subject: 'Question fictive', body: '<b>Texte brut</b>\nSuite.' };
  assert.equal((await call('POST', parentPath, { ...second, origin: 'https://ailleurs.example' }, draft)).statusCode, 403);
  assert.equal((await call('POST', parentPath, { ...second, authorization: 'Bearer invalide' }, draft)).statusCode, 401);
  assert.equal((await call('POST', parentPath, first, { ...draft, childId: randomUUID() })).statusCode, 404);
  assert.equal((await call('POST', parentPath, first, { ...draft, body: ' ' })).statusCode, 400);
  const created = await call('POST', parentPath, first, draft);
  assert.equal(created.statusCode, 201);
  const { id } = created.json();
  const parentItem = parentPath + '/' + id;
  const directionItem = directionPath + '/' + id;
  const read = await call('GET', parentItem, firstBrowser);
  assert.equal(read.statusCode, 200);
  assert.equal(read.headers['cache-control'], 'no-store');
  assert.equal(read.json().messages[0].body, draft.body);
  assert.equal(read.json().conversation.guardianReference, null);
  assert.deepEqual((await call('GET', parentPath, second)).json().conversations, []);
  assert.equal((await call('GET', parentItem, second)).statusCode, 404);
  assert.equal((await call('POST', parentItem, second, { body: 'Intrus' })).statusCode, 404);
  assert.equal((await call('GET', directionItem, firstBrowser)).statusCode, 401);
  assert.deepEqual((await call('GET', directionPath, foreign)).json().conversations, []);
  assert.equal((await call('GET', directionItem, foreign)).statusCode, 404);
  assert.equal((await call('POST', directionItem, foreign, { body: 'Intrus' })).statusCode, 404);
  assert.equal((await call('GET', '/teacher/messages/conversations', direction)).statusCode, 404);
  const staffThread = await call('GET', directionItem, direction);
  assert.equal(staffThread.headers['cache-control'], 'no-store');
  assert.equal(staffThread.json().conversation.guardianReference, demo.guardians[0]);
  assert.equal((await call('POST', directionItem, { ...direction, origin: 'https://ailleurs.example' }, { body: 'Intrus' })).statusCode, 403);

  const answer = await call('POST', directionItem, direction, { body: 'Réponse fictive.' });
  assert.equal(answer.statusCode, 201);
  const afterReply = (await call('GET', parentItem, first)).json();
  assert.deepEqual(afterReply.messages.map(({ sender, body }) => [sender, body]), [
    ['direction', 'Réponse fictive.'], ['parent', draft.body],
  ]);

  await pool.query(`
    INSERT INTO direction_messages (school_id, conversation_id, id, sender, body, sent_at)
    SELECT $1, $2, gen_random_uuid(), 'direction', 'Test de pagination', statement_timestamp() - minutes * interval '1 minute'
    FROM generate_series(1, 30) minutes
  `, [demo.school.id, id]);
  const latest = (await call('GET', parentItem, first)).json();
  assert.equal(latest.messages.length, 30);
  assert.ok(latest.nextCursor);
  const older = await call('GET', parentItem + '?cursor=' + encodeURIComponent(latest.nextCursor), first);
  assert.equal(older.statusCode, 200);
  assert.equal(older.json().nextCursor, null);
  const ids = new Set([...latest.messages, ...older.json().messages].map((message) => message.id));
  assert.equal(ids.size, 32);

  const expired = randomUUID();
  await pool.query(`
    INSERT INTO direction_conversations (school_id, id, guardian_id, student_id, subject, last_message_at)
    VALUES ($1, $2, $3, $4, 'Conversation expirée', statement_timestamp() - interval '2 years')
  `, [demo.school.id, expired, demo.guardians[0], demo.students[0].id]);
  await pool.query(`
    INSERT INTO direction_messages (school_id, conversation_id, id, sender, body, sent_at)
    VALUES ($1, $2, gen_random_uuid(), 'parent', 'Message expiré', statement_timestamp() - interval '2 years')
  `, [demo.school.id, id]);
  assert.equal((await call('GET', parentPath + '/' + expired, first)).statusCode, 404);
  const beforePurge = (await call('GET', parentItem + '?cursor=' + encodeURIComponent(latest.nextCursor), first)).json();
  assert.equal(beforePurge.messages.length, 2);
  await purgeExpiredMessages(pool);
  assert.equal((await pool.query('SELECT 1 FROM direction_conversations WHERE id = $1', [expired])).rowCount, 0);
  assert.equal((await pool.query("SELECT 1 FROM direction_messages WHERE body = 'Message expiré'")).rowCount, 0);
  assert.equal((await pool.query('SELECT 1 FROM direction_messages WHERE conversation_id = $1', [id])).rowCount, 32);

  await pool.query('DELETE FROM guardian_students WHERE school_id = $1 AND guardian_id = $2 AND student_id = $3',
    [demo.school.id, demo.guardians[0], demo.students[0].id]);
  assert.equal((await call('GET', directionItem, direction)).statusCode, 404);
  assert.equal((await pool.query('SELECT 1 FROM direction_messages WHERE conversation_id = $1', [id])).rowCount, 0);
});
