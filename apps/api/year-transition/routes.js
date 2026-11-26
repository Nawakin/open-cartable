import { uuidPattern } from '../auth/credentials.js';
import { applyYearTransition, levels, readYearTransition, saveYearTransition } from './store.js';
import { archiveEntries, archivedClasses } from './archive.js';
import { uuidParams } from '../auth/staff-web.js';

const uuid = { type: 'string', pattern: uuidPattern.source };
const level = { type: 'string', enum: levels };
const nullable = (schema) => ({ anyOf: [schema, { type: 'null' }] });
const pupil = { studentId: uuid, sourceClassId: uuid };

function object(properties, extra = {}) {
  return { type: 'object', required: Object.keys(properties), additionalProperties: false, properties: { ...properties, ...extra } };
}

function array(items, maxItems) {
  return { type: 'array', items, maxItems };
}

export function registerYearTransition(app, authenticated) {
  const path = '/direction/year-transition';
  app.get(path, authenticated((_request, db, actor) => readYearTransition(db, actor.school_id)));
  app.put(path, {
    bodyLimit: 1024 * 1024,
    schema: { body: object({
      revision: nullable(uuid), startYear: { type: 'integer', minimum: 1900, maximum: 9998 },
      classes: array(object({
        id: nullable(uuid), name: { type: 'string', minLength: 1, maxLength: 100 },
        levels: { ...array(level, levels.length), minItems: 1, uniqueItems: true },
      }), 150),
      sourceLevels: array(object({ classId: uuid, level }), 150),
      overrides: array(object({ ...pupil, level }), 2000),
      assignments: array(object({
        ...pupil, sourceLevel: nullable(level), target: nullable(object({ classId: uuid, level })),
      }), 2000),
    }, { teacherAssignments: array(object({ teacherId: uuid, classId: uuid }), 2000) }) },
  }, authenticated((request, db, actor) => saveYearTransition(db, actor.school_id, request.body)));
  app.post(path + '/apply', { bodyLimit: 2048, schema: { body: object({
    revision: uuid, confirmation: { type: 'integer', minimum: 1901, maximum: 9999 },
  }) } }, authenticated((request, db, actor) => applyYearTransition(db, actor.school_id, request.body)));

  app.get('/direction/school-archives', authenticated(async (_request, db, actor) => ({
    classes: await archivedClasses(db, actor.school_id),
  })));
  app.get('/direction/school-archives/:classId', { schema: { params: uuidParams('classId'), querystring: object({
    kind: { type: 'string', enum: ['homework', 'liaison', 'agenda', 'blog'] },
  }, { offset: { type: 'string', pattern: '^(0|[1-9][0-9]{0,5})$' } }) } },
  authenticated((request, db, actor) => archiveEntries(db, actor.school_id, request.params.classId,
    request.query.kind, Number(request.query.offset ?? 0))));
}
