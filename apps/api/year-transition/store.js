import { randomUUID } from 'node:crypto';

export const levels = ['TPS', 'PS', 'MS', 'GS', 'CP', 'CE1', 'CE2', 'CM1', 'CM2'];

const schoolCalendar = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Paris', year: 'numeric', month: 'numeric',
});

function suggestedYear() {
  const parts = new Map(schoolCalendar.formatToParts().map(({ type, value }) => [type, value]));
  return Number(parts.get('year')) - (Number(parts.get('month')) < 9 ? 1 : 0);
}

function problem(statusCode) {
  throw Object.assign(new Error('Préparation de la rentrée non valide.'), { statusCode });
}

async function readSources(db, schoolId) {
  const { rows } = await db.query(`
    SELECT c.id, c.name, COALESCE(json_agg(json_build_object('id', s.id, 'displayName', s.display_name)
        ORDER BY s.display_name, s.id) FILTER (WHERE s.id IS NOT NULL), '[]'::json) AS students
    FROM classes c LEFT JOIN students s ON (c.school_id, c.id) = (s.school_id, s.class_id)
    WHERE c.school_id = $1
    GROUP BY c.school_id, c.id, c.name ORDER BY c.name, c.id
  `, [schoolId]);
  return rows;
}

function rosterMap(sources) {
  return new Map(sources.flatMap(({ id, students }) => students.map((student) => [student.id, id])));
}

function requireUnique(rows, key) {
  if (new Set(rows.map((row) => row[key])).size !== rows.length) problem(400);
}

function reconcile(draft, sources) {
  const validClasses = new Set(sources.map(({ id }) => id));
  const roster = rosterMap(sources);
  const belongs = ({ studentId, sourceClassId }) => roster.get(studentId) === sourceClassId;
  const sourceLevels = draft.sourceLevels.filter(({ classId }) => validClasses.has(classId));
  const overrides = draft.overrides.filter(belongs);
  const byClass = new Map(sourceLevels.map(({ classId, level }) => [classId, level]));
  const byStudent = new Map(overrides.map(({ studentId, level }) => [studentId, level]));
  const targetClasses = new Map(draft.classes.map((entry) => [entry.id, entry]));
  const currentLevel = (studentId, classId) => byStudent.get(studentId) ?? byClass.get(classId) ?? null;
  const assignments = draft.assignments.filter(({ studentId, sourceClassId, sourceLevel, target }) =>
    belongs({ studentId, sourceClassId }) && sourceLevel === currentLevel(studentId, sourceClassId)
    && (target === null || targetClasses.get(target.classId)?.levels.includes(target.level)));
  const confirmed = new Map(assignments.map((entry) => [entry.studentId, entry]));
  const proposals = new Map(levels.map((level) => {
    const matching = draft.classes.filter((entry) => entry.levels.includes(level));
    return [level, matching.length === 1 ? { classId: matching[0].id, level } : null];
  }));
  const classes = sources.map(({ id, name, students }) => ({
    id, name, level: byClass.get(id) ?? null,
    students: students.map((student) => {
      const level = currentLevel(student.id, id);
      const nextLevel = level ? levels[levels.indexOf(level) + 1] : undefined;
      return {
        ...student, level, override: byStudent.get(student.id) ?? null,
        proposal: proposals.get(nextLevel) ?? null, assignment: confirmed.get(student.id) ?? null,
      };
    }),
  }));
  return { plan: { ...draft, sourceLevels, overrides, assignments }, sources: classes };
}

async function readDraft(db, schoolId) {
  const { rows: [row] } = await db.query(`
    SELECT start_year AS "startYear", revision, configuration FROM year_transition_drafts WHERE school_id = $1
  `, [schoolId]);
  if (!row) return null;
  const { configuration, ...plan } = row;
  return { ...plan, ...configuration };
}

export async function readYearTransition(db, schoolId) {
  const draft = await readDraft(db, schoolId);
  const state = draft ? reconcile(draft, await readSources(db, schoolId)) : { plan: null, sources: [] };
  return { ...state, levels, suggestedStartYear: suggestedYear() };
}

export async function saveYearTransition(db, schoolId, input) {
  await db.query('SELECT id FROM schools WHERE id = $1 FOR UPDATE', [schoolId]);
  const current = await readDraft(db, schoolId);
  if ((current?.revision ?? null) !== input.revision) problem(409);
  const sources = await readSources(db, schoolId);
  const sourceClasses = new Set(sources.map(({ id }) => id));
  const roster = rosterMap(sources);
  const previousTargets = new Set(current?.classes.map(({ id }) => id));
  const names = new Set();
  const classes = input.classes.map((entry) => {
    if (entry.id && !previousTargets.has(entry.id)) problem(400);
    const name = entry.name.trim().normalize('NFC');
    const key = name.toLocaleLowerCase('fr-FR');
    if (!name || /[\p{Cc}\u2028\u2029]/u.test(name) || names.has(key)) problem(400);
    names.add(key);
    return { id: entry.id ?? randomUUID(), name, levels: levels.filter((level) => entry.levels.includes(level)) };
  });
  requireUnique(classes, 'id');
  requireUnique(input.sourceLevels, 'classId');
  requireUnique(input.overrides, 'studentId');
  requireUnique(input.assignments, 'studentId');
  if (input.sourceLevels.some(({ classId }) => !sourceClasses.has(classId))) problem(409);
  const placements = [...input.overrides, ...input.assignments];
  if (placements.some(({ studentId, sourceClassId }) => roster.get(studentId) !== sourceClassId)) problem(409);
  const revision = randomUUID();
  const { plan, sources: prepared } = reconcile({ ...input, classes, revision }, sources);
  const { startYear, revision: next, ...configuration } = plan;
  await db.query(`
    INSERT INTO year_transition_drafts (school_id, start_year, revision, configuration) VALUES ($1, $2, $3, $4)
    ON CONFLICT (school_id) DO UPDATE SET start_year = excluded.start_year, revision = excluded.revision,
      configuration = excluded.configuration
  `, [schoolId, startYear, next, configuration]);
  return { plan, sources: prepared, levels, suggestedStartYear: suggestedYear() };
}
