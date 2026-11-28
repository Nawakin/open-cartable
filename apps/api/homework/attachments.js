import { linkedChildClass, lockActiveClass, forTeacherClass } from '../auth/class-access.js';
import { uuidParams } from '../auth/staff-web.js';
import { openPrivateFile, preparePrivateFile, privateFileBody, privateFileBodyLimit, sealPrivateFile, privateFileHeaders } from '../files/private-files.js';

const target = '(school_id,class_id,id) = ($1,$2,$3)';

async function download(db, ids, key, reply, publicOnly = false) {
  const { rows: [file] } = await db.query(`
    SELECT attachment_data, attachment_kind FROM homework_entries WHERE ${target} AND attachment_kind IS NOT NULL AND (NOT $4::boolean OR publish_at <= statement_timestamp())
  `, [...ids, publicOnly]);
  if (!file) return null;
  privateFileHeaders(reply, file.attachment_kind, 'document-cahier-de-texte');
  return openPrivateFile(file.attachment_data, key, ['homework', ...ids]);
}

export function registerHomeworkAttachments(app, prefix, authenticated, key) {
  const path = prefix + '/classes/:classId/homework/:entryId/document';
  const params = uuidParams('classId', 'entryId');
  const authorize = prefix === '/teacher' ? forTeacherClass : (auth, operation, success) =>
    auth(async (request, db, actor, reply) => {
      const { classId } = request.params;
      if (request.method !== 'GET' && !await lockActiveClass(db, actor.school_id, classId)) return null;
      return operation(request, db, actor.school_id, classId, reply);
    }, success);

  app.get(path, { schema: { params } }, authorize(authenticated, (request, db, schoolId, classId, reply) =>
    download(db, [schoolId, classId, request.params.entryId], key, reply)));
  app.put(path, { bodyLimit: privateFileBodyLimit, schema: { params, body: privateFileBody } },
    authorize(authenticated, async (request, db, schoolId, classId) => {
      const ids = [schoolId, classId, request.params.entryId];
      const current = await db.query(`SELECT 1 FROM homework_entries WHERE ${target} FOR UPDATE`, ids);
      if (!current.rowCount) return null;
      const file = await preparePrivateFile(request.body.content);
      const encrypted = sealPrivateFile(file.bytes, key, ['homework', ...ids]);
      await db.query(`UPDATE homework_entries SET attachment_kind = $4, attachment_data = $5 WHERE ${target}`,
        [...ids, file.kind, encrypted]);
    }, 204));
  app.delete(path, { schema: { params } }, authorize(authenticated, async (request, db, schoolId, classId) => {
    const removed = await db.query(`UPDATE homework_entries SET attachment_kind = NULL, attachment_data = NULL WHERE ${target}`,
      [schoolId, classId, request.params.entryId]);
    return removed.rowCount ? undefined : null;
  }, 204));
}

export function registerParentHomeworkAttachments(app, authenticated, key) {
  app.get('/parent/children/:childId/homework/:entryId/document', { schema: { params: uuidParams('childId', 'entryId') } },
    authenticated(async (request, db, actor, reply) => {
      const classId = await linkedChildClass(db, actor, request.params.childId);
      if (!classId) return null;
      return download(db, [actor.school_id, classId, request.params.entryId], key, reply, true);
    }));
}
