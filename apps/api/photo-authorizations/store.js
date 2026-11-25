import { randomUUID } from 'node:crypto';

const status = "COALESCE(a.status, 'unrecorded') AS status";
const record = `${status}, a.revision, a.updated_at AS "updatedAt"`;
const authorizations = 'LEFT JOIN student_photo_authorizations a ON (a.school_id, a.student_id) = (s.school_id, s.id)';

export async function listClassAuthorizations(db, schoolId, classId, withRecord = false) {
  const { rows: students } = await db.query(`
    SELECT s.id, s.display_name AS "displayName", ${withRecord ? record : status}
    FROM students s ${authorizations}
    WHERE (s.school_id, s.class_id) = ($1, $2)
    ORDER BY s.display_name, s.id
  `, [schoolId, classId]);
  return { students };
}

export async function listFamilyAuthorizations(db, actor) {
  const { rows: children } = await db.query(`
    SELECT s.id, s.display_name AS "displayName", ${status}
    FROM guardian_students l JOIN students s ON (s.school_id, s.id) = (l.school_id, l.student_id)
    ${authorizations}
    WHERE (l.school_id, l.guardian_id) = ($1, $2)
    ORDER BY s.display_name, s.id
  `, [actor.school_id, actor.guardian_id]);
  return { children };
}

export async function setAuthorization(db, schoolId, classId, studentId, update) {
  const scope = [schoolId, studentId];
  const student = await db.query(`
    SELECT display_name AS "displayName" FROM students
    WHERE (school_id, id, class_id) = ($1, $2, $3) FOR UPDATE
  `, [...scope, classId]);
  if (!student.rowCount) return null;

  const { rows: [existing] } = await db.query(`
    SELECT status, revision, updated_at AS "updatedAt"
    FROM student_photo_authorizations WHERE (school_id, student_id) = ($1, $2)
  `, scope);
  const current = existing ?? { status: 'unrecorded', revision: null, updatedAt: null };
  const child = { id: studentId, displayName: student.rows[0].displayName };
  if (current.status === update.status) return { ...child, ...current };
  if (current.revision !== update.revision) {
    throw Object.assign(new Error('L’autorisation a changé.'), { statusCode: 409 });
  }

  const { rows: [saved] } = await db.query(`
    INSERT INTO student_photo_authorizations (school_id, student_id, status, revision)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (school_id, student_id) DO UPDATE
      SET status = excluded.status, revision = excluded.revision, updated_at = excluded.updated_at
    RETURNING status, revision, updated_at AS "updatedAt"
  `, [...scope, update.status, randomUUID()]);
  return { ...child, ...saved };
}

export async function lockPhotoAuthorizations(db, schoolId, classId, studentIds) {
  if (!studentIds.length) return [];
  // Le registre verrouille aussi l’élève avant son autorisation.
  const { rows: students } = await db.query(`
    SELECT id FROM students
    WHERE (school_id, class_id) = ($1, $2) AND id = ANY($3::uuid[])
    ORDER BY id FOR SHARE
  `, [schoolId, classId, studentIds]);
  if (students.length !== studentIds.length) return null;
  const { rows: allowed } = await db.query(`
    SELECT student_id AS "studentId", revision
    FROM student_photo_authorizations
    WHERE school_id = $1 AND student_id = ANY($2::uuid[]) AND status = 'allowed'
    ORDER BY student_id FOR SHARE
  `, [schoolId, studentIds]);
  return allowed.length === studentIds.length ? allowed : null;
}
