import { linkedChildClass } from '../auth/class-access.js';
import { uuidPattern } from '../auth/credentials.js';
import { isSchoolDate } from '../homework/period.js';
import { openPrivateFile, preparePrivateFile, privateFileBody, privateFileBodyLimit, sealPrivateFile, privateFileHeaders } from '../files/private-files.js';
import { bumpRevision, setJustification } from './store.js';

const uuid = { type: 'string', pattern: uuidPattern.source };
const day = { type: 'string', minLength: 10, maxLength: 10 };
const params = (properties) => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });
const term = "(transaction_timestamp() AT TIME ZONE 'Europe/Paris')::date - interval '3 years'";
const condition = '(school_id, class_id, day, student_id) = ($1, $2, $3, $4)';

function status(code) {
  throw Object.assign(new Error('Justificatif d’absence indisponible.'), { statusCode: code });
}

function scope({ params }, schoolId, studentId = params.studentId) {
  if (!isSchoolDate(params.day)) status(400);
  return [schoolId, params.classId, params.day, studentId];
}

async function findFile(db, ids, key) {
  const { rows: [file] } = await db.query(`
    SELECT j.kind, j.content FROM absence_justifications j JOIN attendance_entries e USING (school_id, class_id, day, student_id)
    WHERE (e.school_id, e.class_id, e.day, e.student_id) = ($1, $2, $3, $4) AND e.day >= ${term} AND e.status = 'absent'
  `, ids);
  return file ? { kind: file.kind, body: openPrivateFile(file.content, key, ['absence', ...ids]) } : null;
}

function attachment(operation, filename) {
  return async (request, db, actor, reply) => {
    const file = await operation(request, db, actor);
    if (!file) return null;
    // Le gestionnaire d'authentification envoie le corps après la transaction.
    privateFileHeaders(reply, file.kind, filename);
    return file.body;
  };
}

export function registerParentJustifications(app, authenticated, writes, key) {
  const path = '/parent/children/:childId/attendance/:classId/:day/justification';
  const schema = params({ childId: uuid, classId: uuid, day });
  const forChild = (operation) => authenticated(async (request, db, actor, reply) => {
    const { childId } = request.params;
    if (!await linkedChildClass(db, actor, childId, { historical: true })) return null;
    return operation(request, db, actor, scope(request, actor.school_id, childId), reply);
  });
  app.put(path, { ...writes, bodyLimit: privateFileBodyLimit,
    schema: { params: schema, body: privateFileBody },
  }, forChild(async (request, db, actor, ids) => {
    const roll = await db.query('SELECT 1 FROM attendance_rolls WHERE (school_id,class_id,day) = ($1,$2,$3) FOR UPDATE', ids.slice(0, 3));
    if (!roll.rowCount) return null;
    const { rows: [entry] } = await db.query(`SELECT justified FROM attendance_entries
      WHERE ${condition} AND day >= ${term} AND status = 'absent'`, ids);
    if (!entry) return null;
    if (entry.justified) status(409);
    const file = await preparePrivateFile(request.body.content);
    const bytes = sealPrivateFile(file.bytes, key, ['absence', ...ids]);
    await db.query(`
      INSERT INTO absence_justifications (school_id, class_id, day, student_id, guardian_id, kind, content)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (school_id,class_id,day,student_id) DO UPDATE
      SET guardian_id = excluded.guardian_id, kind = excluded.kind, content = excluded.content,
        status = 'pending', updated_at = transaction_timestamp()
    `, [...ids, actor.guardian_id, file.kind, bytes]);
    await bumpRevision(db, ids.slice(0, 3));
    return { status: 'pending' };
  }));
}

export function registerDirectionJustifications(app, authenticated, key) {
  const path = '/direction/classes/:classId/attendance/:day/students/:studentId/justification';
  const route = params({ classId: uuid, day, studentId: uuid });
  app.get(path, { schema: { params: route } }, authenticated(attachment(
    (request, db, actor) => findFile(db, scope(request, actor.school_id), key), 'justificatif',
  )));
  app.put(path, { bodyLimit: 1024, schema: { params: route, body: params({
    revision: uuid, accepted: { type: 'boolean' },
  }) } }, authenticated(async (request, db, actor) => {
    const ids = scope(request, actor.school_id);
    const result = await setJustification(db, ids.slice(0, 3), ids[3], request.body.revision, request.body.accepted);
    if (!result) return null;
    const updated = await db.query(`UPDATE absence_justifications SET status = $5 WHERE ${condition}`,
      [...ids, request.body.accepted ? 'accepted' : 'refused']);
    if (!updated.rowCount) status(409);
    return result;
  }));
}
