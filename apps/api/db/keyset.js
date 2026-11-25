import { isInstant } from '../agenda/period.js';
import { uuidPattern } from '../auth/credentials.js';

export const timestampCursor = { type: 'string', minLength: 61, maxLength: 61 };

export function requireTimestampCursor(cursor) {
  if (cursor === undefined) return { beforeAt: null, beforeId: null };
  const [beforeAt, beforeId, ...rest] = cursor.split('~');
  if (rest.length || !isInstant(beforeAt) || !beforeId || !uuidPattern.test(beforeId)) {
    throw Object.assign(new Error('Page non valide.'), { statusCode: 400 });
  }
  return { beforeAt, beforeId };
}

export function pageByTimestamp(rows, size, field) {
  const items = rows.slice(0, size);
  const last = items.at(-1);
  return { items, nextCursor: rows.length > size ? `${new Date(last[field]).toISOString()}~${last.id}` : null };
}
