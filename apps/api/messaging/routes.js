import { isInstant } from '../agenda/period.js';
import { uuidPattern } from '../auth/credentials.js';
import { uuidParams } from '../auth/staff-web.js';
import {
  addMessage, countUnreadConversations, createConversation, listConversations, listParentRecipients,
  markConversationRead, readConversation,
} from './store.js';

const uuid = { type: 'string', pattern: uuidPattern.source };
const message = { type: 'string', minLength: 1, maxLength: 4000 };
const subject = { type: 'string', minLength: 1, maxLength: 120 };
const querystring = {
  type: 'object', additionalProperties: false,
  properties: { cursor: { type: 'string', minLength: 61, maxLength: 61 } },
};

function bodySchema(properties, optional = {}) {
  return { type: 'object', required: Object.keys(properties), additionalProperties: false, properties: { ...properties, ...optional } };
}

function requireText(input) {
  const text = input.trim();
  if (!text || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text)) {
    throw Object.assign(new Error('Texte non valide.'), { statusCode: 400 });
  }
  return text;
}

function requireCursor(cursor) {
  if (cursor === undefined) return { beforeAt: null, beforeId: null };
  const [beforeAt, beforeId, ...rest] = cursor.split('~');
  if (rest.length || !isInstant(beforeAt) || !beforeId || !uuidPattern.test(beforeId)) {
    throw Object.assign(new Error('Page non valide.'), { statusCode: 400 });
  }
  return { beforeAt, beforeId };
}

function registerConversations(app, prefix, authenticated, writeOptions = {}) {
  const collection = prefix + '/messages/conversations';
  const item = collection + '/:conversationId';
  const params = uuidParams('conversationId');

  app.get(prefix + '/messages/unread', authenticated((_request, db, actor) => countUnreadConversations(db, actor)));
  app.get(collection, { schema: { querystring } },
    authenticated((request, db, actor) => listConversations(db, actor, requireCursor(request.query.cursor))));
  app.get(item, { schema: { params, querystring } },
    authenticated((request, db, actor) =>
      readConversation(db, actor, request.params.conversationId, requireCursor(request.query.cursor))));
  app.post(item, {
    ...writeOptions,
    bodyLimit: 64 * 1024,
    schema: { params, body: bodySchema({ body: message }) },
  }, authenticated((request, db, actor) =>
    addMessage(db, actor, request.params.conversationId, requireText(request.body.body)), 201));
  app.put(item + '/read', {
    ...writeOptions,
    bodyLimit: 1024,
    schema: { params, body: bodySchema({ messageId: uuid }) },
  }, authenticated(async (request, db, actor) => {
    const marked = await markConversationRead(db, actor, request.params.conversationId, request.body.messageId);
    return marked ? undefined : null;
  }, 204));

  return collection;
}

export function registerDirectionMessages(app, authenticated) {
  registerConversations(app, '/direction', authenticated);
}

function conversationDraft(body) {
  return { childId: body.childId, subject: requireText(body.subject), body: requireText(body.body) };
}

export function registerTeacherMessages(app, authenticated) {
  const collection = registerConversations(app, '/teacher', authenticated);
  app.post(collection, {
    bodyLimit: 64 * 1024,
    schema: { body: bodySchema({ childId: uuid, guardianReference: uuid, subject, body: message }) },
  }, authenticated((request, db, actor) => createConversation(db, actor, {
    ...conversationDraft(request.body), guardianReference: request.body.guardianReference,
  }), 201));
}

export function registerParentMessages(app, { store, identify, webOrigin, unauthorized }) {
  function authenticated(operation, success = 200) {
    return async (request, reply) => {
      const claims = await identify(request);
      if (!claims) return unauthorized(reply);
      const result = await store.withMessagingSession(claims, (db, actor) => operation(request, db, actor));
      if (!result.authorized) return unauthorized(reply);
      if (result.value === null) return reply.code(404).send({ error: 'Ressource introuvable.' });
      return reply.code(success).send(result.value);
    };
  }

  const writes = {
    async onRequest(request, reply) {
      if (request.headers.authorization !== undefined) return;
      if (!webOrigin || request.headers.origin !== webOrigin) {
        return reply.code(403).send({ error: 'Origine non autorisée.' });
      }
    },
  };
  const collection = registerConversations(app, '/parent', authenticated, writes);
  app.get('/parent/messages/recipients/:childId', { schema: { params: uuidParams('childId') } },
    authenticated((request, db, actor) => listParentRecipients(db, actor, request.params.childId)));
  app.post(collection, {
    ...writes,
    bodyLimit: 64 * 1024,
    schema: { body: bodySchema({ childId: uuid, subject, body: message }, { teacherId: uuid }) },
  }, authenticated((request, db, actor) => createConversation(db, actor, {
    ...conversationDraft(request.body), teacherId: request.body.teacherId,
  }), 201));
}
