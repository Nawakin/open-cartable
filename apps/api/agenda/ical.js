function text(value) {
  return value.replaceAll('\\', '\\\\').replace(/\r\n|[\r\n]/g, '\\n')
    .replaceAll(',', '\\,').replaceAll(';', '\\;');
}

function stamp(value) {
  return new Date(value).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function fold(line) {
  let bytes = 0;
  let result = '';
  for (const character of line) {
    const length = Buffer.byteLength(character);
    if (bytes + length > 75) {
      result += '\r\n ';
      bytes = 1;
    }
    result += character;
    bytes += length;
  }
  return result;
}

export function eventCalendar(event, now = new Date()) {
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Open Cartable//Agenda//FR', 'BEGIN:VEVENT',
    'UID:' + event.id + '@open-cartable',
    'DTSTAMP:' + stamp(now), 'DTSTART:' + stamp(event.startsAt), 'DTEND:' + stamp(event.endsAt),
    ...(event.scope === 'private' ? ['CLASS:PRIVATE'] : []),
    'SUMMARY:' + text(event.title),
    ...(event.location ? ['LOCATION:' + text(event.location)] : []),
    ...(event.description ? ['DESCRIPTION:' + text(event.description)] : []),
    'END:VEVENT', 'END:VCALENDAR', '',
  ].map(fold).join('\r\n');
}
