import { randomUUID } from 'node:crypto';
import { transaction } from '../db/database.js';
import { decryptImage, encryptImage, maxPhotos, prepareImage } from './images.js';

const schoolQuota = 5 * 1024 ** 3;
const order = 'position, id';
const scopeFilter = 'school_id = $1 AND article_id = $2';
const active = "expires_at > statement_timestamp()";
const metadata = 'id, description, reviewed';
const projection = "json_build_object('id', id, 'description', description, 'reviewed', reviewed)";

export function gallerySummary(publicFeed, limit = 2) {
  const matching = `p.school_id = a.school_id AND p.article_id = a.id AND ${active}${publicFeed ? ' AND reviewed' : ''}`;
  return `
    (SELECT count(*)::integer FROM class_blog_photos p WHERE ${matching}) AS "photoCount",
    COALESCE((SELECT json_agg(${projection} ORDER BY ${order}) FROM (
      SELECT ${metadata}, position FROM class_blog_photos p WHERE ${matching} ORDER BY ${order} LIMIT ${limit}
    ) previews), '[]'::json) AS photos
  `;
}

export function hasPublicPhoto(alias) {
  return `EXISTS (
    SELECT 1 FROM class_blog_photos p
    WHERE (p.school_id, p.article_id) = (${alias}.school_id, ${alias}.id) AND ${active} AND reviewed
  )`;
}

export async function listPhotos(db, [schoolId, , articleId]) {
  const { rows } = await db.query(`
    SELECT ${metadata} FROM class_blog_photos
    WHERE ${scopeFilter} AND ${active}
    ORDER BY ${order}
  `, [schoolId, articleId]);
  return rows;
}

export async function addPhoto(db, [schoolId, , articleId], input, key) {
  const { rows: [space] } = await db.query(`
    SELECT count(*)::integer AS count, COALESCE(max(position), 0) + 1 AS position
    FROM class_blog_photos WHERE ${scopeFilter}
  `, [schoolId, articleId]);
  if (space.count >= maxPhotos) throw Object.assign(new Error('Galerie complète.'), { statusCode: 422 });

  const { full, thumbnail } = await prepareImage(input);
  const id = randomUUID();
  const photoScope = [schoolId, articleId, id];
  const encryptedFull = encryptImage(full, key, photoScope, 'full');
  const encryptedThumbnail = encryptImage(thumbnail, key, photoScope, 'thumb');
  await db.query("SELECT pg_advisory_xact_lock(hashtext('class-blog-photos'), hashtext($1))", [schoolId]);
  const { rows: [{ used }] } = await db.query(`
    SELECT COALESCE(sum(octet_length(full_data) + octet_length(thumbnail_data)), 0) AS used
    FROM class_blog_photos WHERE school_id = $1
  `, [schoolId]);
  if (Number(used) + encryptedFull.length + encryptedThumbnail.length > schoolQuota) {
    throw Object.assign(new Error('Quota photo atteint.'), { statusCode: 413 });
  }
  await db.query(`
    INSERT INTO class_blog_photos (school_id, article_id, id, position, thumbnail_data, full_data)
    VALUES ($1, $2, $3, $4, $5, $6)
  `, [...photoScope, space.position, encryptedThumbnail, encryptedFull]);
  return true;
}

export async function reviewPhoto(db, [schoolId, , articleId], id, { description, reviewed }) {
  const result = await db.query(`
    UPDATE class_blog_photos SET description = $4, reviewed = $5
    WHERE ${scopeFilter} AND id = $3 AND ${active}
  `, [schoolId, articleId, id, description, reviewed]);
  return result.rowCount === 1;
}

export async function movePhotoToCover(db, [schoolId, , articleId], id) {
  const result = await db.query(`
    UPDATE class_blog_photos
    SET position = (SELECT min(position) - 1 FROM class_blog_photos WHERE ${scopeFilter})
    WHERE ${scopeFilter} AND id = $3 AND ${active}
  `, [schoolId, articleId, id]);
  return result.rowCount === 1;
}

export async function removePhoto(db, [schoolId, , articleId], id) {
  const result = await db.query(`DELETE FROM class_blog_photos WHERE ${scopeFilter} AND id = $3`, [schoolId, articleId, id]);
  return result.rowCount === 1;
}

export async function readPhoto(db, [schoolId, classId, articleId], id, size, key, publicFeed) {
  const column = size === 'thumb' ? 'thumbnail_data' : 'full_data';
  const { rows: [photo] } = await db.query(`
    SELECT p.${column} AS content FROM class_blog_photos p
    JOIN class_blog_articles a ON (a.school_id, a.id) = (p.school_id, p.article_id)
    WHERE (a.school_id, a.class_id, a.id, p.id) = ($1, $2, $3, $4)
      AND p.expires_at > statement_timestamp() ${publicFeed ? 'AND a.published_at IS NOT NULL AND p.reviewed' : ''}
  `, [schoolId, classId, articleId, id]);
  return photo ? decryptImage(photo.content, key, [schoolId, articleId, id], size) : null;
}

export async function startPublishedRetention(db, [schoolId, , articleId], at) {
  await db.query(`
    UPDATE class_blog_photos SET first_published_at = $3, expires_at = $3::timestamptz + interval '1 year'
    WHERE ${scopeFilter} AND ${active} AND first_published_at IS NULL
  `, [schoolId, articleId, at]);
}

export async function purgeExpiredBlogPhotos(pool) {
  return transaction(pool, async (db) => {
    // Prendre les verrous dans le même ordre que la modification d’un article.
    await db.query(`
      SELECT a.id FROM class_blog_articles a WHERE EXISTS (
        SELECT 1 FROM class_blog_photos p
        WHERE (p.school_id, p.article_id) = (a.school_id, a.id) AND p.expires_at <= transaction_timestamp()
      )
      ORDER BY a.school_id, a.id FOR UPDATE OF a
    `);
    await db.query(`
      WITH removed AS (
        DELETE FROM class_blog_photos WHERE expires_at <= transaction_timestamp() RETURNING school_id, article_id
      )
      UPDATE class_blog_articles a SET version = version + 1,
        published_at = CASE WHEN a.body = '' AND NOT ${hasPublicPhoto('a')} THEN NULL ELSE a.published_at END
      WHERE (a.school_id, a.id) IN (SELECT school_id, article_id FROM removed)
    `);
  });
}
