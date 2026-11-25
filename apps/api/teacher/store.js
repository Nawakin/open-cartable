import { randomBytes, randomUUID } from 'node:crypto';
import { generateRefreshToken, refreshDigest } from '../auth/credentials.js';
import { transaction } from '../db/database.js';
import { hashPassword, validPassword, verifyPassword } from '../auth/password.js';

export const teacherLoginPattern = /^[a-z0-9][a-z0-9._-]{2,31}$/;
export const teacherActivationPattern = /^ENS-[A-Za-z0-9_-]{22}$/;
export const teacherSessionSeconds = 8 * 60 * 60;

function newActivationCode() {
  return 'ENS-' + randomBytes(16).toString('base64url');
}

async function ownsClasses(db, schoolId, classIds) {
  const result = await db.query('SELECT id FROM classes WHERE school_id = $1 AND id = ANY($2::uuid[]) FOR SHARE', [schoolId, classIds]);
  return result.rowCount === classIds.length;
}

async function assignClasses(db, schoolId, teacherId, classIds) {
  await db.query(`
    INSERT INTO teacher_classes (school_id, teacher_id, class_id)
    SELECT $1, $2, class_id FROM unnest($3::uuid[]) AS class_id
  `, [schoolId, teacherId, classIds]);
}

export async function listTeachers(db, schoolId) {
  const { rows } = await db.query(`
    SELECT a.id, a.login,
           CASE WHEN a.password_hash IS NOT NULL THEN 'active'
                WHEN a.activation_expires_at > statement_timestamp() THEN 'pending'
                ELSE 'expired' END AS status,
           ARRAY(SELECT t.class_id FROM teacher_classes t
                 WHERE (t.school_id, t.teacher_id) = (a.school_id, a.id) ORDER BY t.class_id) AS "classIds"
    FROM teacher_accounts a WHERE a.school_id = $1 ORDER BY a.login
  `, [schoolId]);
  return rows;
}

export async function createTeacher(db, schoolId, login, classIds) {
  if (!await ownsClasses(db, schoolId, classIds)) return null;
  const id = randomUUID();
  const code = newActivationCode();
  const created = await db.query(`
    INSERT INTO teacher_accounts (school_id, id, login, activation_digest, activation_expires_at)
    VALUES ($1, $2, $3, $4, statement_timestamp() + interval '7 days')
    ON CONFLICT (school_id, login) DO NOTHING
    RETURNING activation_expires_at AS "expiresAt"
  `, [schoolId, id, login, refreshDigest(code)]);
  if (!created.rowCount) throw Object.assign(new Error('Identifiant déjà utilisé.'), { statusCode: 409 });
  await assignClasses(db, schoolId, id, classIds);
  return { id, login, code, expiresAt: created.rows[0].expiresAt };
}

export async function updateTeacherClasses(db, schoolId, teacherId, classIds) {
  const account = await db.query('SELECT 1 FROM teacher_accounts WHERE school_id = $1 AND id = $2 FOR UPDATE',
    [schoolId, teacherId]);
  if (!account.rowCount || !await ownsClasses(db, schoolId, classIds)) return false;
  await db.query('DELETE FROM teacher_classes WHERE school_id = $1 AND teacher_id = $2', [schoolId, teacherId]);
  await assignClasses(db, schoolId, teacherId, classIds);
  return true;
}

export async function resetTeacher(db, schoolId, teacherId) {
  const code = newActivationCode();
  const reset = await db.query(`
    UPDATE teacher_accounts
    SET password_salt = NULL, password_hash = NULL,
        activation_digest = $3, activation_expires_at = statement_timestamp() + interval '7 days'
    WHERE school_id = $1 AND id = $2
    RETURNING login, activation_expires_at AS "expiresAt"
  `, [schoolId, teacherId, refreshDigest(code)]);
  if (!reset.rowCount) return null;
  await db.query('DELETE FROM teacher_sessions WHERE school_id = $1 AND teacher_id = $2', [schoolId, teacherId]);
  return { id: teacherId, code, ...reset.rows[0] };
}

