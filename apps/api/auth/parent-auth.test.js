import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import pg from 'pg';
import { buildApp } from '../app.js';
import { migrate, openDatabase } from '../db/database.js';
import { demo, seedDemo } from '../db/demo.js';
import { createEntry, deleteEntry, readEntry, updateEntry } from '../homework/entries.js';
import { generateInvitationCode, invitationDigest, refreshDigest } from './credentials.js';
import { createParentStore } from './parent-store.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const schoolCode = demo.school.code;
const webOrigin = 'https://ent.ecole.example';
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
  const app = buildApp({ parentAuth: { store, signingKey: randomBytes(32), webOrigin } });
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
  const webPost = (path, { origin, cookie, payload }) => app.inject({
    method: 'POST', url: endpoint + '/web/auth/' + path, payload,
    headers: { ...(origin === undefined ? {} : { origin }), ...(cookie ? { cookie } : {}) },
  });
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

  const homework = (headers, childId, filters = { from: '2026-11-01', to: '2026-11-30' }) => app.inject({
    url: `${endpoint}/children/${childId}/homework?${new URLSearchParams(filters)}`,
    headers,
  });

  await context.test('le cahier suit l’enfant autorisé et sa classe, avec la même portée sur web et mobile', async () => {
    const [childA, childB, childC] = demo.students.map(({ id }) => id);
    const [classA, classB] = demo.classes.map(({ id }) => id);
    const entry = { date: '2026-11-25', title: 'Lire une histoire', domain: 'Français', description: 'Relire la fiche fictive.' };
    const id = await createEntry(pool, schoolCode, classA, entry);
    await createEntry(pool, schoolCode, classA, { ...entry, date: '2026-11-24', title: 'Comparer des nombres', domain: 'Mathématiques' });
    await createEntry(pool, schoolCode, classB, { ...entry, title: 'Travail de la classe B' });
    await pool.query(`INSERT INTO classes (school_id, id, name)
      SELECT id, $1, 'Classe fictive homonyme' FROM schools WHERE code = 'AUTRE-ECOLE'`, [classA]);
    await createEntry(pool, 'AUTRE-ECOLE', classA, { ...entry, title: 'Travail d’une autre école' });

    const credentials = await login(guardianA);
    const first = authorize(credentials.accessToken);
    const second = authorize((await login(guardianB)).accessToken);
    assert.equal((await homework({}, childA)).statusCode, 401);
    const result = await homework(first, childA);
    assert.equal(result.statusCode, 200);
    assert.equal(result.headers['cache-control'], 'no-store');
    assert.equal(result.json().child.classId, classA);
    assert.deepEqual(result.json().entries.map(({ title }) => title), ['Lire une histoire', 'Comparer des nombres']);
    assert.deepEqual(result.json().entries[0], { ...entry, id });
    assert.deepEqual((await homework(first, childB)).json().entries.map(({ title }) => title), ['Travail de la classe B']);
    const forbidden = await homework(second, childB);
    assert.equal(forbidden.statusCode, 404);
    assert.deepEqual(forbidden.json(), (await homework(second, randomUUID())).json());
    assert.equal((await homework(first, childC)).statusCode, 404);
    const otherSchool = authorize((await login(guardianA, 'AUTRE-ECOLE')).accessToken);
    assert.equal((await homework(otherSchool, childA)).statusCode, 404);

    const { code } = await store.invite(schoolCode, guardianB);
    const browser = await webPost('login', { origin: webOrigin, payload: { schoolCode, code } });
    assert.equal(browser.statusCode, 204);
    const browserHeaders = { cookie: browser.headers['set-cookie'].split(';')[0] };
    const filtered = await homework(browserHeaders, childC, { from: '2026-11-24', to: '2026-11-24', domain: 'MATH' });
    assert.equal(filtered.statusCode, 200);
    assert.deepEqual(filtered.json().entries.map(({ title }) => title), ['Comparer des nombres']);
    assert.equal((await homework(browserHeaders, childB)).statusCode, 404);

    const moved = { ...entry, title: 'Réviser la lecture' };
    assert.equal(await updateEntry(pool, 'AUTRE-ECOLE', classA, id, moved), false);
    assert.equal(await updateEntry(pool, schoolCode, classB, id, moved), false);
    assert.equal(await updateEntry(pool, schoolCode, classA, id, moved), true);
    assert.equal((await homework(first, childA)).json().entries[0].title, moved.title);
    assert.equal(await deleteEntry(pool, schoolCode, classB, id), false);
    assert.equal(await deleteEntry(pool, schoolCode, classA, id), true);
    assert.equal((await homework(first, childA)).json().entries.some((item) => item.id === id), false);

    await pool.query('UPDATE students SET class_id = $1 WHERE school_id = $2 AND id = $3', [classB, demo.school.id, childA]);
    const transferred = await homework(first, childA);
    await pool.query('UPDATE students SET class_id = $1 WHERE school_id = $2 AND id = $3', [classA, demo.school.id, childA]);
    assert.equal(transferred.json().child.classId, classB);
    assert.deepEqual(transferred.json().entries.map(({ title }) => title), ['Travail de la classe B']);

    assert.equal((await post('/auth/logout', { refreshToken: credentials.refreshToken })).statusCode, 204);
    assert.equal((await homework(first, childA)).statusCode, 401);
  });

  await context.test('le cahier valide les dates et pagine sans doublon les entrées du même jour', async () => {
    const childId = demo.students[0].id;
    const classId = demo.classes[0].id;
    const auth = authorize((await login(guardianA)).accessToken);
    const period = { from: '2026-11-26', to: '2026-11-26' };
    assert.equal((await homework(auth, childId, { from: '2026-11-31', to: '2026-11-31' })).statusCode, 400);
    assert.equal((await homework(auth, childId, { from: '2026-10-01', to: '2026-11-30' })).statusCode, 400);
    assert.equal((await homework(auth, childId, { ...period, cursor: `2026-11-25~${randomUUID()}` })).statusCode, 400);
    assert.equal(readEntry({ date: '2026-02-29', title: 'Exemple', domain: 'Test', description: 'Fictif' }), null);
    const empty = (await homework(auth, childId, period)).json();
    assert.deepEqual(empty.entries, []);
    assert.equal(empty.nextCursor, null);

    await pool.query(`INSERT INTO homework_entries (school_id, class_id, id, entry_date, title, domain, description)
      SELECT $1, $2, gen_random_uuid(), '2026-11-26', 'Fiche fictive ' || n, 'Domaine de test', 'Texte fictif'
      FROM generate_series(1, 32) n`, [demo.school.id, classId]);
    const firstPage = (await homework(auth, childId, period)).json();
    assert.equal(firstPage.entries.length, 30);
    assert.ok(firstPage.nextCursor);
    const nextPage = (await homework(auth, childId, { ...period, cursor: firstPage.nextCursor })).json();
    assert.equal(nextPage.entries.length, 2);
    assert.equal(nextPage.nextCursor, null);
    assert.equal(new Set([...firstPage.entries, ...nextPage.entries].map(({ id }) => id)).size, 32);
  });

  await context.test('le périmètre suit immédiatement les liens de tutelle', async () => {
    const { accessToken } = await login(guardianA);
    const studentId = demo.students[1].id;
    assert.equal((await homework(authorize(accessToken), studentId)).statusCode, 200);
    await pool.query('DELETE FROM guardian_students WHERE school_id = $1 AND guardian_id = $2 AND student_id = $3',
      [demo.school.id, guardianA, studentId]);
    const list = await children(accessToken);
    assert.deepEqual(list.json().children.map(({ id }) => id), [demo.students[0].id]);
    assert.equal((await homework(authorize(accessToken), studentId)).statusCode, 404);
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

  await context.test('le mobile se déconnecte avec le jeton de renouvellement sans devoir le faire tourner', async () => {
    const initial = await login(guardianA);
    const logout = { refreshToken: initial.refreshToken };
    assert.equal((await post('/auth/logout', logout)).statusCode, 204);
    assert.equal((await post('/auth/logout', logout)).statusCode, 204);
    assert.equal((await children(initial.accessToken)).statusCode, 401);
    assert.equal((await refresh(initial.refreshToken)).statusCode, 401);
  });

  await context.test('le navigateur exige une origine exacte et garde le secret de session dans un cookie protégé', async () => {
    const { code } = await store.invite(schoolCode, guardianB);
    const payload = { schoolCode, code };
    for (const origin of [undefined, 'null', 'https://autre.ecole.example']) {
      assert.equal((await webPost('login', { origin, payload })).statusCode, 403);
    }
    const result = await webPost('login', { origin: webOrigin, payload });
    assert.equal(result.statusCode, 204);
    assert.equal(result.body, '');
    assert.equal(result.headers['cache-control'], 'no-store');
    const setCookie = result.headers['set-cookie'];
    assert.match(setCookie, /^__Host-open-cartable=[A-Za-z0-9_-]{43};/);
    for (const attribute of ['Path=/', 'Max-Age=2592000', 'Secure', 'HttpOnly', 'SameSite=Strict']) {
      assert.ok(setCookie.split(/;\s*/).includes(attribute));
    }
    assert.doesNotMatch(setCookie, /;\s*Domain=/i);
    const cookie = setCookie.split(';')[0];
    const token = cookie.split('=')[1];
    const browserSession = await pool.query('SELECT digest FROM parent_browser_sessions WHERE digest = $1', [refreshDigest(token)]);
    assert.equal(browserSession.rowCount, 1);
    assert.equal((await refresh(token)).statusCode, 401);
    assert.equal((await redeem(code)).statusCode, 401);
    const browserChildren = () => app.inject({ url: endpoint + '/children', headers: { cookie } });
    const tabs = await Promise.all([browserChildren(), browserChildren()]);
    for (const tab of tabs) {
      assert.equal(tab.statusCode, 200);
      assert.equal(tab.headers['cache-control'], 'no-store');
      assert.deepEqual(tab.json().children.map(({ id }) => id), [demo.students[2].id]);
    }
    assert.equal((await webPost('logout', { origin: 'https://autre.ecole.example', cookie })).statusCode, 403);
    assert.equal((await browserChildren()).statusCode, 200);
    const logout = await webPost('logout', { origin: webOrigin, cookie });
    assert.equal(logout.statusCode, 204);
    assert.match(logout.headers['set-cookie'], /^__Host-open-cartable=;/);
    assert.equal((await browserChildren()).statusCode, 401);
  });

  await context.test('le remplacement et l’expiration invalident aussi les sessions navigateur', async () => {
    const openBrowserSession = async () => {
      const { code } = await store.invite(schoolCode, guardianB);
      const response = await webPost('login', { origin: webOrigin, payload: { schoolCode, code } });
      assert.equal(response.statusCode, 204);
      return response.headers['set-cookie'].split(';')[0];
    };
    const browserChildren = (cookie) => app.inject({ url: endpoint + '/children', headers: { cookie } });
    const expired = await openBrowserSession();
    await pool.query(`UPDATE parent_sessions SET expires_at = now()
      WHERE id = (SELECT session_id FROM parent_browser_sessions WHERE digest = $1)`, [refreshDigest(expired.split('=')[1])]);
    assert.equal((await browserChildren(expired)).statusCode, 401);
    const replaced = await openBrowserSession();
    await store.invite(schoolCode, guardianB, true);
    assert.equal((await browserChildren(replaced)).statusCode, 401);
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
