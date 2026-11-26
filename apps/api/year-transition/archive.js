import { hasPublicPhoto } from '../blog/photos.js';
import { hasPublicVideo, videoCount } from '../files/class-media.js';

export async function archivedClasses(db, schoolId) {
  const { rows } = await db.query(`
    SELECT id, name, archived_year AS year FROM classes WHERE school_id = $1 AND archived_year IS NOT NULL
    ORDER BY archived_year DESC, name, id
  `, [schoolId]);
  return rows;
}

const collections = {
  homework: {
    fields: 'a.id, a.title, a.description AS body, a.entry_date::text AS date, (a.attachment_kind IS NOT NULL) AS "hasDocument"',
    table: 'homework_entries', order: 'a.entry_date',
  },
  liaison: {
    fields: "a.id, 'Mot du cahier de liaison' AS title, a.body, a.note_day::text AS date",
    table: 'liaison_notes', order: 'a.note_day',
    visible: "AND a.published_at > statement_timestamp() - interval '1 year'",
  },
  agenda: {
    fields: "a.id, a.title, a.description AS body, to_char(a.starts_at AT TIME ZONE 'Europe/Paris', 'YYYY-MM-DD') AS date",
    table: 'agenda_events', order: 'a.starts_at', visible: 'AND a.appointment_student_id IS NULL',
  },
  blog: {
    fields: `a.id, a.title, a.body, to_char(a.published_at AT TIME ZONE 'Europe/Paris', 'YYYY-MM-DD') AS date, ${videoCount('a')}`,
    table: 'class_blog_articles', order: 'a.published_at',
    visible: `AND a.published_at IS NOT NULL AND (a.body <> '' OR ${hasPublicPhoto('a', true)} OR ${hasPublicVideo('a')})`,
  },
};

export async function archiveEntries(db, schoolId, classId, kind, offset) {
  const { rows: [classroom] } = await db.query(`
    SELECT id, name, archived_year AS year FROM classes WHERE (school_id, id) = ($1, $2) AND archived_year IS NOT NULL
  `, [schoolId, classId]);
  if (!classroom) return null;
  const { fields, table, order, visible = '' } = collections[kind];
  const { rows } = await db.query(`
    SELECT ${fields} FROM ${table} a WHERE (a.school_id, a.class_id) = ($1, $2) ${visible}
    ORDER BY ${order} DESC, a.id DESC LIMIT 31 OFFSET $3
  `, [schoolId, classId, offset]);
  return { classroom, entries: rows.slice(0, 30), nextOffset: rows.length > 30 ? offset + 30 : null };
}
