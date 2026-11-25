import { randomUUID } from 'node:crypto';

const fields = 'title, text_color AS "textColor", background_color AS "backgroundColor", revision';

export async function readSchoolBanner(db, schoolId) {
  const { rows: [banner] } = await db.query(`
    SELECT ${fields} FROM school_banners WHERE school_id = $1
  `, [schoolId]);
  return { banner: banner ?? null };
}

function luminance(color) {
  const channels = [1, 3, 5].map((index) => {
    const value = Number.parseInt(color.slice(index, index + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

export function hasReadableContrast(textColor, backgroundColor) {
  const foreground = luminance(textColor);
  const background = luminance(backgroundColor);
  return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05) >= 4.5;
}

export async function changeSchoolBanner(db, schoolId, revision, next) {
  const school = await db.query('SELECT id FROM schools WHERE id = $1 FOR UPDATE', [schoolId]);
  if (!school.rowCount) return null;
  const { banner: current } = await readSchoolBanner(db, schoolId);
  if ((current?.revision ?? null) !== revision) {
    throw Object.assign(new Error('Le bandeau a changé.'), { statusCode: 409 });
  }
  if (!next) {
    if (current) await db.query('DELETE FROM school_banners WHERE school_id = $1', [schoolId]);
    return { banner: null };
  }
  if (current && current.title === next.title && current.textColor === next.textColor
      && current.backgroundColor === next.backgroundColor) return { banner: current };

  const { rows: [banner] } = await db.query(`
    INSERT INTO school_banners (school_id, title, text_color, background_color, revision)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (school_id) DO UPDATE
      SET title = excluded.title, text_color = excluded.text_color, background_color = excluded.background_color,
        revision = excluded.revision
    RETURNING ${fields}
  `, [schoolId, next.title, next.textColor, next.backgroundColor, randomUUID()]);
  return { banner };
}
