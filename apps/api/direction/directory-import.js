import { createHash } from 'node:crypto';
import { invalid, plain } from '../school-life/validation.js';

const header = ['type', 'reference', 'nom', 'classe', 'eleves'];
const kinds = ['classe', 'eleve', 'responsable'];
const refPattern = /^[A-Za-z0-9_-]{1,64}$/;
const cellPattern = /"(?:[^"]|"")*"|[^;"\r\n]*/y;

function readCsv(input) {
  const csv = input.replace(/^\ufeff/, '').trimEnd();
  const records = [];
  let record = [];
  let position = 0;
  while (position <= csv.length) {
    cellPattern.lastIndex = position;
    const cell = cellPattern.exec(csv)[0];
    record.push(cell.startsWith('"') ? cell.slice(1, -1).replaceAll('""', '"') : cell);
    position += cell.length;
    const delimiter = csv[position];
    position += 1;
    if (delimiter === ';') continue;
    if (delimiter === '\r' && csv[position] === '\n') position += 1;
    else if (delimiter !== '\n' && delimiter !== undefined && delimiter !== '\r') invalid();
    if (record.some((part) => part.trim())) records.push(record);
    if (records.length > 501) invalid(413);
    record = [];
  }
  if (records.length < 2 || records[0].join(';') !== header.join(';')) invalid();
  return records.slice(1);
}

function normalized(value) {
  return value.normalize('NFD').replace(/\p{M}/gu, '').trim().toLocaleLowerCase('fr-FR');
}

export function previewDirectoryImport(csv, current) {
  const rows = readCsv(csv).map((record, index) => {
    if (record.length !== header.length) invalid();
    const [kind, ref, rawName, classRef, childRefs] = record.map((cell) => cell.trim());
    const name = plain(rawName, true).normalize('NFC');
    if (!kinds.includes(kind) || !refPattern.test(ref) || [...name].length > 100 || /[\r\n\t]/.test(name)) invalid();
    const childList = childRefs ? childRefs.split('|').map((value) => value.trim()) : [];
    const row = { kind, ref, name, classRef, childList, line: index + 2 };
    if ((kind === 'eleve') !== Boolean(classRef) || (kind === 'responsable') !== Boolean(childList.length)
      || childList.length > 200 || new Set(childList).size !== childList.length) invalid();
    return row;
  });
  const currentClasses = new Map(current.classes.map((item) => [item.id, item.name]));
  const currentStudents = new Map(current.students.filter((item) => !item.departed && currentClasses.has(item.classId))
    .map((item) => [item.id, item.displayName]));
  const refs = new Map();
  const errors = [];
  const warnings = [];
  for (const row of rows) {
    if (refs.has(row.ref) || currentClasses.has(row.ref) || current.students.some(({ id }) => id === row.ref)
        || current.guardians.some(({ id }) => id === row.ref)) errors.push(`Ligne ${row.line} · Cette référence est déjà utilisée.`);
    refs.set(row.ref, row);
  }
  const nameFor = (reference, kind, known) => known.get(reference) ?? (refs.get(reference)?.kind === kind ? refs.get(reference).name : undefined);
  const roomName = (reference) => nameFor(reference, 'classe', currentClasses);
  const childName = (reference) => nameFor(reference, 'eleve', currentStudents);

  const items = rows.map((row) => {
    const sameName = (name) => normalized(name ?? '') === normalized(row.name);
    const room = roomName(row.classRef);
    const children = row.childList.map(childName);
    const repeated = rows.some((other) => other !== row && other.kind === row.kind && sameName(other.name)
      && (row.kind !== 'eleve' || roomName(other.classRef) === room));
    const existing = row.kind === 'classe' ? current.classes.some(({ name }) => sameName(name))
      : row.kind === 'eleve' ? current.students.some((student) => !student.departed
        && currentClasses.get(student.classId) === room && sameName(student.displayName))
        : current.guardians.some(({ displayName }) => sameName(displayName));
    if (row.kind === 'eleve' && !room) errors.push(`Ligne ${row.line} · Classe introuvable.`);
    if (children.some((name) => !name)) errors.push(`Ligne ${row.line} · Au moins un enfant est introuvable.`);
    if (repeated || existing) {
      const message = `Ligne ${row.line} · ${row.name} apparaît déjà pour ce type de fiche.`;
      (row.kind === 'classe' ? errors : warnings).push(message);
    }
    return { ref: row.ref, kind: row.kind, name: row.name, room: room ?? null, children };
  });
  const tag = createHash('sha256').update(JSON.stringify({ rows, current, errors, warnings })).digest('base64url');
  return { rows, preview: { tag, items, errors, warnings } };
}
