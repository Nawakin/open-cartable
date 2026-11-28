import { uuidPattern } from '../auth/credentials.js';
import { uuidParams } from '../auth/staff-web.js';
import { requireTimestampCursor, timestampCursor } from '../db/keyset.js';
import { preparePrivateFile, privateFileBody, privateFileBodyLimit, privateFileHeaders } from '../files/private-files.js';
import {
  addMessage, countUnreadConversations, createConversation, listConversations, listParentRecipients,
  markConversationRead, readConversation, conversationDocument,
} from './store.js';

const uuid = { type: 'string', pattern: uuidPattern.source };
const message = { type: 'string', minLength: 1, maxLength: 4000 };
const subject = { type: 'string', minLength: 1, maxLength: 120 };
const document = { document: privateFileBody.properties.content };
const sendingLimit = { rateLimit: { max: 40, timeWindow: '1 minute' } };
const messageLimit = privateFileBodyLimit + 16 * 1024;
const prepare = (body) => body.document ? preparePrivateFile(body.document) : undefined;
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

function registerConversations(app, prefix, authenticated, key, writeOptions = {}) {
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
    bodyLimit: messageLimit, config: sendingLimit,
    schema: { params, body: bodySchema({ body: message }, document) },
  }, authenticated(async (request, db, actor) =>
    addMessage(db, actor, request.params.conversationId, requireText(request.body.body), await prepare(request.body), key), 201));
  app.get(item + '/:messageId/document', { schema: { params: uuidParams('conversationId', 'messageId') } },
    authenticated(async (request, db, actor, reply) => {
      const file = await conversationDocument(db, actor, request.params.conversationId, request.params.messageId, key);
      if (!file) return null;
      privateFileHeaders(reply, file.kind, 'piece-jointe');
      return file.body;
    }));
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

export function registerDirectionMessages(app, authenticated, key) {
  registerConversations(app, '/direction', authenticated, key);
}

function conversationDraft(body) {
  return { childId: body.childId, subject: requireText(body.subject), body: requireText(body.body) };
}

export function registerTeacherMessages(app, authenticated, key) {
  const collection = registerConversations(app, '/teacher', authenticated, key);
  app.post(collection, {
    bodyLimit: messageLimit, config: sendingLimit,
    schema: { body: bodySchema({ childId: uuid, guardianReference: uuid, subject, body: message }, document) },
  }, authenticated(async (request, db, actor) => createConversation(db, actor, {
    ...conversationDraft(request.body), guardianReference: request.body.guardianReference, file: await prepare(request.body),
  }, key), 201));
}

export function registerParentMessages(app, { authenticated, writes, key }) {
  const collection = registerConversations(app, '/parent', authenticated, key, writes);
  app.get('/parent/messages/recipients/:childId', { schema: { params: uuidParams('childId') } },
    authenticated((request, db, actor) => listParentRecipients(db, actor, request.params.childId)));
  app.post(collection, {
    ...writes,
    bodyLimit: messageLimit, config: sendingLimit,
    schema: { body: bodySchema({ childId: uuid, subject, body: message }, { teacherId: uuid, ...document }) },
  }, authenticated(async (request, db, actor) => createConversation(db, actor, {
    ...conversationDraft(request.body), teacherId: request.body.teacherId, file: await prepare(request.body),
  }, key), 201));
}
