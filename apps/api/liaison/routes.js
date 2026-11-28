import { uuidPattern } from '../auth/credentials.js';
import { uuidParams } from '../auth/staff-web.js';
import { isSchoolDate } from '../homework/period.js';
import { forTeacherClass } from '../auth/class-access.js';
import { listClassNotes, listFamilyNotes, listNoteReplies, saveDailyNote, saveFamilyReply, saveScheduledNote, deleteScheduledNote } from './store.js';

const dayField = { type: 'string', minLength: 10, maxLength: 10 };
const dateQuery = {
  type: 'object', additionalProperties: false,
  properties: { before: dayField },
};
const replyQuery = {
  type: 'object', additionalProperties: false,
  properties: { after: { type: 'string', pattern: uuidPattern.source } },
};

function textBody(maxLength, fields = {}) {
  const properties = { body: { type: 'string', minLength: 1, maxLength }, ...fields };
  return { type: 'object', required: Object.keys(properties), additionalProperties: false, properties };
}

function requireDay(day) {
  if (day === undefined) return null;
  if (!isSchoolDate(day)) throw Object.assign(new Error('Date non valide.'), { statusCode: 400 });
  return day;
}

function requireText(input) {
  const body = input.trim();
  if (!body || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(body)) {
    throw Object.assign(new Error('Texte non valide.'), { statusCode: 400 });
  }
  return body;
}

export function registerParentLiaison(app, { authenticated, writes }) {
  const path = '/parent/children/:childId/liaison';
  app.get(path, { schema: { params: uuidParams('childId'), querystring: dateQuery } },
    authenticated((request, db, actor) =>
      listFamilyNotes(db, actor, request.params.childId, requireDay(request.query.before))));
  app.put(path + '/:noteId/reply', {
    ...writes,
    bodyLimit: 16 * 1024,
    schema: { params: uuidParams('childId', 'noteId'), body: textBody(500) },
  }, authenticated((request, db, actor) => saveFamilyReply(
    db, actor, request.params.childId, request.params.noteId, requireText(request.body.body),
  )));
}

export function registerTeacherLiaison(app, authenticated) {
  const path = '/teacher/classes/:classId/liaison';
  const classParams = uuidParams('classId');
  function forClass(operation) {
    return forTeacherClass(authenticated, operation);
  }

  app.get(path, { schema: { params: classParams, querystring: dateQuery } },
    forClass((request, db, schoolId, classId) => listClassNotes(db, schoolId, classId, requireDay(request.query.before))));
  app.put(path + '/today', {
    bodyLimit: 16 * 1024,
    schema: { params: classParams, body: textBody(1000, { day: dayField }) },
  }, forClass(async (request, db, schoolId, classId) => {
    const note = await saveDailyNote(db, schoolId, classId, requireDay(request.body.day), requireText(request.body.body));
    if (!note) throw Object.assign(new Error('La date a changé.'), { statusCode: 409 });
    return note;
  }));
  app.put(path + '/schedule', {
    bodyLimit: 16 * 1024, schema: { params: classParams, body: textBody(1000, { day: dayField }) },
  }, forClass(async (request, db, schoolId, classId) => {
    const note = await saveScheduledNote(db, schoolId, classId, requireDay(request.body.day), requireText(request.body.body));
    if (!note) throw Object.assign(new Error('Choisissez une date à venir.'), { statusCode: 409 });
    return { ...note, scheduled: true };
  }));
  app.delete(path + '/schedule/:noteId', { schema: { params: uuidParams('classId', 'noteId') } },
    forTeacherClass(authenticated, async (request, db, schoolId, classId) =>
      await deleteScheduledNote(db, schoolId, classId, request.params.noteId) ? undefined : null, 204));
  app.get(path + '/:noteId/replies', { schema: { params: uuidParams('classId', 'noteId'), querystring: replyQuery } },
    forClass((request, db, schoolId, classId) =>
      listNoteReplies(db, schoolId, classId, request.params.noteId, request.query.after ?? null)));
}
