import { forTeacherClass, linkedChildClass } from '../auth/class-access.js';
import { uuidParams } from '../auth/staff-web.js';
import { requireTimestampCursor, timestampCursor } from '../db/keyset.js';
import {
  createDraft, deleteDraft, listArticles, readPublishedArticle, readStaffArticle, setPublication, updateDraft,
} from './store.js';

const version = { type: 'integer', minimum: 1, maximum: 2147483647 };
const content = {
  title: { type: 'string', minLength: 1, maxLength: 120 },
  body: { type: 'string', minLength: 1, maxLength: 8000 },
};

function schemaFor(properties) {
  return { type: 'object', required: Object.keys(properties), additionalProperties: false, properties };
}

function requireText(input, multiline) {
  const text = input.trim();
  if (!text || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text) || (!multiline && /[\r\n\t]/.test(text))) {
    throw Object.assign(new Error('Texte non valide.'), { statusCode: 400 });
  }
  return text;
}

function readDraft(body) {
  return { title: requireText(body.title, false), body: requireText(body.body, true) };
}

const familyQuery = { type: 'object', additionalProperties: false, properties: { cursor: timestampCursor } };
const staffQuery = {
  ...familyQuery,
  properties: { ...familyQuery.properties, status: { type: 'string', enum: ['all', 'draft', 'published'] } },
};

export function registerParentBlog(app, { authenticated }) {
  const collection = '/parent/children/:childId/blog';
  function forChild(operation) {
    return authenticated(async (request, db, actor) => {
      const classId = await linkedChildClass(db, actor, request.params.childId);
      return classId ? operation(request, db, actor.school_id, classId) : null;
    });
  }

  app.get(collection, { schema: { params: uuidParams('childId'), querystring: familyQuery } },
    forChild((request, db, schoolId, classId) =>
      listArticles(db, schoolId, classId, requireTimestampCursor(request.query.cursor), 'published')));
  app.get(collection + '/:articleId', { schema: { params: uuidParams('childId', 'articleId') } },
    forChild((request, db, schoolId, classId) => readPublishedArticle(db, schoolId, classId, request.params.articleId)));
}

export function registerTeacherBlog(app, authenticated) {
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
}
