import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createECDH, randomBytes, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { PDFDocument } from 'pdf-lib';
import pg from 'pg';
import { buildApp } from '../app.js';
import { createParentStore } from '../auth/parent-store.js';
import { hashPassword } from '../auth/password.js';
import { migrate, openDatabase, transaction } from '../db/database.js';
import { demo, seedDemo } from '../db/demo.js';
import { setDirectionPassword } from '../direction/store.js';
import { dispatchParentPush, webPushSettings } from '../notifications/web-push.js';
import { activateTeacher, createTeacher } from '../teacher/store.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const origin = 'https://ent.ecole.example';

test('l’annuaire, les livrets, les pièces jointes et les médias respectent leurs destinataires', { skip: !databaseUrl }, async (context) => {
  const schema = 'material_test_' + randomUUID().replaceAll('-', '');
  const admin = openDatabase(databaseUrl);
  const pool = new pg.Pool({ connectionString: databaseUrl, options: '-c search_path=' + schema });
  const invitationKey = randomBytes(32);
  const store = createParentStore(pool, invitationKey);
  const webPush = webPushSettings(randomBytes(32).toString('hex'), origin);
  const app = buildApp({
    parentAuth: { store, signingKey: randomBytes(32), webOrigin: origin },
    direction: { pool, webOrigin: origin, invitationKey }, blogMediaKey: randomBytes(32), webPush,
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

  const school = demo.school;
  const [classA] = demo.classes;
  const [childA, childB] = demo.students;
  const call = (method, path, headers = {}, payload) => app.inject({ method, url: '/api/v1' + path, headers, payload });
  const credentials = (response) => {
    assert.equal(response.statusCode, 204, 'La session doit être ouverte');
    return { origin, cookie: response.headers['set-cookie'].split(';')[0] };
  };
  const login = async (role, auth) => credentials(await call('POST', '/' + role + '/auth/login', { origin },
    { schoolCode: school.code, ...auth }));
  const password = randomBytes(24).toString('base64url');
  const hash = await hashPassword(password);
  await transaction(pool, (db) => setDirectionPassword(db, school.id, hash));
  const direction = await login('direction', { password });
  const teacherLogin = 'teacher-demo';
  const account = await transaction(pool, (db) => createTeacher(db, school.id, teacherLogin, [classA.id]));
  await activateTeacher(pool, { schoolCode: school.code, login: teacherLogin, code: account.code, password });
  const teacher = await login('teacher', { login: teacherLogin, password });
  const issued = await call('POST', '/direction/directory/invitations', direction,
    { guardianIds: demo.guardians, replaceSessions: false });
  assert.equal(issued.statusCode, 201);
  const parents = await Promise.all(issued.json().invitations.map(({ code }) => login('parent/web', { code })));
  const [parent, otherParent] = parents;
  assert.equal((await call('GET', '/direction/directory', parent)).statusCode, 401);
  assert.equal((await call('GET', '/direction/directory', direction)).json().students.length, 3);

  const parentA = '/parent/children/' + childA.id;
  const parentB = '/parent/children/' + childB.id;
  const staff = '/teacher/classes/' + classA.id;
  const report = staff + '/reports/' + childA.id + '?term=1';
  const draft = { revision: null, published: false, appreciation: 'Poursuivre les lectures.',
    assessments: [{ subject: 'french', mark: 'AC', note: 'Lecture à voix haute.' }] };
  const saved = await call('PUT', report, teacher, draft);
  assert.equal(saved.statusCode, 200);
  assert.equal((await call('GET', parentA + '/reports', parent)).json().reports.length, 0);
  const { id: reportId, revision } = saved.json().report;
  assert.equal((await call('PUT', report, teacher, { ...draft, revision, published: true })).statusCode, 200);
  assert.equal((await call('GET', parentA + '/reports/' + reportId + '/pdf', otherParent)).statusCode, 404);
  assert.equal((await call('GET', parentB + '/reports/' + reportId + '/pdf', parent)).statusCode, 404);
  const livret = await call('GET', parentA + '/reports/' + reportId + '/pdf', parent);
  assert.equal(livret.statusCode, 200);
  assert.ok(livret.rawPayload.subarray(0, 5).equals(Buffer.from('%PDF-')));

  const notifications = '/parent/web/notifications';
  const browserKey = createECDH('prime256v1');
  const subscription = { endpoint: 'https://fcm.googleapis.com/fcm/send/fiction-demonstration',
    p256dh: browserKey.generateKeys().toString('base64url'), auth: randomBytes(16).toString('base64url') };
  assert.equal((await call('PUT', notifications, parent, { ...subscription, endpoint: 'https://example.net/push/test' })).statusCode, 400);
  assert.equal((await call('PUT', notifications, parent, subscription)).statusCode, 204);
  assert.equal((await call('GET', notifications, parent)).json().enabled, true);

  const pdf = await PDFDocument.create();
  pdf.addPage().drawText('Ressource fictive');
  const content = Buffer.from(await pdf.save()).toString('base64');
  const homework = await call('POST', staff + '/homework', teacher,
    { date: '2026-11-27', title: 'Les mots', domain: 'Français', description: 'Lire le texte.' });
  assert.equal(homework.statusCode, 201);
  const entry = homework.json().id;
  assert.equal((await call('PUT', staff + '/homework/' + entry + '/document', teacher, { content })).statusCode, 204);
  assert.equal((await call('GET', parentB + '/homework/' + entry + '/document', parent)).statusCode, 404);
  assert.equal((await call('GET', parentA + '/homework/' + entry + '/document', parent)).headers['content-type'], 'application/pdf');
  const deliveries = [];
  const delivery = async (recipient, payload) => deliveries.push([recipient.endpoint, payload]);
  await dispatchParentPush(pool, webPush, delivery);
  await dispatchParentPush(pool, webPush, delivery);
  assert.deepEqual(deliveries, [[subscription.endpoint, 'nouveaute']]);
  assert.equal((await call('DELETE', notifications, parent)).statusCode, 204);

  const resource = await call('POST', staff + '/library', teacher, { content, permitted: true, kind: 'pdf', title: 'Texte de lecture', folder: 'Français' });
  assert.equal(resource.statusCode, 201);
  const media = resource.json().id;
  assert.equal((await call('GET', parentB + '/library/' + media, parent)).statusCode, 404);
  const library = await call('GET', parentA + '/library?search=lecture', parent);
  assert.equal(library.json().items[0].id, media);
  assert.deepEqual(library.json().folders, ['Français']);
  assert.equal((await call('GET', parentA + '/library/' + media + '?preview=1', parent)).headers['content-disposition'], 'inline');

  await context.test('une vidéo reste privée jusqu’à la publication et le lecteur reçoit des plages d’octets', (subtest) => {
    if (process.platform === 'win32') { subtest.skip('Le serveur de test doit disposer de FFmpeg.'); return; }
    return (async () => {
      const video = execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=green:s=64x64:d=0.2',
        '-c:v', 'libx264', '-threads', '1', '-movflags', '+frag_keyframe+empty_moov', '-f', 'mp4', 'pipe:1']).toString('base64');
      const article = (await call('POST', staff + '/blog', teacher, { title: 'Vidéo de classe', body: '' })).json();
      const created = await call('POST', staff + '/library', teacher, { articleId: article.id, version: article.version,
        title: 'Démonstration', folder: '', kind: 'video', permitted: true, content: video });
      assert.equal(created.statusCode, 201);
      const { id, version } = created.json();
      assert.equal((await call('GET', parentA + '/library/' + id, parent)).statusCode, 404);
      assert.equal((await call('PUT', staff + '/blog/' + article.id + '/publication', teacher, { version, published: true })).statusCode, 200);
      const range = await call('GET', parentA + '/library/' + id, { ...parent, range: 'bytes=0-11' });
      assert.equal(range.statusCode, 206);
      assert.match(range.headers['content-range'], /^bytes 0-11\/\d+$/);
      assert.equal(range.rawPayload.subarray(4, 8).toString(), 'ftyp');
    })();
  });
});
