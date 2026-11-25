import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import pg from 'pg';
import { buildApp } from '../app.js';
import { migrate, openDatabase } from '../db/database.js';
import { demo, seedDemo } from '../db/demo.js';
import { generateInvitationCode, invitationDigest, refreshDigest } from './credentials.js';
import { createParentStore } from './parent-store.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const schoolCode = demo.school.code;
const [guardianA, guardianB] = demo.guardians;

test('parcours parent sur PostgreSQL', { skip: !databaseUrl }, async (context) => {
  const schema = 'parent_auth_test_' + randomUUID().replaceAll('-', '');
  const admin = openDatabase(databaseUrl);
  context.after(async () => {
    try {
      await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    } finally {
      await admin.end();
    }
  });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` });
  const store = createParentStore(pool, randomBytes(32));
  const app = buildApp({ parentAuth: { store, signingKey: randomBytes(32) } });
  context.after(async () => {
    await app.close();
    await pool.end();
  });
  const scope = await pool.query('SELECT current_schema() AS name');
  assert.equal(scope.rows[0].name, schema);
  await migrate(pool);
  await migrate(pool);
  await seedDemo(pool);

  const endpoint = '/api/v1/parent';
  const unauthorized = { error: 'Identifiants non valides.' };
  let address = 0;
  const post = (path, payload, remoteAddress = `192.0.2.${++address}`) => app.inject({
    method: 'POST', url: endpoint + path, payload, remoteAddress,
  });
  const redeem = (code, school = schoolCode) => post('/auth/invitations/redeem', { schoolCode: school, code });
  const refresh = (refreshToken) => post('/auth/refresh', { refreshToken });
  const authorize = (accessToken) => ({ authorization: `Bearer ${accessToken}` });
  const children = (accessToken, query = '') => app.inject({
    url: endpoint + '/children' + query,
    headers: accessToken ? authorize(accessToken) : {},
  });
  const login = async (guardianId, school = schoolCode) => {
    const invitation = await store.invite(school, guardianId);
    const response = await redeem(invitation.code, school);
    assert.equal(response.statusCode, 200);
    return response.json();
  };

  await context.test('une invitation concurrente crée une seule session et reste liée à son école', async () => {
    assert.equal((await children()).statusCode, 401);
    const { code } = await store.invite(schoolCode, guardianA);
    const wrongSchool = await redeem(code, 'AUTRE-ECOLE');
    assert.equal(wrongSchool.statusCode, 401);
    assert.deepEqual(wrongSchool.json(), unauthorized);
    const attempts = await Promise.all([redeem(code), redeem(code)]);
    assert.deepEqual(attempts.map(({ statusCode }) => statusCode).sort(), [200, 401]);
    const success = attempts.find(({ statusCode }) => statusCode === 200);
    assert.equal(success.headers['cache-control'], 'no-store');
    const { accessToken, refreshToken, expiresIn } = success.json();
    assert.equal(expiresIn, 900);
    const sessions = await pool.query('SELECT count(*)::int AS count FROM parent_sessions');
    assert.equal(sessions.rows[0].count, 1);
    const refreshRow = await pool.query('SELECT digest FROM parent_refresh_tokens');
    assert.deepEqual(refreshRow.rows[0].digest, refreshDigest(refreshToken));

    const list = await children(accessToken, `?guardianId=${guardianB}`);
    assert.equal(list.statusCode, 200);
    assert.equal(list.headers['cache-control'], 'no-store');
    assert.deepEqual(list.json().children.map(({ id }) => id), demo.students.slice(0, 2).map(({ id }) => id));
    const other = await login(guardianB);
    const otherList = await children(other.accessToken);
    assert.deepEqual(otherList.json().children.map(({ id }) => id), [demo.students[2].id]);
    assert.equal((await children('not-a-jwt')).statusCode, 401);
  });

  await context.test('le même identifiant de tuteur dans deux écoles conserve des périmètres distincts', async () => {
    const schoolId = randomUUID();
    const otherSchool = 'AUTRE-ECOLE';
    await pool.query('INSERT INTO schools (id, code) VALUES ($1, $2)', [schoolId, otherSchool]);
    await pool.query('INSERT INTO guardians (school_id, id) VALUES ($1, $2)', [schoolId, guardianA]);
    const { accessToken } = await login(guardianA, otherSchool);
    const list = await children(accessToken);
    assert.equal(list.statusCode, 200);
    assert.deepEqual(list.json(), { children: [] });
    await assert.rejects(pool.query(
      'INSERT INTO guardian_students (school_id, guardian_id, student_id) VALUES ($1, $2, $3)',
      [schoolId, guardianA, demo.students[0].id],
    ), { code: '23503' });
  });

  await context.test('le périmètre suit immédiatement les liens de tutelle', async () => {
    const { accessToken } = await login(guardianA);
    const studentId = demo.students[1].id;
    await pool.query('DELETE FROM guardian_students WHERE school_id = $1 AND guardian_id = $2 AND student_id = $3',
      [demo.school.id, guardianA, studentId]);
    const list = await children(accessToken);
    assert.deepEqual(list.json().children.map(({ id }) => id), [demo.students[0].id]);
  });

  await context.test('la rotation concurrente n’accorde qu’un renouvellement et la réutilisation révoque la session', async () => {
    const initial = await login(guardianA);
    const attempts = await Promise.all([refresh(initial.refreshToken), refresh(initial.refreshToken)]);
    assert.deepEqual(attempts.map(({ statusCode }) => statusCode).sort(), [200, 401]);
    const rotated = attempts.find(({ statusCode }) => statusCode === 200).json();
    assert.notEqual(rotated.refreshToken, initial.refreshToken);
    assert.equal((await refresh(rotated.refreshToken)).statusCode, 401);
    assert.equal((await children(initial.accessToken)).statusCode, 401);
    assert.equal((await children(rotated.accessToken)).statusCode, 401);
  });

  await context.test('un renouvellement normal fonctionne et la déconnexion ferme la session', async () => {
    const initial = await login(guardianA);
    const result = await refresh(initial.refreshToken);
    assert.equal(result.statusCode, 200);
    const rotated = result.json();
    assert.equal((await children(rotated.accessToken)).statusCode, 200);
    const logout = await app.inject({
      method: 'POST', url: endpoint + '/auth/logout', headers: authorize(rotated.accessToken),
    });
    assert.equal(logout.statusCode, 204);
    assert.equal((await children(rotated.accessToken)).statusCode, 401);
    assert.equal((await refresh(rotated.refreshToken)).statusCode, 401);
  });

  await context.test('le remplacement révoque les accès et invitations du compte ciblé', async () => {
    const initial = await login(guardianA);
    const other = await login(guardianB);
    const pending = await store.invite(schoolCode, guardianA);
    const replacement = await store.invite(schoolCode, guardianA, true);
    assert.equal((await children(initial.accessToken)).statusCode, 401);
    assert.equal((await refresh(initial.refreshToken)).statusCode, 401);
    assert.equal((await redeem(pending.code)).statusCode, 401);
    assert.equal((await children(other.accessToken)).statusCode, 200);
    assert.equal((await redeem(replacement.code)).statusCode, 200);
  });

  await context.test('une invitation et une session expirées sont refusées', async () => {
    const invitationKey = randomBytes(32);
    const expiredStore = createParentStore(pool, invitationKey);
    const pending = await expiredStore.invite(schoolCode, guardianA);
    await pool.query('UPDATE parent_invitations SET expires_at = now() WHERE digest = $1',
      [invitationDigest(invitationKey, schoolCode, pending.code)]);
    assert.equal(await expiredStore.redeem(schoolCode, pending.code), null);

    const session = await login(guardianA);
    await pool.query('UPDATE parent_sessions SET expires_at = now() WHERE id = (SELECT session_id FROM parent_refresh_tokens WHERE digest = $1)',
      [refreshDigest(session.refreshToken)]);
    assert.equal((await refresh(session.refreshToken)).statusCode, 401);
    assert.equal((await children(session.accessToken)).statusCode, 401);
  });

  await context.test('la validation et le quota par IP couvrent les demandes de connexion', async () => {
    const invalid = await post('/auth/invitations/redeem', { schoolCode, code: 1234, role: 'direction' });
    assert.equal(invalid.statusCode, 400);
    const ip = '192.0.2.200';
    const payload = { schoolCode, code: generateInvitationCode() };
    for (let i = 0; i < 10; i++) {
      assert.equal((await post('/auth/invitations/redeem', payload, ip)).statusCode, 401);
    }
    const blocked = await post('/auth/invitations/redeem', payload, ip);
    assert.equal(blocked.statusCode, 429);
    assert.ok(blocked.headers['retry-after']);
    assert.equal(blocked.headers['cache-control'], 'no-store');
  });
});
