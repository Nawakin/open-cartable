import { randomUUID } from 'node:crypto';
import { insertParentInvitation } from '../auth/parent-store.js';
import { uuidPattern } from '../auth/credentials.js';
import { uuidParams } from '../auth/staff-web.js';
import { lockActiveClass } from '../auth/class-access.js';
import { isSchoolDate } from '../homework/period.js';
import { levels } from '../year-transition/store.js';

const uuid = { type: 'string', pattern: uuidPattern.source };
const name = { type: 'string', minLength: 1, maxLength: 100 };
const grade = { type: 'string', enum: levels };
const nullable = (schema) => ({ anyOf: [schema, { type: 'null' }] });
const ids = { type: 'array', minItems: 1, maxItems: 200, uniqueItems: true, items: uuid };

function fields(properties) {
  return { type: 'object', additionalProperties: false, required: Object.keys(properties), properties };
}

function invalid(statusCode = 400) {
  throw Object.assign(new Error('Fiche scolaire non valide.'), { statusCode });
}

function displayName(value) {
  const name = value.trim().normalize('NFC');
  if (!name || /[\p{Cc}\u2028\u2029]/u.test(name)) invalid();
  return name;
}

async function exportDirectory(db, id) {
  const classes = (await db.query(`SELECT id, name, levels FROM classes
    WHERE school_id = $1 AND archived_year IS NULL ORDER BY name, id`, [id])).rows;
  const students = (await db.query(`
    SELECT s.id, s.display_name AS "displayName", s.class_id AS "classId", s.grade, s.birth_date::text AS "birthDate",
      s.left_at IS NOT NULL AS departed, c.name AS "className"
    FROM students s JOIN classes c ON (c.school_id, c.id) = (s.school_id, s.class_id)
    WHERE s.school_id = $1 ORDER BY s.left_at IS NOT NULL, s.display_name, s.id
  `, [id])).rows;
  const guardians = (await db.query(`
    SELECT g.id, g.display_name AS "displayName", g.active,
      ARRAY(SELECT student_id FROM guardian_students l WHERE (l.school_id, l.guardian_id) = (g.school_id, g.id)
        ORDER BY student_id) AS "studentIds"
    FROM guardians g WHERE g.school_id = $1 ORDER BY g.display_name, g.id
  `, [id])).rows;
  return { classes, students, guardians };
}

async function saveClass(db, schoolId, id, { displayName: input, levels }) {
  const name = displayName(input);
  const duplicate = await db.query(`SELECT 1 FROM classes
    WHERE school_id = $1 AND archived_year IS NULL AND lower(name) = lower($2) AND id <> $3`, [schoolId, name, id]);
  if (duplicate.rowCount) invalid(409);
  const saved = await db.query(`
    INSERT INTO classes (school_id, id, name, levels) VALUES ($1, $2, $3, $4)
    ON CONFLICT (school_id, id) DO UPDATE SET name = excluded.name, levels = excluded.levels
    WHERE classes.archived_year IS NULL RETURNING id
  `, [schoolId, id, name, levels]);
  return saved.rowCount ? { id } : null;
}

async function saveStudent(db, schoolId, id, { displayName: input, classId, birthDate, grade, departed }) {
  if (!await lockActiveClass(db, schoolId, classId)) return null;
  if (birthDate !== null && !isSchoolDate(birthDate)) invalid();
  const { rows: [room] } = await db.query('SELECT levels FROM classes WHERE (school_id, id) = ($1, $2)', [schoolId, classId]);
  if (grade && room.levels.length && !room.levels.includes(grade)) invalid();
  await db.query(`
    INSERT INTO students (school_id, id, class_id, display_name, birth_date, grade, left_at)
    VALUES ($1, $2, $3, $4, $5, $6, CASE WHEN $7 THEN statement_timestamp() END)
    ON CONFLICT (school_id, id) DO UPDATE SET class_id = excluded.class_id, display_name = excluded.display_name,
      birth_date = excluded.birth_date, grade = excluded.grade,
      left_at = CASE WHEN $7 THEN COALESCE(students.left_at, statement_timestamp()) END
  `, [schoolId, id, classId, displayName(input), birthDate, grade, departed]);
  return { id };
}

