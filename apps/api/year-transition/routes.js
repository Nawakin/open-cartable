import { uuidPattern } from '../auth/credentials.js';
import { levels, readYearTransition, saveYearTransition } from './store.js';

const uuid = { type: 'string', pattern: uuidPattern.source };
const level = { type: 'string', enum: levels };
const nullable = (schema) => ({ anyOf: [schema, { type: 'null' }] });
const pupil = { studentId: uuid, sourceClassId: uuid };

function object(properties) {
  return { type: 'object', required: Object.keys(properties), additionalProperties: false, properties };
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
    }) },
  }, authenticated((request, db, actor) => saveYearTransition(db, actor.school_id, request.body)));
}
