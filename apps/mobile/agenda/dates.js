import { periodRange } from '../parent/homework';
import { schoolDateTime, schoolInstant } from '../school-life/ui';

export function agendaRange(anchor, view) {
  const { from, to } = periodRange(anchor, view);
  const next = new Date(to + 'T00:00:00Z');
  next.setUTCDate(next.getUTCDate() + 1);
  return { from: schoolInstant(from + ' 00:00'), until: schoolInstant(next.toISOString().slice(0, 10) + ' 00:00') };
}

export function dateTimeFields(at) {
  const [date, time] = schoolDateTime(at).split(' ');
  return { date, time };
}

export function localInstant(date, time, original) {
  if (original) {
    const previous = dateTimeFields(original);
    if (previous.date === date && previous.time === time) return original;
  }
  return schoolInstant(date + ' ' + time);
}
