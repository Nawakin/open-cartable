import { randomUUID } from 'node:crypto';
import { createAppointment } from '../agenda/appointments.js';
import { isInstant } from '../agenda/period.js';
import { linkedChildClass } from '../auth/class-access.js';
import { uuidParams } from '../auth/staff-web.js';
import { openPrivateFile, preparePrivateFile, privateFileBody, privateFileBodyLimit, privateFileHeaders, sealPrivateFile } from '../files/private-files.js';
import { instantField, invalid, nullable, plain, shape, text, uuid, validPublicationAt } from './validation.js';

const activityBody = shape({
  kind: { enum: ['announcement', 'invitation', 'slot'] },
  classIds: { type: 'array', items: uuid, uniqueItems: true, maxItems: 100 },
  title: text(120), body: text(2500), needsReceipt: { type: 'boolean' },
  publishAt: nullable(instantField), startsAt: nullable(instantField), endsAt: nullable(instantField),
});
const audienceBody = shape({ classIds: activityBody.properties.classIds });
const answerBody = shape({ answer: { enum: ['read', 'yes', 'no', 'booked', 'withdraw'] }, childId: nullable(uuid) });
const columns = `a.id, a.kind, a.title, a.body, a.needs_receipt AS "needsReceipt",
  a.publish_at AS "publishAt", a.starts_at AS "startsAt", a.ends_at AS "endsAt", a.attachment_kind IS NOT NULL AS "hasDocument"`;
const withinAudience = '(cardinality(a.class_ids) = 0 OR s.class_id = ANY(a.class_ids))';
const published = 'a.publish_at <= statement_timestamp() AND a.publish_at > statement_timestamp() - interval \'1 year\'';

export const activeChildren = `
  SELECT s.id, s.class_id, s.display_name, c.name AS class_name
  FROM guardian_students g JOIN students s ON (s.school_id,s.id) = (g.school_id,g.student_id)
  JOIN classes c ON (c.school_id,c.id) = (s.school_id,s.class_id)
  WHERE (g.school_id,g.guardian_id) = ($1,$2) AND s.left_at IS NULL AND c.archived_year IS NULL
`;

const staffScope = `a.school_id = $1 AND ($2::uuid IS NULL OR (
  a.teacher_id = $2 AND NOT EXISTS (
    SELECT 1 FROM unnest(a.class_ids) AS selected(id)
    WHERE NOT EXISTS (
      SELECT 1 FROM teacher_classes tc JOIN classes c ON (c.school_id,c.id) = (tc.school_id,tc.class_id)
      WHERE (tc.school_id,tc.teacher_id,tc.class_id) = (a.school_id,$2,selected.id) AND c.archived_year IS NULL
    )
  )
))`;

async function audience(db, actor, ids) {
  const { school_id, teacher_id = null } = actor;
  if (teacher_id && !ids.length) invalid(403);
  const { rows } = await db.query(`
    SELECT c.id,c.name FROM classes c WHERE c.school_id = $1 AND c.archived_year IS NULL
      AND (cardinality($2::uuid[]) = 0 OR c.id = ANY($2))
      AND ($3::uuid IS NULL OR EXISTS (SELECT 1 FROM teacher_classes t
        WHERE (t.school_id,t.class_id,t.teacher_id) = (c.school_id,c.id,$3)))
    ORDER BY c.id FOR SHARE OF c
  `, [school_id, ids, teacher_id]);
  if (ids.length && rows.length !== ids.length) invalid(404);
  if (teacher_id) {
    const assignments = await db.query(`
      SELECT 1 FROM teacher_classes WHERE school_id=$1 AND teacher_id=$2 AND class_id=ANY($3::uuid[]) FOR SHARE
    `, [school_id, teacher_id, ids]);
    if (assignments.rowCount !== ids.length) invalid(404);
  }
  return rows;
}

async function audiencePreview(db, actor, ids) {
  const classes = await audience(db, actor, ids);
  const { rows: [counts] } = await db.query(`
    SELECT count(DISTINCT l.guardian_id)::int AS guardians, count(DISTINCT s.id)::int AS students
    FROM students s JOIN guardian_students l ON (l.school_id,l.student_id)=(s.school_id,s.id)
    JOIN guardians g ON (g.school_id,g.id)=(l.school_id,l.guardian_id) AND g.active
    WHERE s.school_id=$1 AND s.class_id=ANY($2::uuid[]) AND s.left_at IS NULL
  `, [actor.school_id, classes.map(({ id }) => id)]);
  return { classes, ...counts };
}

