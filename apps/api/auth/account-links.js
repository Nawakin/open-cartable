import { refreshDigest, uuidPattern } from './credentials.js';
import { passwordLimits, verifyPassword } from './password.js';
import { authRateLimit, cookieOptions, parentCookieName, teacherCookieName, webSessionToken } from './staff-web.js';

const hasChildren = `EXISTS (
  SELECT 1 FROM guardian_students l WHERE (l.school_id, l.guardian_id) = (g.school_id, g.id)
)`;

async function teacherForParent(db, { school_id, guardian_id }) {
  const { rows: [entry] } = await db.query(`
    SELECT a.id FROM parent_teacher_links p
    JOIN teacher_accounts a ON (a.school_id, a.id) = (p.school_id, p.teacher_id)
    JOIN guardians g ON (g.school_id, g.id) = (p.school_id, p.guardian_id)
    WHERE (p.school_id, p.guardian_id) = ($1, $2) AND a.password_hash IS NOT NULL AND g.active AND ${hasChildren}
  `, [school_id, guardian_id]);
  return entry?.id;
}

async function parentForTeacher(db, { school_id, teacher_id }) {
  const { rows: [entry] } = await db.query(`
    SELECT g.id FROM parent_teacher_links p
    JOIN guardians g ON (g.school_id, g.id) = (p.school_id, p.guardian_id)
    WHERE (p.school_id, p.teacher_id) = ($1, $2) AND g.active AND ${hasChildren}
  `, [school_id, teacher_id]);
  return entry?.id;
}

async function browserParent(db, schoolId, request, lockSession = false) {
  const token = webSessionToken(request, parentCookieName);
  if (!token) return null;
  const { rows: [parent] } = await db.query(`
    SELECT g.id
    FROM parent_browser_sessions b JOIN parent_sessions s ON s.id = b.session_id
    JOIN guardians g ON (g.school_id, g.id) = (s.school_id, s.guardian_id)
    WHERE b.digest = $1 AND s.school_id = $2 AND s.revoked_at IS NULL
      AND s.expires_at > statement_timestamp() AND g.active AND ${hasChildren}
    ${lockSession ? 'FOR SHARE OF s' : ''}
  `, [refreshDigest(token), schoolId]);
  return parent?.id ?? null;
}

async function browserTeacherMatches(db, schoolId, teacherId, request) {
  const token = webSessionToken(request, teacherCookieName);
  if (!token) return false;
  const session = await db.query(`
    SELECT 1 FROM teacher_sessions s JOIN teacher_accounts a ON (a.school_id, a.id) = (s.school_id, s.teacher_id)
    WHERE s.digest = $1 AND (s.school_id, s.teacher_id) = ($2, $3)
      AND s.expires_at > statement_timestamp() AND a.password_hash IS NOT NULL
  `, [refreshDigest(token), schoolId, teacherId]);
  return session.rowCount === 1;
}

function fail(statusCode) {
  throw Object.assign(new Error('L’association des comptes a échoué.'), { statusCode });
}

export function registerParentAccountLink(app, authenticated, onRequest) {
  const path = '/parent/web/teacher-link';
  app.get(path, authenticated(async (_request, db, actor) => ({ linked: Boolean(await teacherForParent(db, actor)) })));
  app.post(path + '/open', { onRequest }, authenticated(async (request, db, actor, reply) => {
    const teacherId = await teacherForParent(db, actor);
    if (!teacherId) return null;
    if (!await browserTeacherMatches(db, actor.school_id, teacherId, request)) reply.clearCookie(teacherCookieName, cookieOptions);
  }, 204));
  app.delete(path, { onRequest }, authenticated(async (_request, db, actor) => {
    await db.query('DELETE FROM parent_teacher_links WHERE (school_id, guardian_id) = ($1, $2)',
      [actor.school_id, actor.guardian_id]);
  }, 204));
}

export function registerTeacherAccountLink(app, authenticated) {
  const path = '/teacher/parent-link';
  app.get(path, authenticated(async (request, db, actor) => {
    const parentId = await parentForTeacher(db, actor);
    if (parentId) return { linked: true, candidate: null };
    const id = await browserParent(db, actor.school_id, request);
    if (!id) return { linked: false, candidate: null };
    const { rows } = await db.query(`
      SELECT s.display_name AS name FROM guardian_students l
      JOIN students s ON (s.school_id, s.id) = (l.school_id, l.student_id)
      WHERE (l.school_id, l.guardian_id) = ($1, $2) ORDER BY s.display_name, s.id
    `, [actor.school_id, id]);
    return { linked: false, candidate: { id, children: rows.map(({ name }) => name) } };
  }));

  app.put(path, {
    bodyLimit: 2048,
    config: authRateLimit,
    schema: { body: {
      type: 'object', additionalProperties: false, required: ['parentId', 'password'],
      properties: { parentId: { type: 'string', pattern: uuidPattern.source }, password: { type: 'string', ...passwordLimits } },
    } },
  }, authenticated(async (request, db, actor) => {
    const { school_id, teacher_id } = actor;
    const { password, parentId } = request.body;
    const guardian = await browserParent(db, school_id, request, true);
    if (guardian !== parentId) fail(409);
    const { rows: [account] } = await db.query(`
      SELECT password_salt, password_hash FROM teacher_accounts WHERE (school_id, id) = ($1, $2)
    `, [school_id, teacher_id]);
    if (!await verifyPassword(password, account?.password_hash ? account : null)) fail(422);
    const association = await db.query(`
      INSERT INTO parent_teacher_links (school_id, guardian_id, teacher_id) VALUES ($1, $2, $3)
      ON CONFLICT DO NOTHING
    `, [school_id, guardian, teacher_id]);
    if (!association.rowCount && await parentForTeacher(db, actor) !== guardian) fail(409);
    return { linked: true, candidate: null };
  }));

  app.post(path + '/open', authenticated(async (request, db, actor, reply) => {
    const parentId = await parentForTeacher(db, actor);
    if (!parentId) return null;
    if (await browserParent(db, actor.school_id, request) !== parentId) reply.clearCookie(parentCookieName, cookieOptions);
  }, 204));
  app.delete(path, authenticated(async (_request, db, actor) => {
    await db.query('DELETE FROM parent_teacher_links WHERE (school_id, teacher_id) = ($1, $2)',
      [actor.school_id, actor.teacher_id]);
  }, 204));
}
