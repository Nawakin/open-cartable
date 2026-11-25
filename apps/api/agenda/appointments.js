import { randomUUID } from 'node:crypto';
import { agendaPageSize, pageEvents } from './events.js';

const teacherAudience = `($3::uuid IS NULL OR (
  e.appointment_teacher_id = $3 AND student.class_id = e.class_id AND guardian.active
))`;

const appointmentContext = `
  JOIN students student ON (student.school_id, student.id) = (e.school_id, e.appointment_student_id)
  JOIN guardians guardian ON (guardian.school_id, guardian.id) = (e.school_id, e.appointment_guardian_id)
`;

export async function listAppointmentStudents(db, schoolId, classId) {
  const { rows } = await db.query(`
    SELECT s.id, s.display_name AS "displayName"
    FROM students s
    WHERE s.school_id = $1 AND s.class_id = $2 AND EXISTS (
      SELECT 1 FROM guardian_students link
      JOIN guardians guardian ON (guardian.school_id, guardian.id) = (link.school_id, link.guardian_id)
      WHERE (link.school_id, link.student_id) = (s.school_id, s.id) AND guardian.active
    )
    ORDER BY s.display_name, s.id
  `, [schoolId, classId]);
  return rows;
}

export async function listAppointments(db, actor, classId, { from, until, afterStartsAt, afterId }) {
  const { rows } = await db.query(`
    SELECT e.id, e.class_id, e.starts_at, e.ends_at, e.title, e.location, e.description,
           true AS private, student.display_name AS student_name, e.appointment_guardian_id AS guardian_reference
    FROM agenda_events e ${appointmentContext}
    WHERE e.school_id = $1 AND e.class_id = $2 AND ${teacherAudience}
      AND e.ends_at > $4 AND e.starts_at < $5
      AND ($6::timestamptz IS NULL OR (e.starts_at, e.id) > ($6, $7::uuid))
    ORDER BY e.starts_at, e.id LIMIT $8
  `, [actor.school_id, classId, actor.teacher_id ?? null, from, until, afterStartsAt, afterId, agendaPageSize + 1]);
  const { events, nextCursor } = pageEvents(rows);
  return {
    events: events.map((event, index) => ({
      ...event, studentName: rows[index].student_name, guardianReference: rows[index].guardian_reference,
    })),
    nextCursor,
  };
}

export async function createAppointment(db, actor, classId, { studentId, guardianReference }, event) {
  const recipient = await db.query(`
    SELECT 1
    FROM guardian_students link
    JOIN students student ON (student.school_id, student.id) = (link.school_id, link.student_id)
    JOIN guardians guardian ON (guardian.school_id, guardian.id) = (link.school_id, link.guardian_id)
    WHERE link.school_id = $1 AND student.class_id = $2 AND link.student_id = $3
      AND link.guardian_id = $4 AND guardian.active
    FOR SHARE OF student, guardian, link
  `, [actor.school_id, classId, studentId, guardianReference]);
  if (!recipient.rowCount) return null;
  const result = await db.query(`
    INSERT INTO agenda_events (school_id, class_id, id, starts_at, ends_at, title, location, description,
      appointment_student_id, appointment_guardian_id, appointment_teacher_id)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    RETURNING id
  `, [actor.school_id, classId, randomUUID(), event.startsAt, event.endsAt, event.title, event.location,
    event.description, studentId, guardianReference, actor.teacher_id ?? null]);
  return result.rows[0].id;
}

const appointedEvent = `e.school_id = $1 AND e.class_id = $2 AND e.id = $4
  AND (student.school_id, student.id) = (e.school_id, e.appointment_student_id)
  AND (guardian.school_id, guardian.id) = (e.school_id, e.appointment_guardian_id)
  AND ${teacherAudience}`;

export async function updateAppointment(db, actor, classId, id, event) {
  const result = await db.query(`
    UPDATE agenda_events e SET starts_at = $5, ends_at = $6, title = $7, location = $8, description = $9
    FROM students student, guardians guardian WHERE ${appointedEvent}
  `, [actor.school_id, classId, actor.teacher_id ?? null, id, event.startsAt, event.endsAt,
    event.title, event.location, event.description]);
  return result.rowCount === 1;
}

export async function deleteAppointment(db, actor, classId, id) {
  const result = await db.query(`
    DELETE FROM agenda_events e USING students student, guardians guardian WHERE ${appointedEvent}
  `, [actor.school_id, classId, actor.teacher_id ?? null, id]);
  return result.rowCount === 1;
}
