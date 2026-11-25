import { uuidPattern } from '../auth/credentials.js';
import { changeSchoolBanner, hasReadableContrast, readSchoolBanner } from './store.js';

const revision = { anyOf: [{ type: 'string', pattern: uuidPattern.source }, { type: 'null' }] };
const color = { type: 'string', minLength: 7, maxLength: 7, pattern: '^#[a-fA-F0-9]{6}$' };

function bodySchema(properties) {
  return { type: 'object', required: Object.keys(properties), additionalProperties: false, properties };
}

export function registerSchoolBanner(app, prefix, authenticated) {
  const path = prefix + '/school-banner';
  app.get(path, authenticated((_request, db, actor) => readSchoolBanner(db, actor.school_id)));
  if (prefix !== '/direction') return;

  app.put(path, {
    bodyLimit: 2048,
    schema: { body: bodySchema({
      title: { type: 'string', minLength: 1, maxLength: 64 }, textColor: color, backgroundColor: color, revision,
    }) },
  }, authenticated((request, db, actor) => {
    const title = request.body.title.trim();
    const textColor = request.body.textColor.toLowerCase();
    const backgroundColor = request.body.backgroundColor.toLowerCase();
    if (!title || /[\p{Cc}\u2028\u2029]/u.test(title)) {
      throw Object.assign(new Error('Texte du bandeau non valide.'), { statusCode: 400 });
    }
    if (!hasReadableContrast(textColor, backgroundColor)) {
      throw Object.assign(new Error('Contraste du bandeau insuffisant.'), { statusCode: 422 });
    }
    return changeSchoolBanner(db, actor.school_id, request.body.revision, { title, textColor, backgroundColor });
  }));

  app.delete(path, { bodyLimit: 1024, schema: { body: bodySchema({ revision }) } },
    authenticated((request, db, actor) => changeSchoolBanner(db, actor.school_id, request.body.revision, null)));
}
