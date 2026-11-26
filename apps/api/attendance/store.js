import { randomUUID } from 'node:crypto';

const today = "(transaction_timestamp() AT TIME ZONE 'Europe/Paris')::date";
const cutoff = `(${today} - interval '3 years')::date`;
const rollScope = '(school_id, class_id, day) = ($1, $2, $3)';
const history = `e.day >= $3::date AND e.day < $3::date + interval '1 month'
  AND e.day BETWEEN ${cutoff} AND ${today} AND e.status <> 'present'`;
const alertThreshold = 3;
export const attendanceStatuses = ['present', 'absent', 'late', 'left'];

function conflict() {
  throw Object.assign(new Error('L’appel ou la liste des élèves a changé.'), { statusCode: 409 });
}

export async function readRoll(db, scope) {
  const { rows: [roll] } = await db.query(`
    SELECT r.revision, $3::date::text AS day,
      ($3::date = ${today}) AS "canStart",
      COALESCE((
        SELECT json_agg(mark ORDER BY mark."displayName", mark.id) FROM (
          SELECT s.id, s.display_name AS "displayName", e.status
          FROM attendance_entries e JOIN students s ON (s.school_id, s.id) = (e.school_id, e.student_id)
          WHERE (e.school_id, e.class_id, e.day) = ($1, $2, $3) AND r.revision IS NOT NULL
          UNION ALL
          SELECT id, display_name, 'present' FROM students
          WHERE (school_id, class_id) = ($1, $2) AND left_at IS NULL AND r.revision IS NULL AND $3::date = ${today}
        ) mark
      ), '[]'::json) AS students
    FROM (VALUES ($1::uuid, $2::uuid, $3::date)) requested(school_id, class_id, day)
    LEFT JOIN attendance_rolls r USING (school_id, class_id, day)
    WHERE requested.day BETWEEN ${cutoff} AND ${today}
  `, scope);
  return roll ?? null;
}

async function lockRoll(db, scope, revision) {
  const { rows: [roll] } = await db.query(`
    SELECT revision FROM attendance_rolls WHERE ${rollScope} AND day BETWEEN ${cutoff} AND ${today} FOR UPDATE
  `, scope);
  if (!roll) return false;
  if (roll.revision !== revision) conflict();
  return true;
}

export async function saveRoll(db, scope, revision, entries) {
  if (revision === null) {
    const created = await db.query(`
      INSERT INTO attendance_rolls (school_id, class_id, day, revision)
      SELECT $1, $2, $3::date, $4 WHERE $3::date = ${today}
      ON CONFLICT (school_id, class_id, day) DO NOTHING
    `, [...scope, randomUUID()]);
    if (!created.rowCount) conflict();
  } else if (!await lockRoll(db, scope, revision)) {
    return null;
  }

  const { rows } = revision === null
    ? await db.query('SELECT id FROM students WHERE (school_id, class_id) = ($1, $2) AND left_at IS NULL ORDER BY id FOR SHARE', scope.slice(0, 2))
    : await db.query(`
      SELECT s.id FROM attendance_entries e JOIN students s ON (s.school_id, s.id) = (e.school_id, e.student_id)
      WHERE (e.school_id, e.class_id, e.day) = ($1, $2, $3) ORDER BY s.id FOR SHARE OF s
    `, scope);
  const remaining = new Set(rows.map(({ id }) => id));
  if (entries.length !== remaining.size || entries.some(({ studentId }) => !remaining.delete(studentId))) conflict();

  await db.query(`
    INSERT INTO attendance_entries (school_id, class_id, day, student_id, status)
    SELECT $1, $2, $3, marks.student_id, marks.status
    FROM unnest($4::uuid[], $5::text[]) marks(student_id, status)
    ON CONFLICT (school_id, class_id, day, student_id) DO UPDATE
      SET status = excluded.status, justified = false
      WHERE attendance_entries.status <> excluded.status
  `, [...scope, entries.map(({ studentId }) => studentId), entries.map(({ status }) => status)]);
  await db.query(`DELETE FROM absence_justifications j USING attendance_entries e
    WHERE (j.school_id,j.class_id,j.day,j.student_id) = (e.school_id,e.class_id,e.day,e.student_id)
      AND (e.school_id,e.class_id,e.day) = ($1,$2,$3) AND e.status <> 'absent'`, scope);
  if (revision !== null) await bumpRevision(db, scope);
  return readRoll(db, scope);
}

export async function bumpRevision(db, scope) {
  const revision = randomUUID();
  await db.query(`UPDATE attendance_rolls SET revision = $4 WHERE ${rollScope}`, [...scope, revision]);
  return revision;
}

export async function setJustification(db, scope, studentId, revision, justified) {
  if (!await lockRoll(db, scope, revision)) return null;
  const result = await db.query(`
    UPDATE attendance_entries SET justified = $5 WHERE ${rollScope} AND student_id = $4 AND status = 'absent'
  `, [...scope, studentId, justified]);
  if (!result.rowCount) return null;
  await db.query(`UPDATE absence_justifications SET status = CASE WHEN $5 THEN 'accepted' ELSE 'pending' END
    WHERE ${rollScope} AND student_id = $4`, [...scope, studentId, justified]);
  return { revision: await bumpRevision(db, scope), justified };
}

export async function classAttendance(db, schoolId, classId, month) {
  const { rows } = await db.query(`
    SELECT s.id, s.display_name AS "displayName", e.day::text, e.status, e.justified, r.revision,
      j.status AS "justificationStatus"
    FROM attendance_entries e JOIN attendance_rolls r USING (school_id, class_id, day)
    JOIN students s ON (s.school_id, s.id) = (e.school_id, e.student_id)
    LEFT JOIN absence_justifications j ON (j.school_id,j.class_id,j.day,j.student_id) = (e.school_id,e.class_id,e.day,e.student_id)
    WHERE (e.school_id, e.class_id) = ($1, $2) AND ${history}
    ORDER BY s.display_name, s.id, e.day DESC
  `, [schoolId, classId, month]);
  const students = new Map();
  for (const { id, displayName, day, status, justified, revision, justificationStatus } of rows) {
    if (!students.has(id)) students.set(id, { id, displayName, absences: 0, unjustified: 0, late: 0, left: 0, entries: [] });
    const student = students.get(id);
    if (status === 'absent') {
      student.absences += 1;
      if (!justified) student.unjustified += 1;
    } else {
      student[status] += 1;
    }
    student.entries.push({ day, status, justified, revision, ...(justificationStatus ? { justificationStatus } : {}) });
  }
  return { students: Array.from(students.values()), alertThreshold };
}

export async function childAttendance(db, schoolId, studentId, month) {
  const { rows } = await db.query(`
    SELECT e.day::text, c.id AS "classId", c.name AS "className", e.status, e.justified, j.status AS "justificationStatus"
    FROM attendance_entries e JOIN classes c ON (c.school_id, c.id) = (e.school_id, e.class_id)
    LEFT JOIN absence_justifications j ON (j.school_id,j.class_id,j.day,j.student_id) = (e.school_id,e.class_id,e.day,e.student_id)
    WHERE (e.school_id, e.student_id) = ($1, $2) AND ${history}
    ORDER BY e.day DESC, e.class_id
  `, [schoolId, studentId, month]);
  return { entries: rows.map(({ justificationStatus, ...entry }) => ({
    ...entry, ...(justificationStatus ? { justificationStatus } : {}),
  })) };
}

export function purgeExpiredAttendance(pool) {
  return pool.query(`DELETE FROM attendance_rolls WHERE day < ${cutoff}`);
}
