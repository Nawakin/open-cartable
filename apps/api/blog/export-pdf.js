import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { buffer } from 'node:stream/consumers';
import PDFDocument from 'pdfkit';

const require = createRequire(import.meta.url);
const regular = readFileSync(require.resolve('@fontsource/noto-sans/files/noto-sans-latin-400-normal.woff'));
const bold = readFileSync(require.resolve('@fontsource/noto-sans/files/noto-sans-latin-700-normal.woff'));
const dateLabel = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long', timeZone: 'Europe/Paris' });
const monthLabel = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const margin = 48;
const green = '#17372d';
const ink = '#263a31';

function contentWidth(doc) {
  return doc.page.width - margin * 2;
}

function addCover(doc, className, period) {
  doc.addPage();
  const width = contentWidth(doc);
  const year = period.year + '–' + (period.year + 1);
  doc.rect(0, 0, doc.page.width, doc.page.height).fill(green);
  doc.rect(margin, 207, 52, 4).fill('#ffe0a1');
  doc.font('Bold').fontSize(16).fillColor('#ffe0a1').text('BLOG DE CLASSE', margin, 236);
  doc.font('Bold').fontSize(34).fillColor('#fffdf6').text(className, { width });
  doc.moveDown(0.7).font('Regular').fontSize(18).text('Année scolaire ' + year, { width });
  if (period.month) doc.moveDown(0.4).fontSize(15).text(monthLabel.format(new Date(period.from + 'T00:00:00Z')), { width });
}

async function addPhotos(doc, photos, read, width, height) {
  const captions = photos.map(({ description }) => description);
  doc.font('Regular').fontSize(9);
  const captionHeight = Math.max(0, ...captions.map((text) => text ? doc.heightOfString(text, { width }) : 0));
  if (doc.y + height + captionHeight + 19 > doc.page.height - margin) doc.addPage();
  const y = doc.y;
  for (const [index, photo] of photos.entries()) {
    const x = margin + index * (width + 12);
    doc.roundedRect(x, y, width, height, 5).fill('#edf1eb');
    doc.image(await read(photo), x, y, { fit: [width, height], align: 'center', valign: 'center' });
    if (photo.description) doc.fillColor(ink).text(photo.description, x, y + height + 5, { width });
  }
  doc.x = margin;
  doc.y = y + height + captionHeight + 19;
}

export async function makeBlogPdf(selection, period, readImage) {
  const doc = new PDFDocument({
    autoFirstPage: false, size: 'A4', margin,
    info: { Title: 'Blog de classe · ' + selection.className, Subject: String(period.year) },
  });
  const output = buffer(doc);
  output.catch(() => {});
  try {
    doc.registerFont('Regular', regular);
    doc.registerFont('Bold', bold);
    addCover(doc, selection.className, period);
    for (const article of selection.articles) {
      doc.addPage();
      const width = contentWidth(doc);
      doc.font('Regular').fontSize(11).fillColor('#466657').text(dateLabel.format(article.publishedAt));
      doc.moveDown(0.6).font('Bold').fontSize(23).fillColor(green).text(article.title, { width });
      doc.moveDown(0.6);
      if (article.photos.length) {
        await addPhotos(doc, article.photos.slice(0, 1), (photo) => readImage(article.id, photo.id, 'full'), width, 285);
      }
      if (article.body) {
        doc.font('Regular').fontSize(11).fillColor(ink).text(article.body, { width, lineGap: 4 });
        doc.moveDown(0.7);
      }
      for (let index = 1; index < article.photos.length; index += 2) {
        await addPhotos(doc, article.photos.slice(index, index + 2), (photo) => readImage(article.id, photo.id, 'thumb'),
          (width - 12) / 2, 165);
      }
    }
    doc.end();
    return await output;
  } finally {
    if (!doc.readableEnded) doc.destroy();
  }
}
