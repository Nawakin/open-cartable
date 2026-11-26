import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import pg from 'pg';
import sharp from 'sharp';
import { buildApp } from '../app.js';
import { createParentStore } from '../auth/parent-store.js';
import { hashPassword } from '../auth/password.js';
import { migrate, openDatabase, transaction } from '../db/database.js';
import { demo, seedDemo } from '../db/demo.js';
import { setDirectionPassword } from '../direction/store.js';
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
    const password = randomBytes(24).toString('base64url');
    const passwordHash = await hashPassword(password);
    await transaction(pool, (db) => setDirectionPassword(db, schoolId, passwordHash));
    await transaction(pool, (db) => setDirectionPassword(db, otherSchool, passwordHash));
    const loginDirection = async (code) => cookie(
      await call('POST', '/direction/auth/login', { origin }, { schoolCode: code, password }),
    );
    const direction = await loginDirection(schoolCode);
    const otherDirection = await loginDirection('ECOLE-VOISINE');
    const recordPath = '/direction/classes/' + classA.id + '/photo-authorizations';
    const teacherRegister = '/teacher/classes/' + classA.id + '/photo-authorizations';
    const familyRegister = '/parent/photo-authorizations';
    const setConsent = (status, revision, headers = direction) =>
      call('PUT', recordPath + '/' + childA.id, headers, { status, revision });
    assert.equal((await call('GET', recordPath, direction)).json().students.find(({ id }) => id === childA.id).status, 'unrecorded');
    assert.equal((await call('GET', teacherRegister, b.headers)).statusCode, 404);
    assert.equal((await setConsent('allowed', null, a.headers)).statusCode, 401);
    assert.equal((await setConsent('allowed', null, otherDirection)).statusCode, 404);
    assert.equal((await setConsent('allowed', null, { ...direction, origin: 'https://ailleurs.example' })).statusCode, 403);
    assert.deepEqual((await call('GET', familyRegister, second)).json().children.map(({ id }) => id), [childC.id]);

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
    const otherImage = await sharp({ create: { width: 800, height: 500, channels: 3, background: '#b26739' } }).jpeg().toBuffer();
    for (const bytes of [image, otherImage, otherImage]) {
      const uploaded = await upload(bytes);
      assert.equal(uploaded.statusCode, 201);
      article = uploaded.json();
    }
    assert.equal(article.photoCount, 3);
    const [firstPhoto, otherPhoto, cover] = article.photos;
    const photoURL = familyURL + '/photos/' + firstPhoto.id;
    const staffPhoto = photoCollection + '/' + firstPhoto.id;
    assert.equal((await call('GET', photoURL, family)).statusCode, 404);
    assert.equal((await call('GET', staffPhoto, foreign.headers)).statusCode, 404);
    assert.equal((await setPublished(true)).statusCode, 422);

    const moved = await call('PUT', photoCollection + '/' + cover.id + '/cover', a.headers, { version: article.version });
    assert.equal(moved.statusCode, 200);
    article = moved.json();
    assert.equal(article.photos[0].id, cover.id);
    const review = (id, studentIds) => call('PUT', photoCollection + '/' + id, a.headers, {
      version: article.version, reviewed: true, description: 'Matériel fictif', studentIds,
    });
    assert.equal((await review(firstPhoto.id, [childA.id])).statusCode, 422);
    assert.equal((await review(firstPhoto.id, [childB.id])).statusCode, 422);
    const allowance = await setConsent('allowed', null);
    assert.equal(allowance.statusCode, 200);
    const granted = allowance.json();
    assert.equal((await call('GET', teacherRegister, a.headers)).json().students.find(({ id }) => id === childA.id).status, 'allowed');
    assert.deepEqual((await call('GET', familyRegister, family)).json().children.find(({ id }) => id === childA.id), {
      id: childA.id, displayName: childA.name, status: 'allowed',
    });
    for (const photo of article.photos) {
      const checked = await review(photo.id, photo.id === firstPhoto.id ? [childA.id] : []);
      assert.equal(checked.statusCode, 200);
      article = checked.json();
    }
    const published = await setPublished(true);
    assert.equal(published.statusCode, 200);
    article = published.json();
    const entry = (await call('GET', familyPath, family)).json().articles[0];
    assert.equal(entry.photoCount, 3);
    assert.deepEqual(entry.photos.map(({ id }) => id), article.photos.slice(0, 2).map(({ id }) => id));
    const publishedPhotos = (await call('GET', familyURL, family)).json().photos;
    assert.equal(publishedPhotos.length, 3);
    assert.equal(publishedPhotos.some((photo) => Object.hasOwn(photo, 'studentIds') || Object.hasOwn(photo, 'reviewBasis')), false);
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

    const { rows: [{ year, month }] } = await pool.query(`
      SELECT date_part('year', local_date)::integer - (date_part('month', local_date) < 9)::integer AS year,
        to_char(local_date, 'YYYY-MM') AS month
      FROM (SELECT $1::timestamptz AT TIME ZONE 'Europe/Paris' AS local_date) stamp
    `, [article.publishedAt]);
    const exportPath = '/direction/classes/' + classA.id + '/blog-export';
    const previewPath = exportPath + '?year=' + year + '&month=' + month;
    const pdfPath = exportPath + '/pdf?year=' + year + '&month=' + month;
    assert.equal((await call('GET', previewPath, a.headers)).statusCode, 401);
    assert.equal((await call('GET', exportPath + '?year=' + year + '&month=' + (year + 1) + '-09', direction)).statusCode, 400);
    assert.equal((await call('POST', pdfPath, { ...direction, origin: 'https://ailleurs.example' })).statusCode, 403);
    assert.equal((await call('GET', previewPath, otherDirection)).json().articleCount, 0);
    assert.equal((await call('POST', pdfPath, otherDirection)).statusCode, 422);
    const draftExport = await call('POST', classPath, a.headers, { title: 'Brouillon exclu du PDF', body: 'Texte fictif.' });
    assert.equal(draftExport.statusCode, 201);
    const { rows: [boundary] } = await pool.query(`
      INSERT INTO class_blog_articles (school_id, id, class_id, title, body, updated_at, published_at)
      VALUES ($1, gen_random_uuid(), $2, 'Publication de la rentrée', 'Texte fictif.', now(),
        ($3::date::timestamp AT TIME ZONE 'Europe/Paris') - interval '1 minute') RETURNING id
    `, [schoolId, classA.id, year + '-09-01']);
    const annual = await call('GET', exportPath + '?year=' + year, direction);
    assert.equal(annual.statusCode, 200);
    assert.equal(annual.headers['cache-control'], 'no-store');
    assert.deepEqual(annual.json().articles.map(({ id }) => id), [article.id]);
    await pool.query(`
      UPDATE class_blog_articles SET published_at = $1::date::timestamp AT TIME ZONE 'Europe/Paris'
      WHERE id = $2
    `, [year + '-09-01', boundary.id]);
    const fromSeptember = await call('GET', exportPath + '?year=' + year, direction);
    assert.deepEqual(fromSeptember.json().articles.map(({ id }) => id), [boundary.id, article.id]);
    await pool.query('DELETE FROM class_blog_articles WHERE id = $1', [boundary.id]);
    await pool.query("UPDATE class_blog_photos SET review_basis = 'legacy' WHERE id = $1", [otherPhoto.id]);
    assert.equal((await call('GET', previewPath, direction)).json().photoCount, 2);
    await pool.query("UPDATE class_blog_photos SET review_basis = 'none' WHERE id = $1", [otherPhoto.id]);
    assert.equal((await call('GET', previewPath, direction)).json().photoCount, 3);

    assert.equal((await setConsent('refused', null)).statusCode, 409);
    const withdrawal = await setConsent('refused', granted.revision);
    assert.equal(withdrawal.statusCode, 200);
    assert.equal((await call('GET', photoURL, family)).statusCode, 404);
    assert.equal((await call('GET', photoURL + '?size=thumb', family)).statusCode, 404);
    const familyGallery = (await call('GET', familyURL, family)).json();
    assert.equal(familyGallery.photoCount, 2);
    assert.equal(familyGallery.photos.some(({ id }) => id === firstPhoto.id), false);
    const afterWithdrawal = await call('POST', pdfPath, direction);
    assert.equal(afterWithdrawal.statusCode, 200);
    assert.equal(afterWithdrawal.headers['content-type'], 'application/pdf');
    assert.equal(afterWithdrawal.headers['cache-control'], 'no-store');
    assert.equal(afterWithdrawal.headers['x-content-type-options'], 'nosniff');
    assert.equal(afterWithdrawal.headers['content-disposition'], `attachment; filename="blog-${month}.pdf"`);
    assert.ok(afterWithdrawal.rawPayload.subarray(0, 5).equals(Buffer.from('%PDF-')));
    assert.equal((afterWithdrawal.rawPayload.toString('latin1').match(/\/Subtype \/Image\b/g) ?? []).length, 2);
    assert.ok(!afterWithdrawal.rawPayload.includes(thumb.rawPayload));
    assert.equal((await setConsent('allowed', withdrawal.json().revision)).statusCode, 200);
    assert.equal((await call('GET', photoURL, family)).statusCode, 404);

    const withdrawn = await setPublished(false);
    article = withdrawn.json();
    assert.equal((await call('GET', photoURL, family)).statusCode, 404);
    assert.equal((await setPublished(true)).statusCode, 422);
    const reviewedAgain = await review(firstPhoto.id, [childA.id]);
    assert.equal(reviewedAgain.statusCode, 200);
    article = reviewedAgain.json();
    const republished = await setPublished(true);
    assert.equal(republished.statusCode, 200);
    assert.equal((await call('GET', photoURL, family)).statusCode, 200);
    const { rows: [{ expires_at: expiry }] } = await pool.query('SELECT expires_at FROM class_blog_photos WHERE id = $1', [firstPhoto.id]);
    assert.deepEqual(expiry, stored.expires_at);

    article = republished.json();
    const box = { left: 2250, top: 1750, right: 7750, bottom: 8250 };
    const mask = (masks, headers = a.headers) =>
      call('PUT', staffPhoto + '/masks', headers, { version: article.version, masks });
    assert.equal((await mask([box])).statusCode, 409);
    article = (await setPublished(false)).json();
    assert.equal((await mask([box], { origin })).statusCode, 401);
    assert.equal((await mask([box], b.headers)).statusCode, 404);
    assert.equal((await mask([box], foreign.headers)).statusCode, 404);
    assert.equal((await mask([box], { ...a.headers, origin: 'https://ailleurs.example' })).statusCode, 403);
    assert.equal((await mask([{ ...box, left: 10_001 }])).statusCode, 400);
    assert.equal((await mask([{ ...box, right: box.left }])).statusCode, 400);
    assert.equal((await mask(Array(21).fill(box))).statusCode, 400);
    const maskAttempts = await Promise.all([mask([box]), mask([box])]);
    assert.deepEqual(maskAttempts.map(({ statusCode }) => statusCode).sort(), [200, 409]);
    article = maskAttempts.find(({ statusCode }) => statusCode === 200).json();
    const edited = article.photos[1];
    assert.equal(article.photoCount, 3);
    assert.notEqual(edited.id, firstPhoto.id);
    assert.deepEqual(article.photos.map(({ id }) => id), [cover.id, edited.id, otherPhoto.id]);
    assert.equal(edited.description, 'Matériel fictif');
    assert.equal(edited.reviewed, false);
    assert.equal(edited.reviewBasis, null);
    assert.equal(edited.publishable, false);
    assert.deepEqual(edited.studentIds, []);
    assert.equal((await pool.query('SELECT 1 FROM class_blog_photos WHERE id = $1', [firstPhoto.id])).rowCount, 0);
    assert.equal((await pool.query('SELECT 1 FROM class_blog_photo_subjects WHERE photo_id = $1', [firstPhoto.id])).rowCount, 0);
    assert.deepEqual((await pool.query('SELECT expires_at FROM class_blog_photos WHERE id = $1', [edited.id])).rows[0].expires_at, expiry);
    assert.equal((await call('GET', staffPhoto, a.headers)).statusCode, 404);
    assert.equal((await call('GET', staffPhoto + '?size=thumb', a.headers)).statusCode, 404);
    assert.equal((await setPublished(true)).statusCode, 422);
    article = (await review(edited.id, [])).json();
    assert.equal((await setPublished(true)).statusCode, 200);
    const publicReplacement = familyURL + '/photos/' + edited.id;
    assert.equal((await call('GET', photoURL, family)).statusCode, 404);
    const maskedExport = await call('POST', pdfPath, direction);
    assert.equal(maskedExport.statusCode, 200);
    assert.equal((maskedExport.rawPayload.toString('latin1').match(/\/Subtype \/Image\b/g) ?? []).length, 3);
    assert.ok(!maskedExport.rawPayload.includes(thumb.rawPayload));
    for (const [size, expectedHeight] of [['full', 800], ['thumb', 560]]) {
      const masked = await call('GET', publicReplacement + '?size=' + size, family);
      assert.equal(masked.statusCode, 200);
      assert.equal((await sharp(masked.rawPayload).metadata()).exif, undefined);
      const { data, info: { width, height, channels } } = await sharp(masked.rawPayload).raw().toBuffer({ resolveWithObject: true });
      assert.equal(height, expectedHeight);
      const pixel = (x, y) => {
        const offset = (Math.floor(height * y) * width + Math.floor(width * x)) * channels;
        return [...data.subarray(offset, offset + channels)];
      };
      assert.deepEqual(pixel(0.5, 0.5), [0, 0, 0]);
      assert.deepEqual(pixel(0.23, 0.18), [0, 0, 0]);
      assert.ok(pixel(0.1, 0.1)[1] > 65);
      if (size === 'thumb') assert.ok(maskedExport.rawPayload.includes(masked.rawPayload));
    }
    await pool.query("UPDATE class_blog_photos SET expires_at = statement_timestamp() - interval '1 minute' WHERE article_id = $1", [article.id]);
    assert.equal((await call('GET', publicReplacement, family)).statusCode, 404);
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
