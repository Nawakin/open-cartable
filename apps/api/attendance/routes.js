import { forTeacherClass, linkedChildClass } from '../auth/class-access.js';
import { uuidPattern } from '../auth/credentials.js';
import { uuidParams } from '../auth/staff-web.js';
import { isSchoolDate } from '../homework/period.js';
import {
  attendanceStatuses, childAttendance, classAttendance, readRoll, saveRoll, setJustification,
} from './store.js';

const uuid = { type: 'string', pattern: uuidPattern.source };
const day = { type: 'string', minLength: 10, maxLength: 10 };
const rollParams = schemaFor({ classId: uuid, day });
const monthQuery = schemaFor({ month: { type: 'string', minLength: 7, maxLength: 7 } });

function schemaFor(properties) {
  return { type: 'object', required: Object.keys(properties), additionalProperties: false, properties };
}

function validDate(date) {
  if (!isSchoolDate(date)) throw Object.assign(new Error('Date d’appel non valide.'), { statusCode: 400 });
  return date;
}

export function registerTeacherAttendance(app, authenticated) {
  const path = '/teacher/classes/:classId/attendance/:day';
  app.get(path, { schema: { params: rollParams } },
    forTeacherClass(authenticated, (request, db, schoolId, classId) =>
      readRoll(db, [schoolId, classId, validDate(request.params.day)])));
  app.put(path, {
    bodyLimit: 128 * 1024,
    schema: { params: rollParams, body: schemaFor({
      revision: { anyOf: [uuid, { type: 'null' }] },
      entries: { type: 'array', minItems: 1, maxItems: 1000, items: schemaFor({
        studentId: uuid, status: { type: 'string', enum: attendanceStatuses },
      }) },
    }) },
  }, forTeacherClass(authenticated, (request, db, schoolId, classId) =>
    saveRoll(db, [schoolId, classId, validDate(request.params.day)], request.body.revision, request.body.entries)));
}

export function registerDirectionAttendance(app, authenticated) {
  const path = '/direction/classes/:classId/attendance';
  app.get(path, { schema: { params: uuidParams('classId'), querystring: monthQuery } },
    authenticated(async (request, db, actor) => {
      const classId = request.params.classId;
      const current = await db.query('SELECT 1 FROM classes WHERE (school_id, id) = ($1, $2) FOR SHARE',
        [actor.school_id, classId]);
      return current.rowCount ? classAttendance(db, actor.school_id, classId, validDate(request.query.month + '-01')) : null;
    }));
  app.put(path + '/:day/students/:studentId', {
    bodyLimit: 1024,
    schema: { params: schemaFor({ classId: uuid, day, studentId: uuid }),
      body: schemaFor({ revision: uuid, justified: { type: 'boolean' } }) },
  }, authenticated((request, db, actor) => setJustification(db,
    [actor.school_id, request.params.classId, validDate(request.params.day)], request.params.studentId,
    request.body.revision, request.body.justified)));
}

export function registerParentAttendance(app, authenticated) {
  app.get('/parent/children/:childId/attendance', { schema: { params: uuidParams('childId'), querystring: monthQuery } },
    authenticated(async (request, db, actor) => {
      const childId = request.params.childId;
      if (!await linkedChildClass(db, actor, childId, { historical: true })) return null;
      return childAttendance(db, actor.school_id, childId, validDate(request.query.month + '-01'));
    }));
}