export async function deleteTeacher(db, schoolId, teacherId) {
  const result = await db.query('DELETE FROM teacher_accounts WHERE school_id = $1 AND id = $2', [schoolId, teacherId]);
  return result.rowCount === 1;
}

export async function activateTeacher(pool, { schoolCode, login, code, password }) {
  if (!validPassword(password)) return false;
  const digest = refreshDigest(code);
  const account = await pool.query(`
    SELECT a.school_id, a.id FROM teacher_accounts a JOIN schools s ON s.id = a.school_id
    WHERE s.code = $1 AND a.login = $2 AND a.activation_digest = $3
      AND a.activation_expires_at > statement_timestamp()
  `, [schoolCode, login, digest]);
  if (!account.rowCount) return false;

  const { salt, hash } = await hashPassword(password);
  const { school_id: schoolId, id } = account.rows[0];
  const result = await pool.query(`
    UPDATE teacher_accounts
    SET password_salt = $4, password_hash = $5, activation_digest = NULL, activation_expires_at = NULL
    WHERE school_id = $1 AND id = $2 AND activation_digest = $3
      AND activation_expires_at > statement_timestamp()
  `, [schoolId, id, digest, salt, hash]);
  return result.rowCount === 1;
}

export async function signInTeacher(pool, { schoolCode, login, password }) {
  const { rows: [account] } = await pool.query(`
    SELECT a.school_id, a.id, a.password_salt, a.password_hash
    FROM teacher_accounts a JOIN schools s ON s.id = a.school_id WHERE s.code = $1 AND a.login = $2
  `, [schoolCode, login]);
  if (!await verifyPassword(password, account?.password_hash ? account : null)) return null;

  return transaction(pool, async (db) => {
    const current = await db.query(`
      SELECT 1 FROM teacher_accounts WHERE school_id = $1 AND id = $2 AND password_salt = $3 FOR SHARE
    `, [account.school_id, account.id, account.password_salt]);
    if (!current.rowCount) return null;

    const token = generateRefreshToken();
    await db.query(`
      INSERT INTO teacher_sessions (digest, school_id, teacher_id, expires_at)
      VALUES ($1, $2, $3, statement_timestamp() + $4 * interval '1 second')
    `, [refreshDigest(token), account.school_id, account.id, teacherSessionSeconds]);
    return token;
  });
}

export async function withTeacherSession(pool, token, operation) {
  return transaction(pool, async (db) => {
    const digest = refreshDigest(token);
    const { rows: [actor] } = await db.query(`
      SELECT t.school_id, t.teacher_id, s.code AS school_code, s.name AS school_name
      FROM teacher_sessions t JOIN schools s ON s.id = t.school_id
      WHERE t.digest = $1 AND t.expires_at > statement_timestamp()
    `, [digest]);
    if (!actor) return { authorized: false };

    // Verrouiller le compte avant la session, comme lors d’un changement d’affectation ou d’un retrait.
    const account = await db.query('SELECT 1 FROM teacher_accounts WHERE school_id = $1 AND id = $2 FOR SHARE',
      [actor.school_id, actor.teacher_id]);
    if (!account.rowCount) return { authorized: false };
    const session = await db.query('SELECT 1 FROM teacher_sessions WHERE digest = $1 AND expires_at > statement_timestamp() FOR SHARE',
      [digest]);
    if (!session.rowCount) return { authorized: false };
    return { authorized: true, value: await operation(db, actor) };
  });
}

export async function signOutTeacher(pool, token) {
  await pool.query('DELETE FROM teacher_sessions WHERE digest = $1', [refreshDigest(token)]);
}

export async function canTeachClass(db, actor, classId) {
  const result = await db.query('SELECT 1 FROM teacher_classes WHERE school_id = $1 AND teacher_id = $2 AND class_id = $3',
    [actor.school_id, actor.teacher_id, classId]);
  return result.rowCount === 1;
}
