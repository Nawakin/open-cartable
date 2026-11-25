import { randomUUID } from 'node:crypto';
import { isSchoolDate } from './period.js';

export function readEntry(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)
      || Object.keys(input).length !== 4 || !isSchoolDate(input.date)) return null;

  const entry = { date: input.date };
  for (const [key, maximum] of [['title', 120], ['domain', 80], ['description', 2500]]) {
    const value = typeof input[key] === 'string' ? input[key].trim() : '';
    if (!value || value.includes('\0') || [...value].length > maximum) return null;
    entry[key] = value;
  }
  return entry;
}

export async function createEntry(pool, schoolCode, classId, { date, title, domain, description }) {
  const id = randomUUID();
  const result = await pool.query(`
    INSERT INTO homework_entries (school_id, class_id, id, entry_date, title, domain, description)
    SELECT c.school_id, c.id, $3, $4, $5, $6, $7
    FROM classes c JOIN schools s ON s.id = c.school_id
    WHERE s.code = $1 AND c.id = $2
    RETURNING id
  `, [schoolCode, classId, id, date, title, domain, description]);
  return result.rows[0]?.id ?? null;
}

export async function updateEntry(pool, schoolCode, classId, id, { date, title, domain, description }) {
  const result = await pool.query(`
    UPDATE homework_entries e SET entry_date = $4, title = $5, domain = $6, description = $7
    FROM schools s
    WHERE s.code = $1 AND e.school_id = s.id AND e.class_id = $2 AND e.id = $3
  `, [schoolCode, classId, id, date, title, domain, description]);
  return result.rowCount === 1;
}

export async function deleteEntry(pool, schoolCode, classId, id) {
  const result = await pool.query(`
    DELETE FROM homework_entries e USING schools s
    WHERE s.code = $1 AND e.school_id = s.id AND e.class_id = $2 AND e.id = $3
  `, [schoolCode, classId, id]);
  return result.rowCount === 1;
}
