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
    SELECT c.id, c.name, CASE WHEN cardinality(c.levels) = 1 THEN c.levels[1] END AS "defaultLevel",
      COALESCE(json_agg(json_build_object('id', s.id, 'displayName', s.display_name, 'grade', s.grade)
        ORDER BY s.display_name, s.id) FILTER (WHERE s.id IS NOT NULL), '[]'::json) AS students
    FROM classes c LEFT JOIN students s ON (c.school_id, c.id) = (s.school_id, s.class_id) AND s.left_at IS NULL
    WHERE c.school_id = $1 AND c.archived_year IS NULL
    GROUP BY c.school_id, c.id ORDER BY c.name, c.id
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
  const byClass = new Map(sources.map(({ id, defaultLevel }) => [id, defaultLevel]));
  for (const { classId, level } of sourceLevels) byClass.set(classId, level);
  const byStudent = new Map(overrides.map(({ studentId, level }) => [studentId, level]));
  const grades = new Map(sources.flatMap(({ students }) => students.map(({ id, grade }) => [id, grade])));
  const targetClasses = new Map(draft.classes.map((entry) => [entry.id, entry]));
  const currentLevel = (studentId, classId) => byStudent.get(studentId) ?? grades.get(studentId) ?? byClass.get(classId) ?? null;
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
  const teacherAssignments = (draft.teacherAssignments ?? []).filter(({ classId }) => targetClasses.has(classId));
  return { plan: { ...draft, sourceLevels, overrides, assignments, teacherAssignments }, sources: classes };
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
  const { rows: [school] } = await db.query('SELECT school_year AS "activeStartYear" FROM schools WHERE id = $1', [schoolId]);
  const draft = await readDraft(db, schoolId);
  const state = draft ? reconcile(draft, await readSources(db, schoolId)) : { plan: null, sources: [] };
  const teachers = await listAvailableTeachers(db, schoolId);
  return {
    ...state, teachers, levels,
    activeStartYear: school.activeStartYear, suggestedStartYear: school.activeStartYear ?? suggestedYear(),
    summary: draft ? summarize(state, teachers) : null,
  };
}

export async function saveYearTransition(db, schoolId, input) {
  const { rows: [school] } = await db.query('SELECT school_year FROM schools WHERE id = $1 FOR UPDATE', [schoolId]);
  if (school.school_year && school.school_year !== input.startYear) problem(400);
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
  const teacherAssignments = input.teacherAssignments ?? current?.teacherAssignments ?? [];
  const teachers = await listAvailableTeachers(db, schoolId);
  const teacherIds = new Set(teachers.map(({ id }) => id));
  requireUnique(teacherAssignments.map(({ teacherId, classId }) => ({ key: teacherId + '/' + classId })), 'key');
  if (teacherAssignments.some(({ teacherId }) => !teacherIds.has(teacherId))) problem(409);
  const { plan } = reconcile({ ...input, classes, revision, teacherAssignments }, sources);
  const { startYear, revision: next, ...configuration } = plan;
  await db.query(`
    INSERT INTO year_transition_drafts (school_id, start_year, revision, configuration) VALUES ($1, $2, $3, $4)
    ON CONFLICT (school_id) DO UPDATE SET start_year = excluded.start_year, revision = excluded.revision,
      configuration = excluded.configuration
  `, [schoolId, startYear, next, configuration]);
  return readYearTransition(db, schoolId);
}

async function listAvailableTeachers(db, schoolId) {
  const { rows } = await db.query(`
    SELECT t.id, t.login, t.password_hash IS NOT NULL AS active,
      ARRAY(SELECT class_id FROM teacher_classes c WHERE (c.school_id, c.teacher_id) = (t.school_id, t.id)
        ORDER BY class_id) AS "classIds"
    FROM teacher_accounts t WHERE t.school_id = $1 ORDER BY t.login, t.id
  `, [schoolId]);
  return rows;
}

