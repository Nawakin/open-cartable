import { randomUUID } from 'node:crypto';
import { linkedChildClass, lockActiveClass, forTeacherClass } from '../auth/class-access.js';
import { uuidPattern } from '../auth/credentials.js';
import { uuidParams } from '../auth/staff-web.js';
import { writeSchoolPdf } from '../blog/export-pdf.js';

export const subjects = {
  french: 'Français', math: 'Mathématiques', languages: 'Langues vivantes',
  science: 'Sciences et technologie', arts: 'Enseignements artistiques',
  pe: 'Éducation physique et sportive', citizenship: 'Enseignement moral et civique',
};
const marks = { AC: 'Acquis', ENC: 'En cours d’acquisition', ENR: 'En réussite', NR: 'Non renseigné' };
const fields = (properties) => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });
const withinRetention = "(s.left_at IS NULL OR s.left_at > transaction_timestamp() - interval '3 years')";
const select = `r.id, r.term, r.school_year AS year, r.assessments, r.appreciation,
  r.published, r.revision, s.display_name AS "studentName", c.name AS "className", r.class_id AS "classId"`;
const joined = `FROM school_reports r JOIN students s ON (s.school_id,s.id) = (r.school_id,r.student_id)
  JOIN classes c ON (c.school_id,c.id) = (r.school_id,r.class_id)`;
const uuid = { type: 'string', pattern: uuidPattern.source };
const term = { type: 'string', enum: ['1', '2', '3'] };
const schema = fields({
  revision: { anyOf: [uuid, { type: 'null' }] },
  assessments: { type: 'array', minItems: 1, maxItems: Object.keys(subjects).length, items: fields({
    subject: { type: 'string', enum: Object.keys(subjects) },
    mark: { type: 'string', enum: Object.keys(marks) },
    note: { type: 'string', maxLength: 600 },
  }) },
  appreciation: { type: 'string', maxLength: 2000 },
  published: { type: 'boolean' },
});

function fail(code) {
  throw Object.assign(new Error('Livret scolaire indisponible.'), { statusCode: code });
}

async function currentYear(db, schoolId) {
  const { rows: [row] } = await db.query(`
    SELECT COALESCE(school_year,
      (EXTRACT(YEAR FROM local_date) - CASE WHEN EXTRACT(MONTH FROM local_date) < 9 THEN 1 ELSE 0 END)::smallint) AS year
    FROM schools CROSS JOIN LATERAL (SELECT transaction_timestamp() AT TIME ZONE 'Europe/Paris' AS local_date) cal
    WHERE id = $1
  `, [schoolId]);
  return row.year;
}

async function roster(db, schoolId, classId) {
  const { rows } = await db.query(`
    SELECT id, display_name AS "displayName", grade FROM students
    WHERE (school_id,class_id) = ($1,$2) AND left_at IS NULL ORDER BY display_name,id
  `, [schoolId, classId]);
  return { students: rows, subjects, marks, year: await currentYear(db, schoolId) };
}

async function reportForTerm(db, ids, period) {
  const { rows: [report] } = await db.query(`
    SELECT ${select} ${joined} WHERE (r.school_id,r.student_id,r.school_year,r.term) = ($1,$2,$3,$4) AND ${withinRetention}
  `, [ids[0], ids[2], period.year, period.term]);
  return report ?? null;
}

async function save(db, [schoolId, classId, studentId], period, { revision, assessments, appreciation, published }) {
  const student = await db.query(`
    SELECT 1 FROM students WHERE (school_id,class_id,id) = ($1,$2,$3) AND left_at IS NULL FOR UPDATE
  `, [schoolId, classId, studentId]);
  if (!student.rowCount) return null;
  if (new Set(assessments.map(({ subject }) => subject)).size !== assessments.length
    || /\0/.test(appreciation) || assessments.some(({ note }) => /\0/.test(note))) fail(400);
  const previous = await reportForTerm(db, [schoolId, classId, studentId], period);
  if ((previous?.revision ?? null) !== revision) fail(409);
  await db.query(`
    INSERT INTO school_reports (school_id,id,class_id,student_id,school_year,term,assessments,appreciation,published,revision)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
    ON CONFLICT (school_id,student_id,school_year,term) DO UPDATE
    SET assessments=excluded.assessments, appreciation=excluded.appreciation,
      class_id=excluded.class_id, published=excluded.published, revision=excluded.revision
  `, [schoolId, previous?.id ?? randomUUID(), classId, studentId, period.year, period.term,
    JSON.stringify(assessments), appreciation.trim(), published, randomUUID()]);
  return { report: await reportForTerm(db, [schoolId, classId, studentId], period) };
}

