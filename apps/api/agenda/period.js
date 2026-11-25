import { uuidPattern } from '../auth/credentials.js';

const instantPattern = /^(?!0000)\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const instant = { type: 'string', minLength: 24, maxLength: 24 };
const maxPeriodMs = 32 * 86_400_000;

export const agendaQuerySchema = {
  type: 'object',
  required: ['from', 'until'],
  additionalProperties: false,
  properties: {
    from: instant, until: instant,
    cursor: { type: 'string', minLength: 61, maxLength: 61 },
  },
};

export function isInstant(value) {
  if (typeof value !== 'string' || !instantPattern.test(value)) return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value;
}

export function agendaPeriod({ from, until, cursor }) {
  if (!isInstant(from) || !isInstant(until) || from >= until
    || Date.parse(until) - Date.parse(from) > maxPeriodMs) return null;
  if (cursor === undefined) return { from, until, afterStartsAt: null, afterId: null };

  const [afterStartsAt, afterId, ...rest] = cursor.split('~');
  if (rest.length || !isInstant(afterStartsAt) || afterStartsAt >= until
    || !afterId || !uuidPattern.test(afterId)) return null;
  return { from, until, afterStartsAt, afterId };
}
