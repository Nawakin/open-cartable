import { randomUUID } from 'node:crypto';
import { isInstant } from './period.js';

export const agendaPageSize = 30;

export function readEvent(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).length !== 5 || !isInstant(input.startsAt) || !isInstant(input.endsAt)
    || !input.startsAt.endsWith('.000Z') || !input.endsAt.endsWith('.000Z') || input.startsAt >= input.endsAt) return null;

  const event = { startsAt: input.startsAt, endsAt: input.endsAt };
  for (const [key, max] of [['title', 120], ['location', 160], ['description', 2500]]) {
    if (typeof input[key] !== 'string') return null;
    const value = input[key].trim();
    if ([...value].length > max || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)) return null;
    event[key] = value;
  }
  return event.title ? event : null;
}

export function eventDetails(event) {
  return {
    id: event.id,
    startsAt: new Date(event.starts_at).toISOString(),
    endsAt: new Date(event.ends_at).toISOString(),
    title: event.title,
    location: event.location,
    description: event.description,
    scope: event.private ? 'private' : (event.class_id === null ? 'school' : 'class'),
  };
}

export function pageEvents(rows) {
  const events = rows.slice(0, agendaPageSize).map(eventDetails);
  const last = events.at(-1);
  return { events, nextCursor: rows.length > agendaPageSize ? `${last.startsAt}~${last.id}` : null };
}

export async function listStaffEvents(db, schoolId, classId, { from, until, afterStartsAt, afterId }) {
  const { rows } = await db.query(`
    SELECT id, class_id, starts_at, ends_at, title, location, description
    FROM agenda_events
    WHERE school_id = $1 AND class_id IS NOT DISTINCT FROM $2::uuid
      AND appointment_student_id IS NULL
      AND ends_at > $3 AND starts_at < $4
      AND ($5::timestamptz IS NULL OR (starts_at, id) > ($5, $6::uuid))
    ORDER BY starts_at, id
    LIMIT $7
  `, [schoolId, classId, from, until, afterStartsAt, afterId, agendaPageSize + 1]);
  return pageEvents(rows);
}

export async function createEvent(db, schoolId, classId, event) {
  const result = await db.query(`
    INSERT INTO agenda_events (school_id, class_id, id, starts_at, ends_at, title, location, description)
    SELECT $1, $2, $3, $4, $5, $6, $7, $8
    WHERE $2::uuid IS NULL OR EXISTS (SELECT 1 FROM classes WHERE school_id = $1 AND id = $2)
    RETURNING id
  `, [schoolId, classId, randomUUID(), event.startsAt, event.endsAt, event.title, event.location, event.description]);
  return result.rows[0]?.id ?? null;
}

export async function updateEvent(db, schoolId, classId, id, event) {
  const result = await db.query(`
    UPDATE agenda_events SET starts_at = $4, ends_at = $5, title = $6, location = $7, description = $8
    WHERE school_id = $1 AND class_id IS NOT DISTINCT FROM $2::uuid AND id = $3 AND appointment_student_id IS NULL
  `, [schoolId, classId, id, event.startsAt, event.endsAt, event.title, event.location, event.description]);
  return result.rowCount === 1;
}

export async function deleteEvent(db, schoolId, classId, id) {
  const result = await db.query(`
    DELETE FROM agenda_events
    WHERE school_id = $1 AND class_id IS NOT DISTINCT FROM $2::uuid AND id = $3 AND appointment_student_id IS NULL
  `, [schoolId, classId, id]);
  return result.rowCount === 1;
}
