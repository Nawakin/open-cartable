import { randomUUID } from 'node:crypto';
import { uuidParams } from '../auth/staff-web.js';
import { readEntry } from '../homework/entries.js';
import { invalid, plain, shape, text } from './validation.js';

const kinds = { enum: ['homework', 'liaison'] };
const templateBody = shape({
  name: text(80), kind: kinds,
  content: {
    anyOf: [
      shape({ title: text(120), domain: text(80), description: text(2500), kind: { enum: ['notebook', 'assignment'] } }),
      shape({ body: text(1000) }),
    ],
  },
});

export function registerTeacherTemplates(app, authenticated) {
  const path = '/teacher/templates';
  app.get(path, { schema: { querystring: shape({ kind: kinds }) } }, authenticated(async ({ query }, db, actor) => {
    const { rows } = await db.query(`
      SELECT id,name,content FROM teaching_templates WHERE (school_id,teacher_id,kind)=($1,$2,$3)
      ORDER BY name,id
    `, [actor.school_id, actor.teacher_id, query.kind]);
    return { templates: rows };
  }));
  app.post(path, { schema: { body: templateBody } }, authenticated(async ({ body }, db, actor) => {
    const name = plain(body.name, true);
    let content;
    if (body.kind === 'homework') {
      const entry = readEntry({ ...body.content, date: '2000-01-01' });
      if (!entry) invalid();
      const { title, domain, description, kind } = entry;
      content = { title, domain, description, kind };
    } else {
      if (typeof body.content.body !== 'string') invalid();
      content = { body: plain(body.content.body, true) };
    }
    const { rows } = await db.query(`
      INSERT INTO teaching_templates (school_id,teacher_id,id,kind,name,content)
      VALUES ($1,$2,$3,$4,$5,$6)
      ON CONFLICT (school_id,teacher_id,kind,name) DO UPDATE SET content=excluded.content
      RETURNING id
    `, [actor.school_id, actor.teacher_id, randomUUID(), body.kind, name, content]);
    return rows[0];
  }, 201));
  app.delete(path + '/:templateId', { schema: { params: uuidParams('templateId') } },
    authenticated(async ({ params }, db, actor) => {
      const result = await db.query('DELETE FROM teaching_templates WHERE (school_id,teacher_id,id)=($1,$2,$3)',
        [actor.school_id, actor.teacher_id, params.templateId]);
      return result.rowCount ? undefined : null;
    }, 204));
}
