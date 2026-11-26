import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFStream } from 'pdf-lib';
import { prepareImage } from '../blog/images.js';

export const maxPrivateFileBytes = 5 * 1024 * 1024;
export const privateFileBody = {
  type: 'object', additionalProperties: false, required: ['content'],
  properties: { content: { type: 'string', minLength: 4, maxLength: Math.ceil(maxPrivateFileBytes / 3) * 4,
    pattern: '^[A-Za-z0-9+/]+={0,2}$' } },
};
export const privateFileBodyLimit = Math.ceil(maxPrivateFileBytes / 3) * 4 + 1024;

const unsafePdf = new Set(['AA', 'OpenAction', 'JavaScript', 'JS', 'EmbeddedFiles', 'EmbeddedFile', 'Filespec',
  'Launch', 'RichMedia', 'XFA', 'AcroForm', 'SubmitForm', 'ImportData', 'Sound', 'Movie', 'GoToR', 'GoToE', 'URI']);

function fail(statusCode) {
  throw Object.assign(new Error('Document non pris en charge.'), { statusCode });
}

function permittedObject(object) {
  if (object instanceof PDFName) return !unsafePdf.has(object.decodeText());
  if (object instanceof PDFStream) return permittedObject(object.dict);
  if (object instanceof PDFDict) return object.entries().every(([key, value]) => permittedObject(key) && permittedObject(value));
  if (object instanceof PDFArray) return object.asArray().every(permittedObject);
  return true;
}

export async function preparePrivateFile(content) {
  const bytes = Buffer.from(content, 'base64');
  if (!bytes.length || bytes.length > maxPrivateFileBytes || bytes.toString('base64') !== content) fail(415);
  if (bytes.subarray(0, 5).toString('ascii') !== '%PDF-') {
    return { kind: 'image', bytes: (await prepareImage(bytes)).full };
  }
  try {
    const source = await PDFDocument.load(bytes, { updateMetadata: false, throwOnInvalidObject: true });
    if (source.getPageCount() < 1 || source.getPageCount() > 40
      || !source.context.enumerateIndirectObjects().every(([, object]) => permittedObject(object))) fail(415);
    const cleaned = await PDFDocument.create();
    for (const page of await cleaned.copyPages(source, source.getPageIndices())) {
      page.node.delete(PDFName.of('Annots'));
      cleaned.addPage(page);
    }
    const pdf = Buffer.from(await cleaned.save());
    if (pdf.length > maxPrivateFileBytes) fail(413);
    return { kind: 'pdf', bytes: pdf };
  } catch (error) {
    fail(error.statusCode ?? 415);
  }
}

function fileKey(root) {
  if (!root) fail(503);
  return Buffer.from(hkdfSync('sha256', root, Buffer.alloc(0), Buffer.from('open-cartable/private-files/v1'), 32));
}

export function sealPrivateFile(bytes, root, scope) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', fileKey(root), nonce);
  cipher.setAAD(Buffer.from(scope.join('/')));
  const encrypted = Buffer.concat([cipher.update(bytes), cipher.final()]);
  return Buffer.concat([nonce, cipher.getAuthTag(), encrypted]);
}

export function openPrivateFile(data, root, scope) {
  const cipher = createDecipheriv('aes-256-gcm', fileKey(root), data.subarray(0, 12));
  cipher.setAAD(Buffer.from(scope.join('/')));
  cipher.setAuthTag(data.subarray(12, 28));
  return Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]);
}

export function privateFileHeaders(reply, kind, filename) {
  const { type, suffix } = {
    pdf: { type: 'application/pdf', suffix: 'pdf' }, image: { type: 'image/jpeg', suffix: 'jpg' },
    video: { type: 'video/mp4', suffix: 'mp4' }, audio: { type: 'audio/mpeg', suffix: 'mp3' },
  }[kind];
  return reply.type(type)
    .header('Content-Disposition', `attachment; filename="${filename}.${suffix}"`)
    .header('X-Content-Type-Options', 'nosniff');
}
