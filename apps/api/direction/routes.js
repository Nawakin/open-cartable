import { registerStaffAgenda } from '../agenda/staff-routes.js';
import { schoolCodePattern, uuidPattern } from '../auth/credentials.js';
import { passwordLimits } from '../auth/password.js';
import { authRateLimit, cookieOptions, registerStaffWeb, unauthorized, uuidParams } from '../auth/staff-web.js';
import { registerStaffHomework } from '../homework/staff-routes.js';
import { registerDirectionMessages } from '../messaging/routes.js';
import { registerDirectionPhotoAuthorizations } from '../photo-authorizations/routes.js';
import { registerSchoolBanner } from '../school-banner/routes.js';
import { registerDirectionAttendance } from '../attendance/routes.js';
import { registerDirectionJustifications } from '../attendance/justifications.js';
import { registerDirectionReports } from '../school-reports/routes.js';
import { registerLsuExport } from '../school-reports/lsu-routes.js';
import { registerHomeworkAttachments } from '../homework/attachments.js';
import { registerStaffMedia } from '../files/class-media.js';
import { registerYearTransition } from '../year-transition/routes.js';
import { registerSchoolDirectory } from './directory.js';
import { registerBlogExport } from '../blog/export-routes.js';
import { registerDirectionSecurity } from './security-routes.js';
import { authenticatorCode } from './totp.js';
import { createTeacher, deleteTeacher, listTeachers, resetTeacher, teacherLoginPattern, updateTeacherClasses } from '../teacher/store.js';
import { needsAuthenticator, signInDirection, signOutDirection, withDirectionSession } from './store.js';
import { deviceFor, directionDeviceCookie, registerDirectionAccess, sendDirectionSession } from './access.js';

const cookieName = '__Host-open-cartable-direction';
const teacherParams = uuidParams('teacherId');
const classIds = { type: 'array', maxItems: 100, uniqueItems: true, items: { type: 'string', pattern: uuidPattern.source } };

export async function directionRoutes(app, { pool, webOrigin, blogMediaKey, mailer, totpKey, invitationKey, classMediaQuota, requireTotp = false }) {
  const { tokenFor, authenticated } = await registerStaffWeb(app, {
    webOrigin, cookieName, withSession: (token, operation, options) => withDirectionSession(pool, token, operation, { ...options, requireTotp }),
  });

  app.post('/direction/auth/login', {
    bodyLimit: 2048,
    config: authRateLimit,
    schema: {
      body: {
        type: 'object', required: ['schoolCode', 'password'], additionalProperties: false,
        properties: {
          schoolCode: { type: 'string', pattern: schoolCodePattern.source },
          password: { type: 'string', ...passwordLimits },
          code: authenticatorCode,
        },
      },
    },
  }, async (request, reply) => {
    const { schoolCode, password, code } = request.body;
    const session = await signInDirection(pool, schoolCode, password, code, totpKey, { requireTotp, deviceToken: deviceFor(request) });
    if (session === needsAuthenticator) return reply.code(428).send({ error: 'Code de double authentification requis.' });
    if (!session) return unauthorized(reply);
    return sendDirectionSession(request, reply, session, cookieName);
  });

  app.post('/direction/auth/logout', async (request, reply) => {
    const token = tokenFor(request);
    const device = deviceFor(request);
    if (token || device) await signOutDirection(pool, token, device);
    return reply.clearCookie(cookieName, cookieOptions).clearCookie(directionDeviceCookie, cookieOptions).code(204).send();
  });

  app.get('/direction/classes', authenticated(async (_request, db, school) => {
    const { rows } = await db.query('SELECT id, name FROM classes WHERE school_id = $1 AND archived_year IS NULL ORDER BY name, id',
      [school.school_id]);
    return { schoolName: school.school_name ?? school.school_code, classes: rows };
  }));

  registerStaffHomework(app, '/direction', authenticated);
  registerStaffAgenda(app, '/direction', authenticated);
  registerDirectionMessages(app, authenticated, blogMediaKey);
  registerHomeworkAttachments(app, '/direction', authenticated, blogMediaKey);
  registerStaffMedia(app, '/direction', authenticated, blogMediaKey, classMediaQuota);
  registerDirectionPhotoAuthorizations(app, authenticated);
  registerSchoolBanner(app, '/direction', authenticated);
  registerDirectionAttendance(app, authenticated);
  registerDirectionJustifications(app, authenticated, blogMediaKey);
  registerDirectionReports(app, authenticated);
  registerLsuExport(app, authenticated);
  registerYearTransition(app, authenticated);
  registerSchoolDirectory(app, authenticated, invitationKey);
  registerBlogExport(app, authenticated, blogMediaKey);
  registerDirectionAccess(app, { pool, tokenFor, totpKey, requireTotp, cookieName });
  registerDirectionSecurity(app, { pool, tokenFor, authenticated, mailer, totpKey, cookieName, requireTotp });

  app.get('/direction/teachers', authenticated(async (_request, db, actor) => ({
    teachers: await listTeachers(db, actor.school_id),
  })));

  app.post('/direction/teachers', {
    bodyLimit: 8192,
    schema: {
      body: {
        type: 'object', required: ['login', 'classIds'], additionalProperties: false,
        properties: {
          login: { type: 'string', pattern: teacherLoginPattern.source },
          classIds: { ...classIds, minItems: 1 },
        },
      },
    },
  }, authenticated((request, db, actor) => {
    const { login, classIds } = request.body;
    return createTeacher(db, actor.school_id, login, classIds);
  }, 201));

  app.put('/direction/teachers/:teacherId/classes', {
    bodyLimit: 8192,
    schema: {
      params: teacherParams,
      body: { type: 'object', required: ['classIds'], additionalProperties: false, properties: { classIds } },
    },
  }, authenticated(async (request, db, actor) => {
    const updated = await updateTeacherClasses(db, actor.school_id, request.params.teacherId, request.body.classIds);
    return updated ? undefined : null;
  }, 204));

  app.post('/direction/teachers/:teacherId/activation', { schema: { params: teacherParams } },
    authenticated((request, db, actor) => resetTeacher(db, actor.school_id, request.params.teacherId)));

  app.delete('/direction/teachers/:teacherId', { schema: { params: teacherParams } },
    authenticated(async (request, db, actor) => {
      const removed = await deleteTeacher(db, actor.school_id, request.params.teacherId);
      return removed ? undefined : null;
    }, 204));
}
