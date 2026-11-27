import { uuidPattern } from '../auth/credentials.js';
import { uuidParams } from '../auth/staff-web.js';
import { isSchoolDate } from '../homework/period.js';
import { buildLsuXml, lsuLevels, lsuReportProblems, lsuVersions, validXmlText } from './lsu.js';

const path = '/direction/reports/lsu';
const fields = (properties, required = Object.keys(properties)) => ({ type: 'object', additionalProperties: false, properties, required });
const string = (maxLength) => ({ type: 'string', minLength: 1, maxLength });
const pattern = (value) => ({ type: 'string', pattern: value.source });
const uuid = pattern(uuidPattern);
const year = pattern(/^(?:19|[2-9]\d)\d{2}$/);
const term = { enum: ['1', '2', '3'] };
const date = pattern(/^\d{4}-\d\d-\d\d$/);
const officialIdentity = fields({ civility: { enum: ['M', 'MME'] }, name: string(100), givenName: string(100) });
const position = { type: 'integer', minimum: 1, maximum: 4 };
const pupils = fields({ id: uuid, revision: uuid, ine: pattern(/^\d{9}[A-Z0-9]{2}$/), grade: { enum: lsuLevels },
  schoolingDate: date }, ['id', 'revision', 'ine', 'grade']);
const body = fields({
  version: { enum: lsuVersions }, uai: pattern(/^\d{7}[A-Z]$/), idBe: pattern(/^[1-9]\d{0,19}$/),
  from: date, to: date, createdOn: date, director: officialIdentity,
  teachers: { type: 'array', minItems: 1, maxItems: 30, items: officialIdentity, uniqueItems: true },
  positions: fields({ AC: position, ENC: position, ENR: position }),
  reports: { type: 'array', minItems: 1, maxItems: 150, items: pupils },
});
const schoolScope = 'r.school_id = $1 AND r.published AND (s.left_at IS NULL OR s.left_at > now() - interval \'3 years\')';
const joined = `FROM school_reports r JOIN students s ON (s.school_id,s.id) = (r.school_id,r.student_id)
  JOIN classes c ON (c.school_id,c.id) = (r.school_id,r.class_id)`;

async function listReports(db, ids) {
  return (await db.query(`
    SELECT r.id, r.revision, c.name AS "className", s.display_name AS "studentName", r.assessments, r.appreciation,
      CASE WHEN (c.archived_year IS NULL AND s.class_id = c.id AND s.left_at IS NULL) THEN s.grade END AS grade
    ${joined} WHERE ${schoolScope} AND (r.class_id,r.school_year,r.term) = ($2,$3,$4)
    ORDER BY s.display_name,r.id
  `, ids)).rows;
}

function fail(statusCode) {
  throw Object.assign(new Error('Export LSU indisponible.'), { statusCode });
}

function unique(items) {
  return new Set(items).size === items.length;
}

function exportDates({ from, to, createdOn, reports }) {
  if (![from, to, createdOn, ...reports.flatMap(({ schoolingDate }) => schoolingDate ? [schoolingDate] : [])].every(isSchoolDate)
      || from > to
      || reports.some(({ schoolingDate }) => schoolingDate && (schoolingDate < from || schoolingDate > to))) fail(400);
}

function identity(person) {
  const name = person.name.trim();
  const givenName = person.givenName.trim();
  if (!validXmlText(name, 100) || !validXmlText(givenName, 100)) fail(400);
  return { civility: person.civility, name, givenName };
}

export function registerLsuExport(app, authenticated) {
  const classPath = path + '/:classId';
  const params = uuidParams('classId');
  const querystring = fields({ year, term });
  app.get(path, authenticated(async (_request, db, { school_id: id }) => ({
    periods: (await db.query(`
      SELECT r.class_id AS "classId", c.name AS "className", r.school_year AS year, r.term
      ${joined} WHERE ${schoolScope}
      GROUP BY r.school_year,c.name,r.class_id,r.term ORDER BY r.school_year DESC,c.name,r.class_id,r.term
    `, [id])).rows,
  })));
  app.get(classPath, { schema: { params, querystring } }, authenticated(async (request, db, actor) => ({
    reports: (await listReports(db, [actor.school_id, request.params.classId, request.query.year, request.query.term]))
      .map(({ className, assessments, appreciation, ...report }) => ({ ...report,
        problems: lsuReportProblems({ assessments, appreciation, grade: report.grade }) })),
  })));
  app.post(classPath, { bodyLimit: 48 * 1024, schema: { params, querystring, body },
    config: { rateLimit: { max: 8, timeWindow: '1 minute' } },
  }, authenticated(async (request, db, actor, reply) => {
    const { year, term } = request.query;
    const input = request.body;
    exportDates(input);
    const director = identity(input.director);
    const teachers = input.teachers.map(identity);
    if (!unique(teachers.map((teacher) => JSON.stringify(teacher))) || !unique(input.reports.map(({ ine }) => ine))
        || !unique(input.reports.map(({ id }) => id))) fail(400);
    const available = new Map((await listReports(db, [actor.school_id, request.params.classId, year, term])).map((report) => [report.id, report]));
    const reports = input.reports.map((pupil) => {
      const report = available.get(pupil.id);
      if (!report) fail(404);
      if (report.revision !== pupil.revision) fail(409);
      if (lsuReportProblems(report).length) fail(422);
      return { ...report, ...pupil };
    });
    const xml = buildLsuXml({ ...input, director, teachers, reports, year, term, className: reports[0].className });
    reply.type('application/xml; charset=utf-8').header('X-Content-Type-Options', 'nosniff')
      .header('Content-Disposition', `attachment; filename="import-lsun-${Date.now()}.xml"`);
    return xml;
  }));
}
