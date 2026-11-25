import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import pg from 'pg';
import sharp from 'sharp';
import { buildApp } from '../app.js';
import { createParentStore } from '../auth/parent-store.js';
import { migrate, openDatabase, transaction } from '../db/database.js';
import { demo, seedDemo } from '../db/demo.js';
import { activateTeacher, createTeacher } from '../teacher/store.js';
import { purgeExpiredBlogPhotos } from './photos.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const origin = 'https://ent.ecole.example';

test('le blog protège les brouillons et contrôle les transitions concurrentes et la portée de la classe', { skip: !databaseUrl }, async (context) => {
  const schema = 'blog_test_' + randomUUID().replaceAll('-', '');
  const admin = openDatabase(databaseUrl);
  const pool = new pg.Pool({ connectionString: databaseUrl, options: '-c search_path=' + schema });
  const store = createParentStore(pool, randomBytes(32));
  const app = buildApp({ parentAuth: { store, signingKey: randomBytes(32), webOrigin: origin }, direction: { pool, webOrigin: origin },
    blogMediaKey: randomBytes(32) });
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
  const [childA, childB, childC] = demo.students;
  const otherSchool = randomUUID();
  await pool.query("INSERT INTO schools (id, code) VALUES ($1, 'ECOLE-VOISINE')", [otherSchool]);
  await pool.query("INSERT INTO classes (school_id, id, name) VALUES ($1, $2, 'Classe fictive')", [otherSchool, classA.id]);
  const call = (method, path, headers, payload) => app.inject({ method, url: '/api/v1' + path, headers, payload });
  const cookie = (response) => {
    assert.equal(response.statusCode, 204);
    return { origin, cookie: response.headers['set-cookie'].split(';')[0] };
  };

  async function teacher(school, code, login, classId) {
    const password = randomBytes(24).toString('base64url');
    const created = await transaction(pool, (db) => createTeacher(db, school, login, [classId]));
    assert.ok(await activateTeacher(pool, { schoolCode: code, login, code: created.code, password }));
    return {
      id: created.id,
      headers: cookie(await call('POST', '/teacher/auth/login', { origin }, { schoolCode: code, login, password })),
    };
  }

  const a = await teacher(schoolId, schoolCode, 'classe-a', classA.id);
  const b = await teacher(schoolId, schoolCode, 'classe-b', classB.id);
  const foreign = await teacher(otherSchool, 'ECOLE-VOISINE', 'classe-a', classA.id);
  const firstInvite = await store.invite(schoolCode, demo.guardians[0]);
  const family = cookie(await call('POST', '/parent/web/auth/login', { origin }, { schoolCode, code: firstInvite.code }));
  const secondInvite = await store.invite(schoolCode, demo.guardians[1]);
  const secondLogin = await call('POST', '/parent/auth/invitations/redeem', {}, { schoolCode, code: secondInvite.code });
  assert.equal(secondLogin.statusCode, 200);
  const second = { authorization: 'Bearer ' + secondLogin.json().accessToken };

  const classPath = '/teacher/classes/' + classA.id + '/blog';
  const blogFor = (id) => '/parent/children/' + id + '/blog';
  const familyPath = blogFor(childA.id);
  const title = 'Atelier fictif';
  const draftBody = 'Texte <b>fictif</b>.';
  assert.equal((await call('GET', familyPath, {})).statusCode, 401);
  assert.equal((await call('POST', classPath, b.headers, { title, body: draftBody })).statusCode, 404);
  assert.equal((await call('POST', classPath, { ...a.headers, origin: 'https://ailleurs.example' }, { title, body: draftBody })).statusCode, 403);
  assert.equal((await call('POST', classPath, a.headers, { title: 'Titre\nsur deux lignes', body: draftBody })).statusCode, 400);
  assert.equal((await call('POST', classPath, a.headers, { title, body: '\0' })).statusCode, 400);
  assert.equal((await call('POST', classPath, a.headers, { title, body: 'x'.repeat(8001) })).statusCode, 400);

  const created = await call('POST', classPath, a.headers, { title, body: draftBody });
  assert.equal(created.statusCode, 201);
  const first = created.json();
  assert.equal(first.publishedAt, null);
  assert.equal(first.version, 1);
  const staffArticle = classPath + '/' + first.id;
  const parentArticle = familyPath + '/' + first.id;
  assert.equal((await call('GET', staffArticle, b.headers)).statusCode, 404);
  assert.equal((await call('GET', staffArticle, foreign.headers)).statusCode, 404);
  assert.equal((await call('GET', staffArticle, family)).statusCode, 401);
  assert.equal((await call('GET', parentArticle, family)).statusCode, 404);
  assert.deepEqual((await call('GET', familyPath, family)).json().articles, []);
  assert.equal((await call('GET', familyPath + '?status=draft', family)).statusCode, 400);
  assert.deepEqual((await call('GET', classPath + '?status=published', a.headers)).json().articles, []);
  assert.deepEqual((await call('GET', classPath + '?status=draft', a.headers)).json().articles.map(({ id }) => id), [first.id]);

  const body = draftBody + '\n' + 'É'.repeat(250);
  const updated = await call('PUT', staffArticle, a.headers, { title, body, version: first.version });
  assert.equal(updated.statusCode, 200);
  const publish = (published, version) => call('PUT', staffArticle + '/publication', a.headers, { published, version });
  assert.equal((await publish(true, first.version)).statusCode, 409);
  assert.equal((await call('GET', parentArticle, family)).statusCode, 404);
  const attempts = await Promise.all([0, 1].map(() => publish(true, updated.json().version)));
  assert.deepEqual(attempts.map(({ statusCode }) => statusCode).sort(), [200, 409]);
  const publication = attempts.find(({ statusCode }) => statusCode === 200);
  const live = publication.json();
  const familyArticle = await call('GET', parentArticle, family);
  assert.equal(familyArticle.headers['cache-control'], 'no-store');
  assert.deepEqual(familyArticle.json(), { id: first.id, title, body, publishedAt: live.publishedAt, photos: [], photoCount: 0 });
  assert.equal((await call('GET', blogFor(childB.id) + '/' + first.id, family)).statusCode, 404);
  assert.equal((await call('GET', blogFor(childC.id) + '/' + first.id, family)).statusCode, 404);
  assert.equal((await call('GET', blogFor(childC.id) + '/' + first.id, second)).statusCode, 200);
  const previewRow = (await call('GET', familyPath, family)).json().articles[0];
  assert.deepEqual(previewRow, { id: first.id, title, excerpt: body.slice(0, 240) + '…', publishedAt: live.publishedAt, photos: [], photoCount: 0 });
  assert.equal((await call('PUT', staffArticle, a.headers, { title, body: 'Modification directe', version: live.version })).statusCode, 409);
  assert.equal((await call('DELETE', staffArticle, a.headers, { version: live.version })).statusCode, 409);

  await pool.query('UPDATE students SET class_id = $1 WHERE school_id = $2 AND id = $3', [classB.id, schoolId, childA.id]);
  assert.equal((await call('GET', parentArticle, family)).statusCode, 404);
  await pool.query('UPDATE students SET class_id = $1 WHERE school_id = $2 AND id = $3', [classA.id, schoolId, childA.id]);
  const withdrawn = await publish(false, live.version);
  assert.equal(withdrawn.statusCode, 200);
  assert.equal(withdrawn.json().publishedAt, null);
  assert.equal((await call('GET', parentArticle, family)).statusCode, 404);
  assert.equal((await call('DELETE', staffArticle, a.headers, { version: live.version })).statusCode, 409);
  assert.equal((await call('DELETE', staffArticle, a.headers, { version: withdrawn.json().version })).statusCode, 204);
  assert.equal((await call('GET', staffArticle, a.headers)).statusCode, 404);

  await context.test('les galeries photo vérifiées restent privées et expirent', async () => {
    const image = await sharp({ create: { width: 800, height: 500, channels: 3, background: '#315545' } })
      .jpeg().withMetadata({ orientation: 6 }).toBuffer();
    assert.ok((await sharp(image).metadata()).exif);
    const draft = await call('POST', classPath, a.headers, { title: 'Galerie fictive', body: '' });
    assert.equal(draft.statusCode, 201);
    let article = draft.json();
    const articleURL = classPath + '/' + article.id;
    const photoCollection = articleURL + '/photos';
    const familyURL = familyPath + '/' + article.id;
    const upload = (bytes, headers = a.headers) => call('POST', photoCollection + '?version=' + article.version,
      { ...headers, 'content-type': 'application/octet-stream' }, bytes);
    const setPublished = (published) => call('PUT', articleURL + '/publication', a.headers, { published, version: article.version });
    assert.equal((await setPublished(true)).statusCode, 422);
    assert.equal((await upload(image, { origin })).statusCode, 401);
    assert.equal((await upload(image, b.headers)).statusCode, 404);
    assert.equal((await upload(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).statusCode, 415);
    for (let index = 0; index < 3; index += 1) {
      const uploaded = await upload(image);
      assert.equal(uploaded.statusCode, 201);
      article = uploaded.json();
    }
    assert.equal(article.photoCount, 3);
    const [firstPhoto, , cover] = article.photos;
    const photoURL = familyURL + '/photos/' + firstPhoto.id;
    const staffPhoto = photoCollection + '/' + firstPhoto.id;
    assert.equal((await call('GET', photoURL, family)).statusCode, 404);
    assert.equal((await call('GET', staffPhoto, foreign.headers)).statusCode, 404);
    assert.equal((await setPublished(true)).statusCode, 422);

    const moved = await call('PUT', photoCollection + '/' + cover.id + '/cover', a.headers, { version: article.version });
    assert.equal(moved.statusCode, 200);
    article = moved.json();
    assert.equal(article.photos[0].id, cover.id);
    for (const photo of article.photos) {
      const review = await call('PUT', photoCollection + '/' + photo.id, a.headers,
        { version: article.version, reviewed: true, description: 'Matériel fictif' });
      assert.equal(review.statusCode, 200);
      article = review.json();
    }
    const published = await setPublished(true);
    assert.equal(published.statusCode, 200);
    article = published.json();
    const entry = (await call('GET', familyPath, family)).json().articles[0];
    assert.equal(entry.photoCount, 3);
    assert.deepEqual(entry.photos.map(({ id }) => id), article.photos.slice(0, 2).map(({ id }) => id));
    assert.equal((await call('GET', familyURL, family)).json().photos.length, 3);
    assert.equal((await call('GET', photoURL, {})).statusCode, 401);
    assert.equal((await call('GET', photoURL.replace(childA.id, childB.id), family)).statusCode, 404);
    const file = await call('GET', photoURL, family);
    assert.equal(file.statusCode, 200);
    assert.equal(file.headers['content-type'], 'image/jpeg');
    assert.equal(file.headers['cache-control'], 'no-store');
    assert.equal(file.headers['x-content-type-options'], 'nosniff');
    const output = await sharp(file.rawPayload).metadata();
    assert.equal(output.exif, undefined);
    assert.equal(output.width, 500);
    assert.equal(output.height, 800);
    const thumb = await call('GET', photoURL + '?size=thumb', family);
    assert.equal((await sharp(thumb.rawPayload).metadata()).height, 560);
    const stored = (await pool.query('SELECT full_data, expires_at FROM class_blog_photos WHERE id = $1', [firstPhoto.id])).rows[0];
    assert.equal(stored.full_data.length, file.rawPayload.length + 28);
    assert.ok(!stored.full_data.subarray(28).equals(file.rawPayload));

    const withdrawn = await setPublished(false);
    article = withdrawn.json();
    assert.equal((await call('GET', photoURL, family)).statusCode, 404);
    const republished = await setPublished(true);
    assert.equal(republished.statusCode, 200);
    const { rows: [{ expires_at: expiry }] } = await pool.query('SELECT expires_at FROM class_blog_photos WHERE id = $1', [firstPhoto.id]);
    assert.deepEqual(expiry, stored.expires_at);
    await pool.query("UPDATE class_blog_photos SET expires_at = statement_timestamp() - interval '1 minute' WHERE article_id = $1", [article.id]);
    assert.equal((await call('GET', photoURL, family)).statusCode, 404);
    assert.equal((await call('GET', familyURL, family)).statusCode, 404);
    await purgeExpiredBlogPhotos(pool);
    const after = (await call('GET', articleURL, a.headers)).json();
    assert.equal(after.publishedAt, null);
    assert.deepEqual(after.photos, []);
  });

  await pool.query(`
    INSERT INTO class_blog_articles (school_id, id, class_id, title, body, updated_at, published_at)
    SELECT $1, gen_random_uuid(), $2, 'Article fictif ' || n, 'Texte de test',
      date_trunc('milliseconds', statement_timestamp()), date_trunc('milliseconds', statement_timestamp())
    FROM generate_series(1, 23) n
  `, [schoolId, classA.id]);
  const firstPage = (await call('GET', familyPath, family)).json();
  assert.equal(firstPage.articles.length, 20);
  const secondPage = (await call('GET', familyPath + '?cursor=' + encodeURIComponent(firstPage.nextCursor), family)).json();
  assert.equal(secondPage.nextCursor, null);
  assert.equal(new Set([...firstPage.articles, ...secondPage.articles].map(({ id }) => id)).size, 23);
  await pool.query('DELETE FROM teacher_classes WHERE school_id = $1 AND teacher_id = $2', [schoolId, a.id]);
  assert.equal((await call('GET', classPath, a.headers)).statusCode, 404);
});
