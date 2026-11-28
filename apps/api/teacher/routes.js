import { deviceCodePatterns, deviceMetadata, markDevice, redeemDevicePair, registerAccountDevices } from '../devices/store.js';
import { transaction } from '../db/database.js';
import { registerTeacherTemplates } from '../school-life/templates.js';
import { registerStaffActivities } from '../school-life/activities.js';
import { registerStaffPlannedAbsences } from '../school-life/absences.js';
import { registerStaffAgenda } from '../agenda/staff-routes.js';
import { refreshDigest, schoolCodePattern } from '../auth/credentials.js';
import { passwordLimits } from '../auth/password.js';
import { authRateLimit, cookieOptions, nativeStaffClient, registerStaffWeb, teacherCookieName as cookieName, unauthorized } from '../auth/staff-web.js';
import { registerTeacherAccountLink } from '../auth/account-links.js';
import { registerStaffHomework } from '../homework/staff-routes.js';
import { registerTeacherMessages } from '../messaging/routes.js';
import { registerTeacherLiaison } from '../liaison/routes.js';
import { registerTeacherBlog } from '../blog/routes.js';
import { registerTeacherPhotoAuthorizations } from '../photo-authorizations/routes.js';
import { registerSchoolBanner } from '../school-banner/routes.js';
import { registerTeacherAttendance } from '../attendance/routes.js';
import { registerTeacherReports } from '../school-reports/routes.js';
import { registerHomeworkAttachments } from '../homework/attachments.js';
import { registerStaffMedia } from '../files/class-media.js';
import {
  activateTeacher, canTeachClass, signInTeacher, signOutTeacher, teacherActivationPattern,
  teacherLoginPattern, teacherSessionSeconds, teacherNativeSessionSeconds, withTeacherSession, renewTeacherSession, openTeacherSession,
} from './store.js';

const credentials = {
  schoolCode: { type: 'string', pattern: schoolCodePattern.source },
  login: { type: 'string', pattern: teacherLoginPattern.source },
  password: { type: 'string', ...passwordLimits },
};

function credentialsOptions(properties) {
  return {
    bodyLimit: 2048,
    config: authRateLimit,
    schema: {
      body: { type: 'object', required: Object.keys(properties), additionalProperties: false, properties },
    },
  };
}

export async function teacherRoutes(app, { pool, webOrigin, blogMediaKey, classMediaQuota, invitationKey }) {
  const { tokenFor, authenticated } = await registerStaffWeb(app, {
    webOrigin, cookieName, withSession: (token, operation) => withTeacherSession(pool, token, operation),
  });

  app.post('/teacher/auth/activate', credentialsOptions({
    ...credentials, code: { type: 'string', pattern: teacherActivationPattern.source },
  }), async (request, reply) => {
    if (!await activateTeacher(pool, request.body)) return unauthorized(reply);
    return reply.code(204).send();
  });

  async function openSession(request, reply, input) {
    const native = nativeStaffClient(request);
    const seconds = native ? teacherNativeSessionSeconds : teacherSessionSeconds;
    const token = await signInTeacher(pool, input, seconds);
    if (!token) return unauthorized(reply);
    if (native) return reply.send({ state: 'active', token });
    return reply.setCookie(cookieName, token, { ...cookieOptions, maxAge: seconds }).code(204).send();
  }

  app.post('/teacher/auth/login', credentialsOptions(credentials), (request, reply) => openSession(request, reply, request.body));
  app.post('/teacher/auth/claim', credentialsOptions({
    schoolCode: credentials.schoolCode, password: credentials.password, code: { type: 'string', pattern: teacherActivationPattern.source },
  }), async (request, reply) => {
    const login = await activateTeacher(pool, request.body);
    if (!login) return unauthorized(reply);
    return openSession(request, reply, { ...request.body, login });
  });

  registerAccountDevices(app, '/teacher', { role: 'teacher', authenticated, key: invitationKey });
  if (invitationKey) app.post('/teacher/auth/device-link', credentialsOptions({
    schoolCode: credentials.schoolCode, code: { type: 'string', pattern: deviceCodePatterns.teacher },
  }), async (request, reply) => {
    const { schoolCode, code } = request.body;
    const native = nativeStaffClient(request);
    const seconds = native ? teacherNativeSessionSeconds : teacherSessionSeconds;
    const token = await transaction(pool, (db) => redeemDevicePair(db, invitationKey, 'teacher', schoolCode, code, async (schoolId, teacherId) => {
      const result = await openTeacherSession(db, schoolId, teacherId, seconds);
      await markDevice(db, 'teacher', refreshDigest(result), deviceMetadata(request));
      return result;
    }));
    if (!token) return unauthorized(reply);
    if (native) return reply.send({ state: 'active', token });
    return reply.setCookie(cookieName, token, { ...cookieOptions, maxAge: seconds }).code(204).send();
  });

  app.get('/teacher/auth/state', async (request, reply) => {
    const token = tokenFor(request);
    if (!token) return { state: 'login' };
    const result = await withTeacherSession(pool, token, (_db, actor) => ({
      state: 'active', schoolCode: actor.school_code, schoolName: actor.school_name,
    }));
    if (!result.authorized) return { state: 'login' };
    const native = nativeStaffClient(request);
    const seconds = native ? teacherNativeSessionSeconds : teacherSessionSeconds;
    await renewTeacherSession(pool, token, seconds);
    await markDevice(pool, 'teacher', refreshDigest(token), deviceMetadata(request));
    if (!native) reply.setCookie(cookieName, token, { ...cookieOptions, maxAge: seconds });
    return result.value;
  });

  app.post('/teacher/auth/logout', async (request, reply) => {
    const token = tokenFor(request);
    if (token) await signOutTeacher(pool, token);
    return reply.clearCookie(cookieName, cookieOptions).code(204).send();
  });

  app.get('/teacher/classes', authenticated(async (_request, db, actor) => {
    const { rows } = await db.query(`
      SELECT c.id, c.name
      FROM teacher_classes t JOIN classes c ON (c.school_id, c.id) = (t.school_id, t.class_id)
      WHERE t.school_id = $1 AND t.teacher_id = $2 AND c.archived_year IS NULL ORDER BY c.name, c.id
    `, [actor.school_id, actor.teacher_id]);
    return { schoolName: actor.school_name ?? actor.school_code, classes: rows };
  }));

  registerTeacherTemplates(app, authenticated);
  registerStaffActivities(app, '/teacher', authenticated, blogMediaKey);
  registerStaffPlannedAbsences(app, '/teacher', authenticated);
  registerStaffHomework(app, '/teacher', authenticated, canTeachClass);
  registerStaffAgenda(app, '/teacher', authenticated, canTeachClass);
  registerTeacherMessages(app, authenticated, blogMediaKey);
  registerHomeworkAttachments(app, '/teacher', authenticated, blogMediaKey);
  registerStaffMedia(app, '/teacher', authenticated, blogMediaKey, classMediaQuota);
  registerTeacherLiaison(app, authenticated);
  registerTeacherBlog(app, { authenticated, mediaKey: blogMediaKey, tokenFor, unauthorized });
  registerTeacherPhotoAuthorizations(app, authenticated);
  registerSchoolBanner(app, '/teacher', authenticated);
  registerTeacherAttendance(app, authenticated);
  registerTeacherReports(app, authenticated);
  registerTeacherAccountLink(app, authenticated);
}
