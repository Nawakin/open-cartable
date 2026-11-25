import { randomUUID } from 'node:crypto';
import { pageByTimestamp } from '../db/keyset.js';
import { maxPhotos } from './images.js';
import { gallerySummary, hasPublicPhoto, listPhotos, startPublishedRetention } from './photos.js';

const pageSize = 20;
const now = "date_trunc('milliseconds', statement_timestamp())";
const articleFields = 'id, title, body, version, updated_at AS "updatedAt", published_at AS "publishedAt"';
const excerpt = "CASE WHEN char_length(body) > 240 THEN left(body, 240) || '…' ELSE body END AS excerpt";

export async function listArticles(db, schoolId, classId, { beforeAt, beforeId }, status, publicFeed = false) {
  // Le filtre est construit à partir d’un ensemble fermé. Le flux parent appelle toujours 'published'.
  const audience = { published: 'published_at IS NOT NULL', draft: 'published_at IS NULL', all: 'true' }[status];
  const date = status === 'published' ? 'published_at' : 'updated_at';
  const field = status === 'published' ? 'publishedAt' : 'updatedAt';
  const dates = status === 'published'
    ? 'published_at AS "publishedAt"'
    : 'updated_at AS "updatedAt", published_at AS "publishedAt"';
  const { rows } = await db.query(`
    SELECT id, title, ${excerpt}, ${dates}, ${gallerySummary(publicFeed)}
    FROM class_blog_articles a
    WHERE school_id = $1 AND class_id = $2 AND ${audience}
      ${publicFeed ? `AND (a.body <> '' OR ${hasPublicPhoto('a')})` : ''}
      AND ($3::timestamptz IS NULL OR (${date}, id) < ($3, $4::uuid))
    ORDER BY ${date} DESC, id DESC LIMIT $5
  `, [schoolId, classId, beforeAt, beforeId, pageSize + 1]);
  const { items, nextCursor } = pageByTimestamp(rows, pageSize, field);
  return { articles: items, nextCursor };
}

async function withPhotos(db, scope, article) {
  const photos = await listPhotos(db, scope);
  return { ...article, photos, photoCount: photos.length };
}

export async function readPublishedArticle(db, schoolId, classId, id) {
  const { rows: [article] } = await db.query(`
    SELECT id, title, body, published_at AS "publishedAt", ${gallerySummary(true, maxPhotos)}
    FROM class_blog_articles a
    WHERE (school_id, class_id, id) = ($1, $2, $3) AND published_at IS NOT NULL
      AND (a.body <> '' OR ${hasPublicPhoto('a')})
  `, [schoolId, classId, id]);
  return article ?? null;
}

export async function readStaffArticle(db, schoolId, classId, id) {
  const { rows: [article] } = await db.query(`
    SELECT ${articleFields}, ${gallerySummary(false, maxPhotos)} FROM class_blog_articles a
    WHERE (school_id, class_id, id) = ($1, $2, $3)
  `, [schoolId, classId, id]);
  return article ?? null;
}

export async function createDraft(db, schoolId, classId, { title, body }) {
  const { rows: [article] } = await db.query(`
    INSERT INTO class_blog_articles (school_id, class_id, id, title, body, updated_at)
    VALUES ($1, $2, $3, $4, $5, ${now}) RETURNING ${articleFields}
  `, [schoolId, classId, randomUUID(), title, body]);
  return { ...article, photos: [], photoCount: 0 };
}

function conflict() {
  throw Object.assign(new Error('L’article a changé.'), { statusCode: 409 });
}

async function lockArticle(db, scope, version) {
  const { rows: [article] } = await db.query(`
    SELECT ${articleFields} FROM class_blog_articles WHERE (school_id, class_id, id) = ($1, $2, $3) FOR UPDATE
  `, scope);
  if (article && article.version !== version) conflict();
  return article;
}

export async function updateDraft(db, scope, version, { title, body }) {
  const article = await lockArticle(db, scope, version);
  if (!article) return null;
  if (article.publishedAt) conflict();
  if (article.title === title && article.body === body) return withPhotos(db, scope, article);
  const { rows: [updated] } = await db.query(`
    UPDATE class_blog_articles SET title = $4, body = $5, updated_at = ${now}, version = version + 1
    WHERE (school_id, class_id, id) = ($1, $2, $3) RETURNING ${articleFields}
  `, [...scope, title, body]);
  return withPhotos(db, scope, updated);
}

export async function setPublication(db, scope, version, published) {
  const article = await lockArticle(db, scope, version);
  if (!article) return null;
  if (Boolean(article.publishedAt) === published) return withPhotos(db, scope, article);
  if (published) {
    const photos = await listPhotos(db, scope);
    if ((!article.body && !photos.length) || photos.some((photo) => !photo.publishable)) {
      throw Object.assign(new Error('Il manque le contenu ou la vérification des photos.'), { statusCode: 422 });
    }
  }
  const { rows: [updated] } = await db.query(`
    UPDATE class_blog_articles
    SET published_at = CASE WHEN $4::boolean THEN ${now} ELSE NULL END, updated_at = ${now}, version = version + 1
    WHERE (school_id, class_id, id) = ($1, $2, $3) RETURNING ${articleFields}
  `, [...scope, published]);
  if (published) await startPublishedRetention(db, scope, updated.publishedAt);
  return withPhotos(db, scope, updated);
}

export async function changeDraftPhotos(db, scope, version, change) {
  const article = await lockArticle(db, scope, version);
  if (!article) return null;
  if (article.publishedAt) conflict();
  if (!await change()) return null;
  const { rows: [updated] } = await db.query(`
    UPDATE class_blog_articles SET updated_at = ${now}, version = version + 1
    WHERE (school_id, class_id, id) = ($1, $2, $3) RETURNING ${articleFields}
  `, scope);
  return withPhotos(db, scope, updated);
}

export async function deleteDraft(db, scope, version) {
  const article = await lockArticle(db, scope, version);
  if (!article) return null;
  if (article.publishedAt) conflict();
  await db.query('DELETE FROM class_blog_articles WHERE (school_id, class_id, id) = ($1, $2, $3)', scope);
  return undefined;
}
