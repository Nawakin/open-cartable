import { canTeachClass } from '../teacher/store.js';

export async function linkedChildClass(db, actor, childId) {
  const { rows: [row] } = await db.query(`
    SELECT s.class_id FROM students s JOIN guardian_students l ON (l.school_id, l.student_id) = (s.school_id, s.id)
    WHERE s.school_id = $1 AND l.guardian_id = $2 AND s.id = $3 FOR SHARE OF s, l
  `, [actor.school_id, actor.guardian_id, childId]);
  return row?.class_id;
}

export function forTeacherClass(authenticated, operation, success) {
  return authenticated(async (request, db, actor) => {
    const { classId } = request.params;
    if (!await canTeachClass(db, actor, classId)) return null;
    const current = await db.query('SELECT 1 FROM classes WHERE school_id = $1 AND id = $2 FOR SHARE',
      [actor.school_id, classId]);
    if (!current.rowCount) return null;
    return operation(request, db, actor.school_id, classId);
  }, success);
}
