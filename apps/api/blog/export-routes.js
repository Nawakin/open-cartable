import { uuidParams } from '../auth/staff-web.js';
import { exportPeriod, readBlogExport } from './export-data.js';
import { makeBlogPdf } from './export-pdf.js';
import { readPhoto } from './photos.js';

const query = {
  type: 'object', required: ['year'], additionalProperties: false,
  properties: {
    year: { type: 'string', minLength: 4, maxLength: 4, pattern: '^[0-9]{4}$' },
    month: { type: 'string', minLength: 7, maxLength: 7, pattern: '^[0-9]{4}-(0[1-9]|1[0-2])$' },
  },
};

function fail(statusCode) {
  throw Object.assign(new Error('Export PDF du blog indisponible.'), { statusCode });
}

export function registerBlogExport(app, authenticated, mediaKey) {
  const path = '/direction/classes/:classId/blog-export';
  const schema = { params: uuidParams('classId'), querystring: query };
  function forClass(operation) {
    return authenticated(async (request, db, actor) => {
      const period = exportPeriod(request.query);
      if (!period) fail(400);
      return operation(db, [actor.school_id, request.params.classId], period);
    });
  }
  app.get(path, { schema }, forClass(async (db, scope, period) => {
    const selection = await readBlogExport(db, scope, period);
    if (!selection) return null;
    const { articles, ...summary } = selection;
    return {
      ...summary,
      articles: articles.slice(0, 20).map(({ id, title, publishedAt, photos }) => ({
        id, title, publishedAt, photoCount: photos.length,
      })),
    };
  }));

  app.post(path + '/pdf', {
    schema,
    config: { rateLimit: { max: 8, timeWindow: '1 minute' } },
    async onSend(request, reply, payload) {
      if (Buffer.isBuffer(payload) && reply.statusCode === 200) {
        const { year, month } = request.query;
        const suffix = month ?? (year + '-' + (Number(year) + 1));
        reply.type('application/pdf').header('X-Content-Type-Options', 'nosniff')
          .header('Content-Disposition', `attachment; filename="blog-${suffix}.pdf"`);
      }
      return payload;
    },
  }, forClass(async (db, scope, period) => {
    const [schoolId] = scope;
    const { rows: [{ locked }] } = await db.query(
      "SELECT pg_try_advisory_xact_lock(hashtext('blog-pdf-export'), hashtext($1)) AS locked", [schoolId],
    );
    if (!locked) fail(409);
    const selection = await readBlogExport(db, scope, period);
    if (!selection) return null;
    if (!selection.articleCount) fail(422);
    if (selection.tooLarge) fail(413);
    if (selection.photoCount && !mediaKey) fail(503);
    const pdf = await makeBlogPdf(selection, period, async (articleId, photoId, size) => {
      const image = await readPhoto(db, [...scope, articleId], photoId, size, mediaKey, true);
      if (!image) fail(409);
      return image;
    });
    // Le document reste en mémoire jusqu’au dernier contrôle des publications et des droits photo.
    const current = await readBlogExport(db, scope, period);
    if (JSON.stringify(selection) !== JSON.stringify(current)) fail(409);
    return pdf;
  }));
}
