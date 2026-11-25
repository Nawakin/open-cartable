import { uuidPattern } from '../auth/credentials.js';
import { uuidParams } from '../auth/staff-web.js';
import { requireTimestampCursor, timestampCursor } from '../db/keyset.js';
import {
  addMessage, countUnreadConversations, createConversation, listConversations, listParentRecipients,
  markConversationRead, readConversation,
} from './store.js';

const uuid = { type: 'string', pattern: uuidPattern.source };
const message = { type: 'string', minLength: 1, maxLength: 4000 };
const subject = { type: 'string', minLength: 1, maxLength: 120 };
const querystring = {
  type: 'object', additionalProperties: false,
  properties: { cursor: timestampCursor },
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

function registerConversations(app, prefix, authenticated, writeOptions = {}) {
  const collection = prefix + '/messages/conversations';
  const item = collection + '/:conversationId';
  const params = uuidParams('conversationId');

  app.get(prefix + '/messages/unread', authenticated((_request, db, actor) => countUnreadConversations(db, actor)));
  app.get(collection, { schema: { querystring } },
    authenticated((request, db, actor) => listConversations(db, actor, requireTimestampCursor(request.query.cursor))));
  app.get(item, { schema: { params, querystring } },
    authenticated((request, db, actor) =>
      readConversation(db, actor, request.params.conversationId, requireTimestampCursor(request.query.cursor))));
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

export function registerParentMessages(app, { authenticated, writes }) {
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