function validate(input) {
  const { kind, classIds, needsReceipt, startsAt, endsAt, publishAt } = input;
  const title = plain(input.title, true);
  const body = plain(input.body, kind === 'announcement');
  if (kind === 'announcement') {
    if (startsAt !== null || endsAt !== null) invalid();
  } else {
    if (needsReceipt || !isInstant(startsAt) || !isInstant(endsAt)) invalid();
    const start = Date.parse(startsAt);
    const duration = Date.parse(endsAt) - start;
    if (start <= Date.now() || duration <= 0 || duration > (kind === 'slot' ? 8 : 24) * 3_600_000) invalid();
  }
  if (kind === 'slot' && classIds.length !== 1) invalid();
  if (publishAt !== null && publishAt !== 'now' && !validPublicationAt(publishAt)) invalid();
  if (startsAt && publishAt && (publishAt === 'now' ? Date.now() : Date.parse(publishAt)) >= Date.parse(startsAt)) invalid();
  return { ...input, title, body };
}

async function staffActivity(db, actor, id, lock = false) {
  const { rows: [row] } = await db.query(`
    SELECT a.*, a.publish_at <= statement_timestamp() AS live
    FROM school_activities a WHERE ${staffScope} AND a.id = $3 ${lock ? 'FOR UPDATE OF a' : ''}
  `, [actor.school_id, actor.teacher_id ?? null, id]);
  return row;
}

async function saveActivity(db, actor, id, input) {
  const { kind, classIds, title, body, needsReceipt, publishAt, startsAt, endsAt } = validate(input);
  await db.query('SELECT 1 FROM schools WHERE id=$1 FOR NO KEY UPDATE', [actor.school_id]);
  const previous = id ? await staffActivity(db, actor, id, true) : null;
  if (id && !previous) return null;
  if (previous?.live) invalid(409);
  await audience(db, actor, classIds);
  if (kind === 'slot') {
    const bookedTime = await db.query(`
      SELECT 1 FROM school_activities WHERE school_id=$1 AND kind='slot'
        AND teacher_id IS NOT DISTINCT FROM $2::uuid
        AND starts_at < $4 AND ends_at > $3 AND id IS DISTINCT FROM $5::uuid
    `, [actor.school_id, previous ? previous.teacher_id : actor.teacher_id ?? null, startsAt, endsAt, id]);
    if (bookedTime.rowCount) invalid(409);
  }
  const activityId = id ?? randomUUID();
  await db.query(`
    INSERT INTO school_activities (school_id,id,teacher_id,kind,class_ids,title,body,needs_receipt,publish_at,starts_at,ends_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,
      CASE WHEN $9 = 'now' THEN statement_timestamp() ELSE $9::timestamptz END,$10,$11)
    ON CONFLICT (school_id,id) DO UPDATE SET
      kind=excluded.kind,class_ids=excluded.class_ids,title=excluded.title,body=excluded.body,
      needs_receipt=excluded.needs_receipt,publish_at=excluded.publish_at,starts_at=excluded.starts_at,ends_at=excluded.ends_at,
      updated_at=statement_timestamp()
  `, [actor.school_id, activityId, previous ? previous.teacher_id : actor.teacher_id ?? null,
    kind, classIds, title, body, needsReceipt, publishAt, startsAt, endsAt]);
  return { id: activityId };
}

async function staffResponses(db, actor, id) {
  const activity = await staffActivity(db, actor, id);
  if (!activity) return null;
  const { rows } = await db.query(`
    SELECT g.id AS "guardianId", g.display_name AS "guardianName", s.display_name AS "studentName",s.id AS "studentId",
      r.answer,r.updated_at AS "updatedAt"
    FROM school_activity_responses r
    JOIN guardians g ON (g.school_id,g.id) = (r.school_id,r.guardian_id) AND g.active
    LEFT JOIN students s ON (s.school_id,s.id) = (r.school_id,r.student_id)
    WHERE (r.school_id,r.activity_id)=($1,$2)
      AND (s.id IS NULL OR (s.left_at IS NULL AND (cardinality($3::uuid[])=0 OR s.class_id=ANY($3))))
    ORDER BY s.display_name,g.display_name,g.id
  `, [actor.school_id, id, activity.class_ids]);
  return { responses: rows };
}

