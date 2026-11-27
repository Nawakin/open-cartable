import { randomUUID } from 'node:crypto';
import { isSchoolDate } from './period.js';

export const homeworkPageSize = 30;

export function homeworkPage(entries) {
  entries = entries.map(({ hasDocument, kind, ...entry }) => ({
    ...entry, ...(hasDocument ? { hasDocument: true } : {}), ...(kind === 'assignment' ? { kind } : {}),
  }));
  if (entries.length <= homeworkPageSize) return { entries, nextCursor: null };
  const page = entries.slice(0, homeworkPageSize);
  const last = page.at(-1);
  return { entries: page, nextCursor: `${last.date}~${last.id}` };
}

export async function listClassEntries(db, schoolId, classId, { from, to, domain, beforeDate, beforeId, kind }) {
  const { rows } = await db.query(`
    SELECT listing.id, to_char(listing.entry_date, 'YYYY-MM-DD') AS date,
           listing.title, listing.domain, listing.description, listing."hasDocument", listing.kind
    FROM classes c
    LEFT JOIN LATERAL (
      SELECT e.id, e.entry_date, e.title, e.domain, e.description, e.kind, e.attachment_kind IS NOT NULL AS "hasDocument"
      FROM homework_entries e
      WHERE (e.school_id, e.class_id) = (c.school_id, c.id)
        AND e.entry_date BETWEEN $3 AND $4
        AND ($5::text IS NULL OR strpos(lower(e.domain), lower($5)) > 0)
        AND ($6::date IS NULL OR (e.entry_date, e.id) < ($6, $7::uuid))
        AND ($9::text IS NULL OR e.kind = $9)
      ORDER BY e.entry_date DESC, e.id DESC
      LIMIT $8
    ) listing ON true
    WHERE c.school_id = $1 AND c.id = $2
    ORDER BY listing.entry_date DESC, listing.id DESC
  `, [schoolId, classId, from, to, domain, beforeDate, beforeId, homeworkPageSize + 1, kind]);
  return rows.length ? homeworkPage(rows.filter(({ id }) => id !== null)) : null;
}

export function readEntry(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)
      || Object.keys(input).some((key) => !['date', 'title', 'domain', 'description', 'kind'].includes(key))
      || (input.kind !== undefined && !['notebook', 'assignment'].includes(input.kind))
      || !isSchoolDate(input.date)) return null;

  const entry = { date: input.date };
  if (input.kind !== undefined) entry.kind = input.kind;
  for (const [key, maximum] of [['title', 120], ['domain', 80], ['description', 2500]]) {
    const value = typeof input[key] === 'string' ? input[key].trim() : '';
    if (!value || value.includes('\0') || [...value].length > maximum) return null;
    entry[key] = value;
  }
  return entry;
}

export async function createEntry(pool, schoolCode, classId, { date, title, domain, description, kind = 'notebook' }) {
  const id = randomUUID();
  const result = await pool.query(`
    INSERT INTO homework_entries (school_id, class_id, id, entry_date, title, domain, description, kind)
    SELECT c.school_id, c.id, $3, $4, $5, $6, $7, $8
    FROM classes c JOIN schools s ON s.id = c.school_id
    WHERE s.code = $1 AND c.id = $2 AND c.archived_year IS NULL
    RETURNING id
  `, [schoolCode, classId, id, date, title, domain, description, kind]);
  return result.rows[0]?.id ?? null;
}

export async function updateEntry(pool, schoolCode, classId, id, { date, title, domain, description, kind }) {
  const result = await pool.query(`
    UPDATE homework_entries e SET entry_date = $4, title = $5, domain = $6, description = $7, kind = COALESCE($8,e.kind)
    FROM classes c JOIN schools s ON s.id = c.school_id
    WHERE s.code = $1 AND (e.school_id, e.class_id) = (c.school_id, c.id)
      AND c.id = $2 AND e.id = $3 AND c.archived_year IS NULL
  `, [schoolCode, classId, id, date, title, domain, description, kind]);
  return result.rowCount === 1;
}

export async function deleteEntry(pool, schoolCode, classId, id) {
  const result = await pool.query(`
    DELETE FROM homework_entries e USING classes c JOIN schools s ON s.id = c.school_id
    WHERE s.code = $1 AND (e.school_id, e.class_id) = (c.school_id, c.id)
      AND c.id = $2 AND e.id = $3 AND c.archived_year IS NULL
  `, [schoolCode, classId, id]);
  return result.rowCount === 1;
}
