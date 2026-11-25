import { dayInSchoolCalendar, periodRange } from '../parent/homework';

export function agendaRange(anchor, view) {
  const { from, to } = periodRange(anchor, view);
  const next = new Date(to + 'T00:00:00Z');
  next.setUTCDate(next.getUTCDate() + 1);
  const until = next.toISOString().slice(0, 10);
  return {
    from: new Date(from + 'T00:00:00').toISOString(),
    until: new Date(until + 'T00:00:00').toISOString(),
  };
}

export function dateTimeFields(at) {
  const date = new Date(at);
  const time = [date.getHours(), date.getMinutes()].map((part) => String(part).padStart(2, '0')).join(':');
  return { date: dayInSchoolCalendar(date), time };
}

export function localInstant(date, time, original) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null;
  if (original) {
    const previous = dateTimeFields(original);
    if (previous.date === date && previous.time === time) return original;
  }
  const instant = new Date(`${date}T${time}:00`);
  if (!Number.isFinite(instant.getTime())) return null;
  const fields = dateTimeFields(instant);
  return fields.date === date && fields.time === time ? instant.toISOString() : null;
}