export async function parentActivities(db, actor, childId = null, actionOnly = false, activityId = null) {
  const { rows } = await db.query(`
    WITH permitted AS (${activeChildren})
    SELECT ${columns}, COALESCE(receipt.answer = 'read',false) AS acknowledged,
      COALESCE(mine.children,'[]'::json) AS children
    FROM school_activities a
    LEFT JOIN school_activity_responses receipt ON
      (receipt.school_id,receipt.activity_id,receipt.guardian_id)=(a.school_id,a.id,$2) AND receipt.student_id IS NULL
    CROSS JOIN LATERAL (
      SELECT json_agg(json_build_object('id',s.id,'displayName',s.display_name,'answer',r.answer)
        ORDER BY s.display_name,s.id) AS children,
        bool_or(r.answer IS NULL) AS unanswered, bool_or(r.answer IS NOT NULL) AS answered
      FROM permitted s LEFT JOIN school_activity_responses r
        ON (r.school_id,r.activity_id,r.guardian_id,r.student_id)=(a.school_id,a.id,$2,s.id)
      WHERE ${withinAudience} AND ($3::uuid IS NULL OR s.id=$3)
    ) mine
    WHERE a.school_id=$1 AND ${published} AND mine.children IS NOT NULL AND ($5::uuid IS NULL OR a.id=$5)
      AND (a.kind='announcement' OR a.ends_at > statement_timestamp())
      AND (a.kind<>'slot' OR mine.answered OR NOT EXISTS (
        SELECT 1 FROM school_activity_responses visitors
        WHERE (visitors.school_id,visitors.activity_id)=(a.school_id,a.id) AND visitors.answer='booked'
      ))
      AND (NOT $4::boolean OR CASE WHEN a.kind='announcement' THEN a.needs_receipt AND receipt.answer IS NULL
        ELSE a.starts_at > statement_timestamp() AND mine.unanswered AND (a.kind<>'slot' OR NOT mine.answered) END)
    ORDER BY CASE WHEN $4 THEN a.starts_at END NULLS LAST,a.publish_at DESC,a.id LIMIT 80
  `, [actor.school_id, actor.guardian_id, childId, actionOnly, activityId]);
  return rows;
}

async function respond(db, actor, id, { childId, answer }) {
  const { school_id: schoolId, guardian_id: guardianId } = actor;
  const { rows: [item] } = await db.query(`
    SELECT a.* FROM school_activities a WHERE (a.school_id,a.id)=($1,$2) AND ${published}
      AND (a.kind='announcement' OR a.starts_at > statement_timestamp()) FOR UPDATE OF a
  `, [schoolId, id]);
  if (!item) return null;
  const validity = { announcement: ['read'], invitation: ['yes', 'no'], slot: ['booked', 'withdraw'] };
  if (!validity[item.kind].includes(answer) || (item.kind === 'announcement') !== (childId === null)) invalid();
  const allowed = (classId) => classId && (!item.class_ids.length || item.class_ids.includes(classId));
  let classId = null;
  if (childId) {
    classId = await linkedChildClass(db, actor, childId);
    if (!allowed(classId)) return null;
  } else {
    const { rows } = await db.query(activeChildren, [schoolId, guardianId]);
    if (!item.needs_receipt || !rows.some((row) => allowed(row.class_id))) return null;
  }
  const ids = [schoolId, id, guardianId, childId];
  const { rows: [previous] } = await db.query(`
    SELECT answer,agenda_id FROM school_activity_responses WHERE (school_id,activity_id,guardian_id)=($1,$2,$3)
      AND student_id IS NOT DISTINCT FROM $4::uuid
  `, ids);
  if (previous?.answer === answer) return { answer };
  if (item.kind === 'slot' && answer === 'booked') {
    const taken = await db.query(`
      SELECT 1 FROM school_activity_responses WHERE (school_id,activity_id)=($1,$2) AND answer='booked'
    `, [schoolId, id]);
    if (taken.rowCount) invalid(409);
  }
  if (previous?.agenda_id) await db.query('DELETE FROM agenda_events WHERE (school_id,id)=($1,$2)', [schoolId, previous.agenda_id]);
  if (answer === 'withdraw') return { answer: null };
  let agendaId = null;
  if (answer === 'yes' || answer === 'booked') {
    agendaId = await createAppointment(db, { school_id: schoolId, teacher_id: item.teacher_id }, classId,
      { studentId: childId, guardianReference: guardianId },
      { startsAt: item.starts_at, endsAt: item.ends_at, title: item.title, location: '', description: item.body });
    if (!agendaId) invalid(409);
  }
  await db.query(`
    INSERT INTO school_activity_responses (school_id,activity_id,guardian_id,student_id,answer,agenda_id)
    VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (school_id,activity_id,guardian_id,student_id)
    DO UPDATE SET answer=excluded.answer,agenda_id=excluded.agenda_id,updated_at=statement_timestamp()
  `, [...ids, answer, agendaId]);
  return { answer };
}