function summarize({ plan, sources }, teachers) {
  const students = sources.flatMap(({ students }) => students);
  const teacherIds = new Set(teachers.map(({ id }) => id));
  const unavailable = plan.teacherAssignments.filter(({ teacherId }) => !teacherIds.has(teacherId)).length;
  const pending = students.length - plan.assignments.length;
  return {
    pending, unavailable, total: students.length,
    departed: plan.assignments.filter(({ target }) => !target).length,
    moved: plan.assignments.filter(({ target }) => target).length,
    ready: Boolean(plan.classes.length && !pending && !unavailable),
  };
}

export async function applyYearTransition(db, schoolId, { revision, confirmation }) {
  const { rows: [school] } = await db.query('SELECT school_year FROM schools WHERE id = $1 FOR UPDATE', [schoolId]);
  const previous = await db.query(`
    SELECT 1 FROM school_year_changes WHERE (school_id, revision, source_year) = ($1, $2, $3)
  `, [schoolId, revision, confirmation - 1]);
  if (previous.rowCount) return readYearTransition(db, schoolId);
  const draft = await readDraft(db, schoolId);
  if (!draft || draft.revision !== revision || (school.school_year && school.school_year !== draft.startYear)) problem(409);
  if (confirmation !== draft.startYear + 1) problem(400);

  // Le même ordre de verrouillage que les affectations et les publications enseignantes.
  await db.query('SELECT id FROM teacher_accounts WHERE school_id = $1 ORDER BY id FOR UPDATE', [schoolId]);
  await db.query('SELECT id FROM classes WHERE school_id = $1 AND archived_year IS NULL ORDER BY id FOR UPDATE', [schoolId]);
  await db.query('SELECT id FROM students WHERE school_id = $1 AND left_at IS NULL ORDER BY id FOR UPDATE', [schoolId]);
  const state = reconcile(draft, await readSources(db, schoolId));
  const { plan } = state;
  const summary = summarize(state, await listAvailableTeachers(db, schoolId));
  if (!summary.ready) problem(409);

  await db.query('UPDATE classes SET archived_year = $2 WHERE school_id = $1 AND archived_year IS NULL', [schoolId, plan.startYear]);
  await db.query(`
    INSERT INTO classes (school_id, id, name, levels)
    SELECT $1, c.id, c.name, c.levels FROM jsonb_to_recordset($2::jsonb) AS c(id uuid, name text, levels text[])
  `, [schoolId, JSON.stringify(plan.classes)]);
  const placed = plan.assignments.map(({ studentId, target }) => ({
    student_id: studentId, class_id: target?.classId ?? null, grade: target?.level ?? null,
  }));
  await db.query(`
    UPDATE students s SET class_id = COALESCE(c.class_id, s.class_id), grade = COALESCE(c.grade, s.grade),
      left_at = CASE WHEN c.class_id IS NULL THEN transaction_timestamp() ELSE NULL END
    FROM jsonb_to_recordset($2::jsonb) AS c(student_id uuid, class_id uuid, grade text)
    WHERE (s.school_id, s.id) = ($1, c.student_id)
  `, [schoolId, JSON.stringify(placed)]);
  await db.query('DELETE FROM teacher_classes WHERE school_id = $1', [schoolId]);
  await db.query(`
    INSERT INTO teacher_classes (school_id, teacher_id, class_id)
    SELECT $1, t."teacherId", t."classId"
    FROM jsonb_to_recordset($2::jsonb) AS t("teacherId" uuid, "classId" uuid)
  `, [schoolId, JSON.stringify(plan.teacherAssignments)]);
  await db.query('UPDATE schools SET school_year = $2 WHERE id = $1', [schoolId, confirmation]);
  await db.query(`
    INSERT INTO school_year_changes (school_id, source_year, revision, moved, departed) VALUES ($1, $2, $3, $4, $5)
  `, [schoolId, plan.startYear, revision, summary.moved, summary.departed]);
  await db.query('DELETE FROM year_transition_drafts WHERE school_id = $1', [schoolId]);
  return readYearTransition(db, schoolId);
}
