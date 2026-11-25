import { forTeacherClass, linkedChildClass } from '../auth/class-access.js';
import { uuidParams } from '../auth/staff-web.js';
import { requireTimestampCursor, timestampCursor } from '../db/keyset.js';
import { maxImageBytes } from './images.js';
import { addPhoto, movePhotoToCover, readPhoto, removePhoto, reviewPhoto } from './photos.js';
import {
  changeDraftPhotos, createDraft, deleteDraft, listArticles, readPublishedArticle, readStaffArticle, setPublication, updateDraft,
} from './store.js';

const version = { type: 'integer', minimum: 1, maximum: 2147483647 };
const content = {
  title: { type: 'string', minLength: 1, maxLength: 120 },
  body: { type: 'string', maxLength: 8000 },
};

function schemaFor(properties) {
  return { type: 'object', required: Object.keys(properties), additionalProperties: false, properties };
}

function requireText(input, multiline, required = true) {
  const text = input.trim();
  if ((required && !text) || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text)
      || (!multiline && /[\r\n\t]/.test(text))) {
    throw Object.assign(new Error('Texte non valide.'), { statusCode: 400 });
  }
  return text;
}

function readDraft(body) {
  return { title: requireText(body.title, false), body: requireText(body.body, true, false) };
}

const familyQuery = { type: 'object', additionalProperties: false, properties: { cursor: timestampCursor } };
const staffQuery = {
  ...familyQuery,
  properties: { ...familyQuery.properties, status: { type: 'string', enum: ['all', 'draft', 'published'] } },
};

function requireMediaKey(key) {
  if (!key) throw Object.assign(new Error('Stockage photo indisponible.'), { statusCode: 503 });
  return key;
}

function registerPhotoRead(app, path, authorize, key, publicFeed) {
  app.get(path + '/:articleId/photos/:photoId', {
    schema: {
      params: uuidParams(publicFeed ? 'childId' : 'classId', 'articleId', 'photoId'),
      querystring: { type: 'object', additionalProperties: false, properties: { size: { type: 'string', enum: ['thumb', 'full'] } } },
    },
    async onSend(_request, reply, payload) {
      if (Buffer.isBuffer(payload)) reply.type('image/jpeg').header('X-Content-Type-Options', 'nosniff');
      return payload;
    },
  }, authorize((request, db, schoolId, classId) => readPhoto(
    db, [schoolId, classId, request.params.articleId], request.params.photoId,
    request.query.size ?? 'full', requireMediaKey(key), publicFeed,
  )));
}

export function registerParentBlog(app, { authenticated, mediaKey }) {
  const collection = '/parent/children/:childId/blog';
  function forChild(operation) {
    return authenticated(async (request, db, actor) => {
      const classId = await linkedChildClass(db, actor, request.params.childId);
      return classId ? operation(request, db, actor.school_id, classId) : null;
    });
  }

  app.get(collection, { schema: { params: uuidParams('childId'), querystring: familyQuery } },
    forChild((request, db, schoolId, classId) =>
      listArticles(db, schoolId, classId, requireTimestampCursor(request.query.cursor), 'published', true)));
  app.get(collection + '/:articleId', { schema: { params: uuidParams('childId', 'articleId') } },
    forChild((request, db, schoolId, classId) => readPublishedArticle(db, schoolId, classId, request.params.articleId)));
  registerPhotoRead(app, collection, forChild, mediaKey, true);
}

export function registerTeacherBlog(app, { authenticated, mediaKey, tokenFor, unauthorized }) {
  const collection = '/teacher/classes/:classId/blog';
  const item = collection + '/:articleId';
  const classParams = uuidParams('classId');
  const itemParams = uuidParams('classId', 'articleId');
  function forClass(operation, success) {
    return forTeacherClass(authenticated, operation, success);
  }
  function forArticle(operation) {
    return forClass((request, db, schoolId, classId) =>
      operation(db, [schoolId, classId, request.params.articleId], request.body));
  }

  app.get(collection, { schema: { params: classParams, querystring: staffQuery } },
    forClass((request, db, schoolId, classId) =>
      listArticles(db, schoolId, classId, requireTimestampCursor(request.query.cursor), request.query.status ?? 'all')));
  app.get(item, { schema: { params: itemParams } },
    forClass((request, db, schoolId, classId) => readStaffArticle(db, schoolId, classId, request.params.articleId)));
  app.post(collection, { bodyLimit: 64 * 1024, schema: { params: classParams, body: schemaFor(content) } },
    forClass((request, db, schoolId, classId) => createDraft(db, schoolId, classId, readDraft(request.body)), 201));
  app.put(item, { bodyLimit: 64 * 1024, schema: { params: itemParams, body: schemaFor({ ...content, version }) } },
    forArticle((db, scope, body) => updateDraft(db, scope, body.version, readDraft(body))));
  app.put(item + '/publication', {
    bodyLimit: 1024,
    schema: { params: itemParams, body: schemaFor({ version, published: { type: 'boolean' } }) },
  }, forArticle((db, scope, body) => setPublication(db, scope, body.version, body.published)));
  app.delete(item, { bodyLimit: 1024, schema: { params: itemParams, body: schemaFor({ version }) } },
    forClass(async (request, db, schoolId, classId) => deleteDraft(
      db, [schoolId, classId, request.params.articleId], request.body.version,
    ), 204));

  registerPhotoRead(app, collection, forClass, mediaKey, false);
  const gallery = item + '/photos';
  const photo = gallery + '/:photoId';
  const photoParams = uuidParams('classId', 'articleId', 'photoId');
  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer', bodyLimit: maxImageBytes },
    (_request, input, done) => done(null, input));
  app.post(gallery, {
    bodyLimit: maxImageBytes,
    config: { rateLimit: { max: 48, timeWindow: '1 minute' } },
    async onRequest(request, reply) {
      if (!tokenFor(request)) return unauthorized(reply);
      if (request.headers['content-type'] !== 'application/octet-stream') return reply.code(415).send();
    },
    schema: { params: itemParams, querystring: schemaFor({ version: { type: 'string', pattern: '^[1-9][0-9]{0,9}$' } }) },
  }, forClass((request, db, schoolId, classId) => {
    const scope = [schoolId, classId, request.params.articleId];
    return changeDraftPhotos(db, scope, Number(request.query.version), () =>
      addPhoto(db, scope, request.body, requireMediaKey(mediaKey)));
  }, 201));

  function mutatePhoto(mutation) {
    return forClass((request, db, schoolId, classId) => {
      const scope = [schoolId, classId, request.params.articleId];
      return changeDraftPhotos(db, scope, request.body.version, () =>
        mutation(db, scope, request.params.photoId, request.body));
    });
  }

  app.put(photo, { bodyLimit: 4096, schema: { params: photoParams, body: schemaFor({
    version, reviewed: { type: 'boolean' }, description: { type: 'string', maxLength: 180 },
  }) } }, mutatePhoto((db, scope, id, fields) => reviewPhoto(db, scope, id, {
    reviewed: fields.reviewed, description: requireText(fields.description, false, false),
  })));
  app.put(photo + '/cover', { bodyLimit: 1024, schema: { params: photoParams, body: schemaFor({ version }) } }, mutatePhoto(movePhotoToCover));
  app.delete(photo, { bodyLimit: 1024, schema: { params: photoParams, body: schemaFor({ version }) } }, mutatePhoto(removePhoto));
}