async function saveGuardian(db, schoolId, id, { displayName: input, studentIds, active }) {
  const valid = await db.query('SELECT id FROM students WHERE school_id = $1 AND id = ANY($2::uuid[])',
    [schoolId, studentIds]);
  if (valid.rowCount !== studentIds.length) return null;
  await db.query(`
    INSERT INTO guardians (school_id, id, display_name, active) VALUES ($1, $2, $3, $4)
    ON CONFLICT (school_id, id) DO UPDATE SET display_name = excluded.display_name, active = excluded.active
  `, [schoolId, id, displayName(input), active]);
  await db.query(`DELETE FROM guardian_students WHERE (school_id, guardian_id) = ($1, $2)
    AND NOT student_id = ANY($3::uuid[])`, [schoolId, id, studentIds]);
  await db.query(`
    INSERT INTO guardian_students (school_id, guardian_id, student_id)
    SELECT $1, $2, id FROM unnest($3::uuid[]) AS id
    ON CONFLICT DO NOTHING
  `, [schoolId, id, studentIds]);
  if (!active) await revokeCredentials(db, schoolId, [id], true);
  return { id };
}

async function revokeCredentials(db, schoolId, ids, sessions) {
  await db.query(`UPDATE parent_invitations SET revoked_at = statement_timestamp()
    WHERE school_id = $1 AND guardian_id = ANY($2::uuid[]) AND consumed_at IS NULL AND revoked_at IS NULL`, [schoolId, ids]);
  if (sessions) await db.query(`UPDATE parent_sessions SET revoked_at = statement_timestamp()
    WHERE school_id = $1 AND guardian_id = ANY($2::uuid[]) AND revoked_at IS NULL`, [schoolId, ids]);
}

export function registerSchoolDirectory(app, authenticated, invitationKey) {
  const path = '/direction/directory';
  app.get(path, authenticated((_request, db, actor) => exportDirectory(db, actor.school_id)));

  function mutation(operation, status = 200) {
    return authenticated(async (request, db, actor) => {
      await db.query('SELECT id FROM schools WHERE id = $1 FOR UPDATE', [actor.school_id]);
      return operation(request, db, actor);
    }, status);
  }

  function resource(section, table, schema, save) {
    app.post(path + '/' + section, { bodyLimit: 32 * 1024, schema: { body: schema } },
      mutation((request, db, actor) => save(db, actor.school_id, randomUUID(), request.body), 201));
    app.put(path + '/' + section + '/:entryId', { bodyLimit: 32 * 1024, schema: { params: uuidParams('entryId'), body: schema } },
      mutation(async (request, db, actor) => {
        const id = request.params.entryId;
        const current = await db.query(`SELECT 1 FROM ${table} WHERE (school_id, id) = ($1, $2)`, [actor.school_id, id]);
        return current.rowCount ? save(db, actor.school_id, id, request.body) : null;
      }));
  }

  resource('classes', 'classes', fields({
    displayName: name, levels: { type: 'array', maxItems: levels.length, uniqueItems: true, items: grade },
  }), saveClass);
  resource('students', 'students', fields({
    displayName: name, classId: uuid, grade: nullable(grade),
    birthDate: nullable({ type: 'string', minLength: 10, maxLength: 10 }), departed: { type: 'boolean' },
  }), saveStudent);
  resource('guardians', 'guardians', fields({ displayName: name, studentIds: ids, active: { type: 'boolean' } }), saveGuardian);

  app.post(path + '/invitations', { bodyLimit: 32 * 1024, schema: { body: fields({
    guardianIds: ids, replaceSessions: { type: 'boolean' },
  }) } }, mutation(async ({ body }, db, actor) => {
    if (!invitationKey) invalid(503);
    const { school_id: schoolId, school_code: schoolCode } = actor;
    const { rows } = await db.query(`
      SELECT g.id, g.display_name AS name FROM guardians g
      WHERE g.school_id = $1 AND g.id = ANY($2::uuid[]) AND g.active AND EXISTS (
        SELECT 1 FROM guardian_students l JOIN students s ON (s.school_id, s.id) = (l.school_id, l.student_id)
        JOIN classes c ON (c.school_id, c.id) = (s.school_id, s.class_id)
        WHERE (l.school_id, l.guardian_id) = (g.school_id, g.id) AND s.left_at IS NULL AND c.archived_year IS NULL
      ) ORDER BY g.id FOR UPDATE OF g
    `, [schoolId, body.guardianIds]);
    if (rows.length !== body.guardianIds.length) invalid(409);
    await revokeCredentials(db, schoolId, body.guardianIds, body.replaceSessions);
    const invitations = [];
    for (const { id: guardianId, name } of rows) {
      const invitation = await insertParentInvitation(db, invitationKey, { schoolCode, schoolId, guardianId });
      invitations.push({ id: guardianId, name, ...invitation });
    }
    return { schoolCode, invitations };
  }, 201));
}
