import { registerStaffAgenda } from '../agenda/staff-routes.js';
import { schoolCodePattern } from '../auth/credentials.js';
import { passwordLimits } from '../auth/password.js';
import { authRateLimit, cookieOptions, registerStaffWeb, unauthorized } from '../auth/staff-web.js';
import { registerStaffHomework } from '../homework/staff-routes.js';
import { registerTeacherMessages } from '../messaging/routes.js';
import { registerTeacherLiaison } from '../liaison/routes.js';
import { registerTeacherBlog } from '../blog/routes.js';
import {
  activateTeacher, canTeachClass, signInTeacher, signOutTeacher, teacherActivationPattern,
  teacherLoginPattern, teacherSessionSeconds, withTeacherSession,
} from './store.js';

const cookieName = '__Host-open-cartable-teacher';
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

export async function teacherRoutes(app, { pool, webOrigin }) {
  const { tokenFor, authenticated } = await registerStaffWeb(app, {
    webOrigin, cookieName, withSession: (token, operation) => withTeacherSession(pool, token, operation),
  });

  app.post('/teacher/auth/activate', credentialsOptions({
    ...credentials, code: { type: 'string', pattern: teacherActivationPattern.source },
  }), async (request, reply) => {
    if (!await activateTeacher(pool, request.body)) return unauthorized(reply);
    return reply.code(204).send();
  });

  app.post('/teacher/auth/login', credentialsOptions(credentials), async (request, reply) => {
    const token = await signInTeacher(pool, request.body);
    if (!token) return unauthorized(reply);
    return reply.setCookie(cookieName, token, { ...cookieOptions, maxAge: teacherSessionSeconds }).code(204).send();
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
      WHERE t.school_id = $1 AND t.teacher_id = $2 ORDER BY c.name, c.id
    `, [actor.school_id, actor.teacher_id]);
    return { schoolName: actor.school_name ?? actor.school_code, classes: rows };
  }));

  registerStaffHomework(app, '/teacher', authenticated, canTeachClass);
  registerStaffAgenda(app, '/teacher', authenticated, canTeachClass);
  registerTeacherMessages(app, authenticated);
  registerTeacherLiaison(app, authenticated);
  registerTeacherBlog(app, authenticated);
}
