import { registerStaffAgenda } from '../agenda/staff-routes.js';
import { schoolCodePattern, uuidPattern } from '../auth/credentials.js';
import { passwordLimits } from '../auth/password.js';
import { authRateLimit, cookieOptions, registerStaffWeb, unauthorized, uuidParams } from '../auth/staff-web.js';
import { registerStaffHomework } from '../homework/staff-routes.js';
import { registerDirectionMessages } from '../messaging/routes.js';
import { registerDirectionPhotoAuthorizations } from '../photo-authorizations/routes.js';
import { registerSchoolBanner } from '../school-banner/routes.js';
import { registerDirectionAttendance } from '../attendance/routes.js';
import { registerYearTransition } from '../year-transition/routes.js';
import { registerBlogExport } from '../blog/export-routes.js';
import { createTeacher, deleteTeacher, listTeachers, resetTeacher, teacherLoginPattern, updateTeacherClasses } from '../teacher/store.js';
import { directionSessionSeconds, signInDirection, signOutDirection, withDirectionSession } from './store.js';

const cookieName = '__Host-open-cartable-direction';
const teacherParams = uuidParams('teacherId');
const classIds = { type: 'array', maxItems: 100, uniqueItems: true, items: { type: 'string', pattern: uuidPattern.source } };

export async function directionRoutes(app, { pool, webOrigin, blogMediaKey }) {
  const { tokenFor, authenticated } = await registerStaffWeb(app, {
    webOrigin, cookieName, withSession: (token, operation) => withDirectionSession(pool, token, operation),
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
        },
      },
    },
  }, async (request, reply) => {
    const { schoolCode, password } = request.body;
    const token = await signInDirection(pool, schoolCode, password);
    if (!token) return unauthorized(reply);
    return reply.setCookie(cookieName, token, { ...cookieOptions, maxAge: directionSessionSeconds }).code(204).send();
  });

  app.post('/direction/auth/logout', async (request, reply) => {
    const token = tokenFor(request);
    if (token) await signOutDirection(pool, token);
    return reply.clearCookie(cookieName, cookieOptions).code(204).send();
  });

  app.get('/direction/classes', authenticated(async (_request, db, school) => {
    const { rows } = await db.query('SELECT id, name FROM classes WHERE school_id = $1 ORDER BY name, id', [school.school_id]);
    return { schoolName: school.school_name ?? school.school_code, classes: rows };
  }));

  registerStaffHomework(app, '/direction', authenticated);
  registerStaffAgenda(app, '/direction', authenticated);
  registerDirectionMessages(app, authenticated);
  registerDirectionPhotoAuthorizations(app, authenticated);
  registerSchoolBanner(app, '/direction', authenticated);
  registerDirectionAttendance(app, authenticated);
  registerYearTransition(app, authenticated);
  registerBlogExport(app, authenticated, blogMediaKey);

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
