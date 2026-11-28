import { linkedChildClass } from '../auth/class-access.js';
import { uuidParams } from '../auth/staff-web.js';
import { isSchoolDate } from '../homework/period.js';
import { dayField, invalid, plain, schoolDaySql, shape, text } from './validation.js';

const parentPath = '/parent/children/:childId/planned-absences';
const byChild = uuidParams('childId');
const body = shape({ day: dayField, reason: text(300) });
const today = schoolDaySql;

export function registerParentPlannedAbsences(app, { authenticated, writes }) {
  app.get(parentPath, { schema: { params: byChild } }, authenticated(async ({ params }, db, actor) => {
    if (!await linkedChildClass(db, actor, params.childId)) return null;
    const { rows } = await db.query(`
      SELECT day::text AS day,reason FROM planned_absences
      WHERE (school_id,guardian_id,student_id)=($1,$2,$3) AND day >= ${today}
      ORDER BY day
    `, [actor.school_id, actor.guardian_id, params.childId]);
    return { absences: rows };
  }));
  app.put(parentPath, { ...writes, schema: { params: byChild, body } }, authenticated(async (request, db, actor) => {
    const { day, reason } = request.body;
    if (!isSchoolDate(day)) invalid();
    if (!await linkedChildClass(db, actor, request.params.childId)) return null;
    const result = await db.query(`
      INSERT INTO planned_absences (school_id,guardian_id,student_id,day,reason)
      SELECT $1,$2,$3,$4,$5 WHERE $4::date BETWEEN ${today} AND ${today} + 90
      ON CONFLICT (school_id,guardian_id,student_id,day) DO UPDATE SET reason=excluded.reason
    `, [actor.school_id, actor.guardian_id, request.params.childId, day, plain(reason)]);
    if (!result.rowCount) invalid(422);
  }, 204));
  app.delete(parentPath + '/:day', { ...writes, schema: { params: shape({ ...byChild.properties, day: dayField }) } },
    authenticated(async ({ params }, db, actor) => {
      if (!isSchoolDate(params.day)) invalid();
      if (!await linkedChildClass(db, actor, params.childId)) return null;
      await db.query(`
        DELETE FROM planned_absences WHERE (school_id,guardian_id,student_id,day)=($1,$2,$3,$4) AND day >= ${today}
      `, [actor.school_id, actor.guardian_id, params.childId, params.day]);
    }, 204));
}

export function registerStaffPlannedAbsences(app, prefix, authenticated) {
  app.get(prefix + '/planned-absences', authenticated(async (_request, db, actor) => {
    const { rows } = await db.query(`
      SELECT p.day::text AS day,p.reason,s.id AS "childId",s.display_name AS "studentName",c.name AS "className",
        g.id AS "guardianId",g.display_name AS "guardianName"
      FROM planned_absences p
      JOIN students s ON (s.school_id,s.id)=(p.school_id,p.student_id) AND s.left_at IS NULL
      JOIN classes c ON (c.school_id,c.id)=(s.school_id,s.class_id) AND c.archived_year IS NULL
      JOIN guardians g ON (g.school_id,g.id)=(p.school_id,p.guardian_id) AND g.active
      WHERE p.school_id=$1 AND p.day>=${today} AND (
        $2::uuid IS NULL OR EXISTS (SELECT 1 FROM teacher_classes t
          WHERE (t.school_id,t.teacher_id,t.class_id)=(c.school_id,$2,c.id))
      )
      ORDER BY p.day,s.display_name,s.id,g.id
    `, [actor.school_id, actor.teacher_id ?? null]);
    return { absences: rows };
  }));
}
