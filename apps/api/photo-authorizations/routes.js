import { forTeacherClass } from '../auth/class-access.js';
import { uuidPattern } from '../auth/credentials.js';
import { uuidParams } from '../auth/staff-web.js';
import { listClassAuthorizations, listFamilyAuthorizations, setAuthorization } from './store.js';

export function registerDirectionPhotoAuthorizations(app, authenticated) {
  const collection = '/direction/classes/:classId/photo-authorizations';
  app.get(collection, { schema: { params: uuidParams('classId') } }, authenticated(async (request, db, actor) => {
    const classId = request.params.classId;
    const current = await db.query('SELECT 1 FROM classes WHERE school_id = $1 AND id = $2',
      [actor.school_id, classId]);
    if (!current.rowCount) return null;
    return listClassAuthorizations(db, actor.school_id, classId, true);
  }));

  app.put(collection + '/:studentId', {
    bodyLimit: 1024,
    schema: {
      params: uuidParams('classId', 'studentId'),
      body: {
        type: 'object', required: ['status', 'revision'], additionalProperties: false,
        properties: {
          status: { type: 'string', enum: ['unrecorded', 'allowed', 'refused'] },
          revision: { anyOf: [{ type: 'string', pattern: uuidPattern.source }, { type: 'null' }] },
        },
      },
    },
  }, authenticated((request, db, actor) =>
    setAuthorization(db, actor.school_id, request.params.classId, request.params.studentId, request.body)));
}

export function registerTeacherPhotoAuthorizations(app, authenticated) {
  app.get('/teacher/classes/:classId/photo-authorizations', { schema: { params: uuidParams('classId') } },
    forTeacherClass(authenticated, (_request, db, schoolId, classId) =>
      listClassAuthorizations(db, schoolId, classId)));
}

export function registerFamilyPhotoAuthorizations(app, authenticated) {
  app.get('/parent/photo-authorizations',
    authenticated((_request, db, actor) => listFamilyAuthorizations(db, actor)));
}