async function removeActivity(db, actor, id) {
  if (!await staffActivity(db, actor, id, true)) return null;
  await db.query(`
    DELETE FROM agenda_events e USING school_activity_responses r
    WHERE (r.school_id,r.activity_id)=($1,$2) AND (e.school_id,e.id)=(r.school_id,r.agenda_id)
  `, [actor.school_id, id]);
  await db.query('DELETE FROM school_activities WHERE (school_id,id)=($1,$2)', [actor.school_id, id]);
}

function activityDocument(row, key, reply) {
  if (!row?.attachment_kind) return null;
  privateFileHeaders(reply, row.attachment_kind, 'document-ecole');
  return openPrivateFile(row.attachment_data, key, ['school-activity', row.school_id, row.id]);
}

export function registerStaffActivities(app, prefix, authenticated, key) {
  const path = prefix + '/activities';
  const params = uuidParams('activityId');
  app.get(path, authenticated(async (_request, db, actor) => {
    const { rows } = await db.query(`
      SELECT ${columns}, a.class_ids AS "classIds", a.publish_at <= statement_timestamp() AS live FROM school_activities a
      WHERE ${staffScope} ORDER BY a.updated_at DESC,a.id LIMIT 150
    `, [actor.school_id, actor.teacher_id ?? null]);
    return { activities: rows };
  }));
  app.post(path + '/audience', { schema: { body: audienceBody } },
    authenticated(({ body }, db, actor) => audiencePreview(db, actor, body.classIds)));
  app.post(path, { schema: { body: activityBody } },
    authenticated(({ body }, db, actor) => saveActivity(db, actor, null, body), 201));
  app.put(path + '/:activityId', { schema: { params, body: activityBody } },
    authenticated((request, db, actor) => saveActivity(db, actor, request.params.activityId, request.body)));
  app.delete(path + '/:activityId', { schema: { params } },
    authenticated(({ params }, db, actor) => removeActivity(db, actor, params.activityId), 204));
  app.get(path + '/:activityId/responses', { schema: { params } },
    authenticated(({ params }, db, actor) => staffResponses(db, actor, params.activityId)));
  app.put(path + '/:activityId/document', { bodyLimit: privateFileBodyLimit, schema: { params, body: privateFileBody } },
    authenticated(async (request, db, actor) => {
      const row = await staffActivity(db, actor, request.params.activityId, true);
      if (!row) return null;
      if (row.live || row.kind === 'slot') invalid(409);
      const file = await preparePrivateFile(request.body.content);
      const fileData = sealPrivateFile(file.bytes, key, ['school-activity', row.school_id, row.id]);
      await db.query('UPDATE school_activities SET attachment_kind=$3,attachment_data=$4 WHERE (school_id,id)=($1,$2)',
        [row.school_id, row.id, file.kind, fileData]);
    }, 204));
}

export function registerParentActivities(app, { authenticated, writes, key }) {
  const path = '/parent/activities';
  const params = uuidParams('activityId');
  app.get(path, authenticated(async (_request, db, actor) => ({ activities: await parentActivities(db, actor) })));
  app.get(path + '/:activityId', { schema: { params } }, authenticated(async ({ params }, db, actor) =>
    (await parentActivities(db, actor, null, false, params.activityId))[0] ?? null));
  app.put(path + '/:activityId/response', { ...writes, schema: { params, body: answerBody } },
    authenticated((request, db, actor) => respond(db, actor, request.params.activityId, request.body)));
  app.get(path + '/:activityId/document', { schema: { params } }, authenticated(async (request, db, actor, reply) => {
    const { rows: [row] } = await db.query(`
      WITH permitted AS (${activeChildren}) SELECT a.school_id,a.id,a.attachment_kind,a.attachment_data
      FROM school_activities a WHERE (a.school_id,a.id)=($1,$3) AND ${published}
        AND a.kind <> 'slot' AND EXISTS (SELECT 1 FROM permitted s WHERE ${withinAudience})
    `, [actor.school_id, actor.guardian_id, request.params.activityId]);
    return activityDocument(row, key, reply);
  }));
}

export async function purgeSchoolLife(pool) {
  await pool.query("DELETE FROM school_activities WHERE COALESCE(ends_at,publish_at,updated_at) < statement_timestamp() - interval '1 year'");
  await pool.query("DELETE FROM planned_absences WHERE day < current_date - interval '1 year'");
  await pool.query("DELETE FROM directory_access_log WHERE occurred_at < statement_timestamp() - interval '1 year'");
}
