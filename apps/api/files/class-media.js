import { randomUUID } from 'node:crypto';
import { linkedChildClass, lockActiveClass, forTeacherClass } from '../auth/class-access.js';
import { uuidPattern } from '../auth/credentials.js';
import { uuidParams } from '../auth/staff-web.js';
import { requireTimestampCursor, timestampCursor, pageByTimestamp } from '../db/keyset.js';
import { openPrivateFile, preparePrivateFile, privateFileHeaders, sealPrivateFile } from './private-files.js';
import { mediaEncoded, normalizeAV } from './normalize-av.js';

const uuid = { type: 'string', pattern: uuidPattern.source };
const fields = (properties, required = Object.keys(properties)) => ({ type: 'object', additionalProperties: false, required, properties });
const active = '(m.expires_at IS NULL OR m.expires_at > statement_timestamp())';
const blobLimit = mediaEncoded.maxLength + 4096;

export function hasPublicVideo(alias) {
  return `EXISTS (
    SELECT 1 FROM class_media m WHERE (m.school_id,m.article_id) = (${alias}.school_id,${alias}.id) AND ${active}
  )`;
}

export function videoCount(alias) {
  return `(SELECT count(*)::integer FROM class_media m
    WHERE (m.school_id,m.article_id) = (${alias}.school_id,${alias}.id) AND ${active}) AS "videoCount"`;
}

function fail(code) {
  throw Object.assign(new Error('Média indisponible.'), { statusCode: code });
}

async function list(db, schoolId, classId, { articleId = null, cursor, search = '', folder = '' }, shared) {
  const { beforeAt, beforeId } = requireTimestampCursor(cursor);
  const { rows } = await db.query(`
    SELECT m.id, m.title, m.folder, m.kind, m.created_at AS "createdAt"
    FROM class_media m LEFT JOIN class_blog_articles a ON (a.school_id,a.id) = (m.school_id,m.article_id)
    WHERE (m.school_id,m.class_id) = ($1,$2) AND m.article_id IS NOT DISTINCT FROM $3::uuid AND ${active}
      AND (NOT $4::boolean OR m.article_id IS NULL OR a.published_at IS NOT NULL)
      AND ($5::timestamptz IS NULL OR (m.created_at,m.id) < ($5,$6::uuid))
      AND strpos(lower(m.title), lower($7)) > 0 AND ($8 = '' OR m.folder = $8)
    ORDER BY m.created_at DESC,m.id DESC LIMIT 26
  `, [schoolId, classId, articleId, shared, beforeAt, beforeId, search.trim(), folder]);
  const { items, nextCursor } = pageByTimestamp(rows, 25, 'createdAt');
  if (articleId) return { items, nextCursor };
  const folders = await db.query(`
    SELECT DISTINCT m.folder FROM class_media m
    WHERE (m.school_id,m.class_id) = ($1,$2) AND m.article_id IS NULL AND m.folder <> '' AND ${active}
    ORDER BY m.folder
  `, [schoolId, classId]);
  return { items, nextCursor, folders: folders.rows.map(({ folder }) => folder) };
}

function mediaRange(bytes, range, reply) {
  reply.header('Accept-Ranges', 'bytes');
  if (!range) return bytes;
  const match = /^bytes=(\d{0,12})-(\d{0,12})$/.exec(range);
  const last = bytes.length - 1;
  const start = match?.[1] ? Number(match[1]) : Math.max(0, bytes.length - Number(match?.[2]));
  const end = match?.[1] && match[2] ? Math.min(last, Number(match[2])) : last;
  if (!match || (!match[1] && !match[2]) || start > end || start > last) {
    reply.code(416).header('Content-Range', 'bytes */' + bytes.length);
    return Buffer.alloc(0);
  }
  reply.code(206).header('Content-Range', `bytes ${start}-${end}/${bytes.length}`);
  return bytes.subarray(start, end + 1);
}

async function read(db, [schoolId, classId, id], shared, key, reply, { headers, query }) {
  const { rows: [entry] } = await db.query(`
    SELECT m.kind,m.content FROM class_media m
    LEFT JOIN class_blog_articles a ON (a.school_id,a.id) = (m.school_id,m.article_id)
    WHERE (m.school_id,m.class_id,m.id) = ($1,$2,$3) AND ${active}
      AND (NOT $4::boolean OR m.article_id IS NULL OR a.published_at IS NOT NULL)
  `, [schoolId, classId, id, shared]);
  if (!entry) return null;
  privateFileHeaders(reply, entry.kind, 'ressource-classe');
  const bytes = openPrivateFile(entry.content, key, ['media', schoolId, classId, id]);
  if (query.preview || (entry.kind === 'video' || entry.kind === 'audio') && !query.download) {
    reply.header('Content-Disposition', 'inline').header('Content-Security-Policy', "frame-ancestors 'self'");
  }
  if (entry.kind === 'video' || entry.kind === 'audio') {
    return mediaRange(bytes, headers.range, reply);
  }
  return bytes;
}

async function lockDraft(db, schoolId, classId, articleId, version) {
  const { rows: [article] } = await db.query(`
    SELECT published_at,version FROM class_blog_articles WHERE (school_id,class_id,id) = ($1,$2,$3) FOR UPDATE
  `, [schoolId, classId, articleId]);
  if (!article) fail(404);
  if (article.published_at || article.version !== version) fail(409);
}

async function bumpArticle(db, schoolId, articleId) {
  const { rows: [article] } = await db.query(`
    UPDATE class_blog_articles SET version = version + 1, updated_at = date_trunc('milliseconds', statement_timestamp())
    WHERE (school_id,id) = ($1,$2) RETURNING version
  `, [schoolId, articleId]);
  return article.version;
}

