import { uuidParams } from '../auth/staff-web.js';
import { lockActiveClass } from '../auth/class-access.js';
import { createEntry, deleteEntry, listClassEntries, readEntry, updateEntry } from './entries.js';
import { homeworkQuerySchema, readPeriod } from './period.js';

function requireEntry(input) {
  const entry = readEntry(input);
  if (!entry) throw Object.assign(new Error('Entrée non valide.'), { statusCode: 400 });
  return entry;
}

export function registerStaffHomework(app, prefix, authenticated, canAccessClass) {
  const classPath = prefix + '/classes/:classId/homework';
  const classParams = uuidParams('classId');
  const entryParams = uuidParams('classId', 'entryId');

  function classRoute(operation, status) {
    return authenticated(async (request, db, actor) => {
      if (canAccessClass && !await canAccessClass(db, actor, request.params.classId)) return null;
      if (!await lockActiveClass(db, actor.school_id, request.params.classId)) return null;
      return operation(request, db, actor);
    }, status);
  }

  app.get(classPath, {
    schema: { params: classParams, querystring: homeworkQuerySchema },
  }, classRoute((request, db, actor) => {
    const period = readPeriod(request.query);
    if (!period) throw Object.assign(new Error('Période non valide.'), { statusCode: 400 });
    return listClassEntries(db, actor.school_id, request.params.classId, period);
  }));

  app.post(classPath, { bodyLimit: 32 * 1024, schema: { params: classParams } },
    classRoute(async (request, db, actor) => {
      const id = await createEntry(db, actor.school_code, request.params.classId, requireEntry(request.body));
      return id ? { id } : null;
    }, 201));

  app.put(classPath + '/:entryId', { bodyLimit: 32 * 1024, schema: { params: entryParams } },
    classRoute(async (request, db, actor) => {
      const { classId, entryId } = request.params;
      const updated = await updateEntry(db, actor.school_code, classId, entryId, requireEntry(request.body));
      return updated ? undefined : null;
    }, 204));

  app.delete(classPath + '/:entryId', { schema: { params: entryParams } },
    classRoute(async (request, db, actor) => {
      const { classId, entryId } = request.params;
      const removed = await deleteEntry(db, actor.school_code, classId, entryId);
      return removed ? undefined : null;
    }, 204));
}
