import { canTeachClass } from '../teacher/store.js';

export async function linkedChildClass(db, actor, childId, { historical = false } = {}) {
  const { rows: [row] } = await db.query(`
    SELECT s.class_id FROM students s JOIN guardian_students l ON (l.school_id, l.student_id) = (s.school_id, s.id)
    JOIN classes c ON (c.school_id, c.id) = (s.school_id, s.class_id)
    WHERE s.school_id = $1 AND l.guardian_id = $2 AND s.id = $3
      AND ($4::boolean OR (s.left_at IS NULL AND c.archived_year IS NULL)) FOR SHARE OF s, l
  `, [actor.school_id, actor.guardian_id, childId, historical]);
  return row?.class_id;
}

export async function lockActiveClass(db, schoolId, classId) {
  const current = await db.query(`
    SELECT 1 FROM classes WHERE (school_id, id) = ($1, $2) AND archived_year IS NULL FOR SHARE
  `, [schoolId, classId]);
  return current.rowCount === 1;
}

export function forTeacherClass(authenticated, operation, success) {
  return authenticated(async (request, db, actor, reply) => {
    const { classId } = request.params;
    if (!await canTeachClass(db, actor, classId)) return null;
    if (!await lockActiveClass(db, actor.school_id, classId)) return null;
    return operation(request, db, actor.school_id, classId, reply);
  }, success);
}