async function reportById(db, schoolId, reportId, childId, publicOnly) {
  const { rows: [report] } = await db.query(`
    SELECT ${select} ${joined} WHERE (r.school_id,r.id) = ($1,$2) AND ${withinRetention}
      AND ($3::uuid IS NULL OR r.student_id = $3) AND (NOT $4::boolean OR r.published)
  `, [schoolId, reportId, childId, publicOnly]);
  return report;
}

async function pdf(reply, report) {
  if (!report) return null;
  reply.type('application/pdf').header('Content-Disposition', 'attachment; filename="livret-scolaire.pdf"')
    .header('X-Content-Type-Options', 'nosniff');
  return writeSchoolPdf('Livret scolaire', report.year, (doc) => {
    doc.addPage().font('Bold').fontSize(24).fillColor('#17372d').text('Livret scolaire');
    doc.moveDown(0.5).fontSize(15).text(report.studentName);
    doc.font('Regular').fontSize(11).text(`${report.className} · ${report.year}–${report.year + 1} · Trimestre ${report.term}`);
    if (!report.published) doc.text('Brouillon');
    doc.moveDown();
    for (const { subject, mark, note } of report.assessments) {
      doc.font('Bold').text(subjects[subject] + ' · ' + marks[mark]);
      if (note) doc.font('Regular').text(note);
      doc.moveDown(0.5);
    }
    if (report.appreciation) {
      doc.font('Bold').text('Appréciation générale');
      doc.font('Regular').text(report.appreciation);
    }
  });
}

export function registerTeacherReports(app, authenticated) {
  const path = '/teacher/classes/:classId/reports';
  app.get(path, { schema: { params: uuidParams('classId') } },
    forTeacherClass(authenticated, (_request, db, school, id) => roster(db, school, id)));
  const studentPath = path + '/:studentId';
  const params = uuidParams('classId', 'studentId');
  const querystring = fields({ term });
  app.get(studentPath, { schema: { params, querystring } }, forTeacherClass(authenticated, async (request, db, school, classId) => {
    const { studentId } = request.params;
    const found = await db.query(`
      SELECT 1 FROM students WHERE (school_id,class_id,id) = ($1,$2,$3) AND left_at IS NULL FOR SHARE
    `, [school, classId, studentId]);
    if (!found.rowCount) return null;
    const report = await reportForTerm(db, [school, classId, studentId], { year: await currentYear(db, school), term: request.query.term });
    return { report };
  }));
  app.put(studentPath, { bodyLimit: 32 * 1024, schema: { params, querystring, body: schema } },
    forTeacherClass(authenticated, async (request, db, school, id) => save(db, [school, id, request.params.studentId],
      { year: await currentYear(db, school), term: request.query.term }, request.body)));
}

export function registerDirectionReports(app, authenticated) {
  const path = '/direction/classes/:classId/reports';
  app.get(path, { schema: { params: uuidParams('classId') } }, authenticated(async (request, db, actor) => {
    const classId = request.params.classId;
    if (!await lockActiveClass(db, actor.school_id, classId)) return null;
    return roster(db, actor.school_id, classId);
  }));
  app.get('/direction/students/:studentId/reports', { schema: { params: uuidParams('studentId') } },
    authenticated(async (request, db, actor) => {
      const { rows } = await db.query(`
        SELECT ${select} ${joined} WHERE (r.school_id,r.student_id) = ($1,$2) AND ${withinRetention}
        ORDER BY r.school_year DESC, r.term DESC
      `, [actor.school_id, request.params.studentId]);
      return { reports: rows };
    }));
  app.get('/direction/reports/:reportId/pdf', { schema: { params: uuidParams('reportId') } },
    authenticated(async (request, db, actor, reply) => pdf(reply,
      await reportById(db, actor.school_id, request.params.reportId, null, false))));
}

export function registerParentReports(app, authenticated) {
  const path = '/parent/children/:childId/reports';
  app.get(path, { schema: { params: uuidParams('childId') } }, authenticated(async (request, db, actor) => {
    const { childId } = request.params;
    if (!await linkedChildClass(db, actor, childId, { historical: true })) return null;
    const { rows } = await db.query(`
      SELECT ${select} ${joined} WHERE (r.school_id,r.student_id) = ($1,$2) AND ${withinRetention} AND r.published
      ORDER BY r.school_year DESC,r.term DESC
    `, [actor.school_id, childId]);
    return { reports: rows };
  }));
  app.get(path + '/:reportId/pdf', { schema: { params: uuidParams('childId', 'reportId') } },
    authenticated(async (request, db, actor, reply) => {
      const { childId, reportId } = request.params;
      if (!await linkedChildClass(db, actor, childId, { historical: true })) return null;
      return pdf(reply, await reportById(db, actor.school_id, reportId, childId, true));
    }));
}

export function purgeSchoolReports(pool) {
  return pool.query(`DELETE FROM school_reports r USING students s
    WHERE (s.school_id,s.id) = (r.school_id,r.student_id) AND NOT ${withinRetention}`);
}