async function add(db, schoolId, classId, { articleId, version, title, folder, kind, content, permitted }, key, quota) {
  title = title.trim();
  folder = folder.trim();
  if (!title || /[\p{Cc}]/u.test(title + folder) || !permitted) fail(400);
  if (articleId) {
    if (kind !== 'video') fail(400);
    await lockDraft(db, schoolId, classId, articleId, version);
    const { rows: [count] } = await db.query('SELECT count(*)::integer AS total FROM class_media WHERE school_id = $1 AND article_id = $2',
      [schoolId, articleId]);
    if (count.total >= 2) fail(422);
  }
  const { rows: [lock] } = await db.query(
    "SELECT pg_try_advisory_xact_lock(hashtext('school-media'), hashtext($1)) AS acquired", [schoolId],
  );
  if (!lock.acquired) fail(409);
  const file = kind === 'video' || kind === 'audio' ? await normalizeAV(content, kind) : await preparePrivateFile(content);
  if (file.kind !== kind) fail(415);
  const { rows: [storage] } = await db.query(`
    SELECT COALESCE(sum(octet_length(content)),0) AS used FROM class_media WHERE school_id = $1
  `, [schoolId]);
  const id = randomUUID();
  const encrypted = sealPrivateFile(file.bytes, key, ['media', schoolId, classId, id]);
  if (Number(storage.used) + encrypted.length > quota) fail(413);
  await db.query(`
    INSERT INTO class_media (school_id,class_id,id,article_id,title,folder,kind,content,expires_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,CASE WHEN $4::uuid IS NOT NULL THEN transaction_timestamp() + interval '1 year' END)
  `, [schoolId, classId, id, articleId ?? null, title, folder, kind, encrypted]);
  return articleId ? { id, version: await bumpArticle(db, schoolId, articleId) } : { id };
}

const listQuery = fields({
  articleId: uuid, cursor: timestampCursor,
  search: { type: 'string', maxLength: 120 }, folder: { type: 'string', maxLength: 80 },
}, []);
const readQuery = fields({ preview: { const: '1' }, download: { const: '1' } }, []);
const upload = fields({
  articleId: uuid, version: { type: 'integer', minimum: 1, maximum: 2_147_483_647 },
  title: { type: 'string', minLength: 1, maxLength: 120 }, folder: { type: 'string', maxLength: 80 },
  kind: { type: 'string', enum: ['image', 'pdf', 'audio', 'video'] }, content: mediaEncoded, permitted: { type: 'boolean' },
}, ['title', 'folder', 'kind', 'content', 'permitted']);

export function registerStaffMedia(app, prefix, authenticated, key, quota = 5 * 1024 ** 3) {
  const path = prefix + '/classes/:classId/library';
  const params = uuidParams('classId');
  const item = uuidParams('classId', 'resourceId');
  const teacher = prefix === '/teacher';
  const authorizer = (operation, status) => teacher ? forTeacherClass(authenticated, operation, status)
    : authenticated(async (request, db, actor, reply) => {
      const { classId } = request.params;
      if (request.method !== 'GET' && !await lockActiveClass(db, actor.school_id, classId)) return null;
      const classroom = await db.query('SELECT 1 FROM classes WHERE (school_id,id) = ($1,$2)', [actor.school_id, classId]);
      return classroom.rowCount ? operation(request, db, actor.school_id, classId, reply) : null;
    }, status);
  app.get(path, { schema: { params, querystring: listQuery } }, authorizer((request, db, schoolId, classId) =>
    list(db, schoolId, classId, request.query, false)));
  app.get(path + '/:resourceId', { schema: { params: item, querystring: readQuery } }, authorizer((request, db, schoolId, classId, reply) =>
    read(db, [schoolId, classId, request.params.resourceId], false, key, reply, request)));
  app.post(path, { bodyLimit: blobLimit, config: { rateLimit: { max: 12, timeWindow: '1 minute' } },
    schema: { params, body: upload },
  }, authorizer((request, db, schoolId, classId) => add(db, schoolId, classId, request.body, key, quota), 201));
  app.delete(path + '/:resourceId', { schema: { params: item, querystring: fields({
    version: { type: 'string', pattern: '^[1-9][0-9]{0,9}$' },
  }, []) } }, authorizer(async (request, db, schoolId, classId) => {
    const id = request.params.resourceId;
    const { rows: [entry] } = await db.query('SELECT article_id FROM class_media WHERE (school_id,class_id,id) = ($1,$2,$3)',
      [schoolId, classId, id]);
    if (!entry) return null;
    if (entry.article_id) await lockDraft(db, schoolId, classId, entry.article_id, Number(request.query.version));
    await db.query('DELETE FROM class_media WHERE (school_id,class_id,id) = ($1,$2,$3)', [schoolId, classId, id]);
    return entry.article_id ? { version: await bumpArticle(db, schoolId, entry.article_id) } : {};
  }));
}

export function registerParentMedia(app, authenticated, key) {
  const path = '/parent/children/:childId/library';
  const scoped = (operation) => authenticated(async (request, db, actor, reply) => {
    const classId = await linkedChildClass(db, actor, request.params.childId);
    return classId ? operation(request, db, actor.school_id, classId, reply) : null;
  });
  app.get(path, { schema: { params: uuidParams('childId'), querystring: listQuery } },
    scoped((request, db, schoolId, classId) => list(db, schoolId, classId, request.query, true)));
  app.get(path + '/:resourceId', { schema: { params: uuidParams('childId', 'resourceId'), querystring: readQuery } },
    scoped((request, db, schoolId, classId, reply) => read(db, [schoolId, classId, request.params.resourceId], true, key, reply, request)));
}

export function purgeClassMedia(pool) {
  return pool.query('DELETE FROM class_media WHERE expires_at <= statement_timestamp()');
}
