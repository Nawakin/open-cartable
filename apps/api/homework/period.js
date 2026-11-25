import { uuidPattern } from '../auth/credentials.js';

const datePattern = /^(?!0000)\d{4}-\d{2}-\d{2}$/;
const dayMilliseconds = 86_400_000;

export const homeworkQuerySchema = {
  type: 'object',
  required: ['from', 'to'],
  additionalProperties: false,
  properties: {
    from: { type: 'string', minLength: 10, maxLength: 10 },
    to: { type: 'string', minLength: 10, maxLength: 10 },
    domain: { type: 'string', maxLength: 80 },
    cursor: { type: 'string', minLength: 47, maxLength: 47 },
  },
};

export function isSchoolDate(date) {
  if (typeof date !== 'string' || !datePattern.test(date)) return false;
  const instant = new Date(date + 'T00:00:00Z');
  return Number.isFinite(instant.getTime()) && instant.toISOString().slice(0, 10) === date;
}

export function readPeriod({ from, to, domain, cursor }) {
  if (!isSchoolDate(from) || !isSchoolDate(to) || from > to
      || Date.parse(to) - Date.parse(from) >= 31 * dayMilliseconds) return null;

  let beforeDate = null;
  let beforeId = null;
  if (cursor !== undefined) {
    const [date, id, ...rest] = cursor.split('~');
    if (rest.length || !isSchoolDate(date) || date < from || date > to || !id || !uuidPattern.test(id)) return null;
    beforeDate = date;
    beforeId = id;
  }

  const filter = domain?.trim() || null;
  if (filter?.includes('\0')) return null;
  return { from, to, domain: filter, beforeDate, beforeId };
}
