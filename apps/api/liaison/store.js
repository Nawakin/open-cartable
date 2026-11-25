import { randomUUID } from 'node:crypto';

const retainedSince = "statement_timestamp() - interval '1 year'";
const currentDay = "(statement_timestamp() AT TIME ZONE 'Europe/Paris')::date";
const notesPageSize = 20;
const repliesPageSize = 25;
const noteFields = 'n.id, to_char(n.note_day, \'YYYY-MM-DD\') AS day, n.body';

function packPage(rows, size, cursorField) {
  const items = rows.slice(0, size);
  return { items, nextCursor: rows.length > size ? items.at(-1)[cursorField] : null };
}

async function childClass(db, actor, childId) {
  const { rows: [row] } = await db.query(`
    SELECT s.class_id FROM students s JOIN guardian_students l ON (l.school_id, l.student_id) = (s.school_id, s.id)
    WHERE s.school_id = $1 AND l.guardian_id = $2 AND s.id = $3 FOR SHARE OF s, l
  `, [actor.school_id, actor.guardian_id, childId]);
  return row?.class_id;
}

export async function listFamilyNotes(db, actor, childId, before) {
  const classId = await childClass(db, actor, childId);
  if (!classId) return null;
  const { rows } = await db.query(`
    SELECT ${noteFields},
      CASE WHEN r.id IS NOT NULL THEN json_build_object('body', r.body) END AS reply
    FROM liaison_notes n
    LEFT JOIN liaison_replies r ON (r.school_id, r.note_id, r.guardian_id, r.student_id) = (n.school_id, n.id, $4, $5)
    WHERE n.school_id = $1 AND n.class_id = $2 AND n.published_at > ${retainedSince}
      AND ($3::date IS NULL OR n.note_day < $3)
    ORDER BY n.note_day DESC LIMIT $6
  `, [actor.school_id, classId, before, actor.guardian_id, childId, notesPageSize + 1]);
  const { items, nextCursor } = packPage(rows, notesPageSize, 'day');
  return { notes: items, nextCursor };
}

export async function saveFamilyReply(db, actor, childId, noteId, body) {
  const classId = await childClass(db, actor, childId);
  if (!classId) return null;
  const { rows: [reply] } = await db.query(`
    INSERT INTO liaison_replies (school_id, id, note_id, guardian_id, student_id, body)
    SELECT n.school_id, $4, n.id, $5, $6, $7
    FROM liaison_notes n
    WHERE n.school_id = $1 AND n.class_id = $2 AND n.id = $3 AND n.published_at > ${retainedSince}
    FOR KEY SHARE OF n
    ON CONFLICT (school_id, note_id, guardian_id, student_id) DO UPDATE
    SET body = excluded.body
    RETURNING body
  `, [actor.school_id, classId, noteId, randomUUID(), actor.guardian_id, childId, body]);
  return reply ?? null;
}

export async function listClassNotes(db, schoolId, classId, before) {
  const { rows: [{ today, notes }] } = await db.query(`
    SELECT to_char(${currentDay}, 'YYYY-MM-DD') AS today, (
      SELECT COALESCE(json_agg(page ORDER BY day DESC), '[]'::json) FROM (
        SELECT ${noteFields} FROM liaison_notes n
        WHERE n.school_id = $1 AND n.class_id = $2 AND n.published_at > ${retainedSince}
          AND ($3::date IS NULL OR n.note_day < $3)
        ORDER BY n.note_day DESC LIMIT $4
      ) page
    ) AS notes
  `, [schoolId, classId, before, notesPageSize + 1]);
  const { items, nextCursor } = packPage(notes, notesPageSize, 'day');
  return { today, notes: items, nextCursor };
}

export async function saveDailyNote(db, schoolId, classId, day, body) {
  const { rows: [note] } = await db.query(`
    INSERT INTO liaison_notes AS n (school_id, class_id, id, note_day, body)
    SELECT $1, $2, $3, $4, $5 WHERE $4::date = ${currentDay}
    ON CONFLICT (school_id, class_id, note_day) DO UPDATE SET body = excluded.body
    RETURNING ${noteFields}
  `, [schoolId, classId, randomUUID(), day, body]);
  return note;
}

export async function listNoteReplies(db, schoolId, classId, noteId, after) {
  const { rows: [result] } = await db.query(`
    SELECT COALESCE((
      SELECT json_agg(page ORDER BY id) FROM (
        SELECT r.id, r.body, r.guardian_id AS "guardianReference", s.id AS "childId", s.display_name AS "studentName"
        FROM liaison_replies r
        JOIN guardians g ON (g.school_id, g.id) = (r.school_id, r.guardian_id)
        JOIN students s ON (s.school_id, s.id) = (r.school_id, r.student_id)
        WHERE (r.school_id, r.note_id) = (n.school_id, n.id) AND s.class_id = n.class_id AND g.active
          AND ($4::uuid IS NULL OR r.id > $4)
        ORDER BY r.id LIMIT $5
      ) page
    ), '[]'::json) AS replies
    FROM liaison_notes n
    WHERE n.school_id = $1 AND n.class_id = $2 AND n.id = $3 AND n.published_at > ${retainedSince}
  `, [schoolId, classId, noteId, after, repliesPageSize + 1]);
  if (!result) return null;
  const { items, nextCursor } = packPage(result.replies, repliesPageSize, 'id');
  return { replies: items, nextCursor };
}

export function purgeExpiredLiaison(pool) {
  return pool.query(`DELETE FROM liaison_notes WHERE published_at <= ${retainedSince}`);
}
