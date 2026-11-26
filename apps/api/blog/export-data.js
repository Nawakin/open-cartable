import { exportGallery, hasPublicPhoto } from './photos.js';

const articleLimit = 300;
const mediaLimit = 48 * 1024 * 1024;

export function exportPeriod({ year: value, month }) {
  const year = Number(value);
  if (year < 1900 || year > 9998) return null;
  const yearFrom = year + '-09-01';
  const yearTo = (year + 1) + '-09-01';
  if (!month) return { year, month: null, from: yearFrom, to: yearTo };
  const from = month + '-01';
  if (from < yearFrom || from >= yearTo) return null;
  const [calendarYear, calendarMonth] = month.split('-').map(Number);
  const to = new Date(Date.UTC(calendarYear, calendarMonth, 1)).toISOString().slice(0, 10);
  return { year, month, from, to };
}

export async function readBlogExport(db, [schoolId, classId], period) {
  const { rows: [classroom] } = await db.query('SELECT name FROM classes WHERE (school_id, id) = ($1, $2)', [schoolId, classId]);
  if (!classroom) return null;
  const { rows } = await db.query(`
    WITH selected AS (
      SELECT id, title, body, version, school_id, published_at, count(*) OVER()::integer AS total
      FROM class_blog_articles a
      WHERE (school_id, class_id) = ($1, $2)
        AND published_at >= ($3::date::timestamp AT TIME ZONE 'Europe/Paris')
        AND published_at < ($4::date::timestamp AT TIME ZONE 'Europe/Paris')
        AND (a.body <> '' OR ${hasPublicPhoto('a', true)})
      ORDER BY published_at, id LIMIT $5
    )
    SELECT id, title, body, version, published_at AS "publishedAt", total, ${exportGallery()} AS photos
    FROM selected a ORDER BY published_at, id
  `, [schoolId, classId, period.from, period.to, articleLimit]);
  const articleCount = rows[0]?.total ?? 0;
  let bytes = 0;
  let photoCount = 0;
  const articles = rows.map(({ total, ...article }) => {
    article.photos.forEach(({ fullBytes, thumbBytes }, index) => { bytes += index === 0 ? fullBytes : thumbBytes; });
    photoCount += article.photos.length;
    return article;
  });
  const tooLarge = articleCount > articleLimit || bytes > mediaLimit;
  return { className: classroom.name, articles, articleCount, photoCount: articleCount > articleLimit ? null : photoCount, tooLarge };
}
