import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import sharp from 'sharp';

export const maxImageBytes = 10 * 1024 * 1024;
export const maxPhotos = 12;
const formats = new Set(['jpeg', 'png', 'webp']);
const maxInputPixels = 26_000_000;
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function unsupported() {
  return Object.assign(new Error('Photo non prise en charge.'), { statusCode: 415 });
}

export async function prepareImage(input) {
  if (!Buffer.isBuffer(input) || !input.length || input.length > maxImageBytes) throw unsupported();
  const signature = input.subarray(0, 3).equals(Buffer.from([255, 216, 255]))
    || input.subarray(0, 8).equals(pngSignature)
    || (input.toString('ascii', 0, 4) === 'RIFF' && input.toString('ascii', 8, 12) === 'WEBP');
  if (!signature) throw unsupported();
  try {
    const source = sharp(input, { limitInputPixels: maxInputPixels, failOn: 'warning' });
    const { format, pages } = await source.metadata();
    if (!formats.has(format) || (pages ?? 1) > 1) throw unsupported();
    const oriented = source.rotate().flatten({ background: '#ffffff' });
    const full = await oriented.clone().resize(1920, 1920, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 83, mozjpeg: true }).toBuffer();
    const thumbnail = await oriented.resize(560, 560, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 78, mozjpeg: true }).toBuffer();
    return { full, thumbnail };
  } catch {
    throw unsupported();
  }
}

function context(scope, size) {
  return Buffer.from(['class-blog', ...scope, size].join('/'));
}

export function encryptImage(data, key, scope, size) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(context(scope, size));
  const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
  return Buffer.concat([nonce, cipher.getAuthTag(), encrypted]);
}

export function decryptImage(data, key, scope, size) {
  const decipher = createDecipheriv('aes-256-gcm', key, data.subarray(0, 12));
  decipher.setAAD(context(scope, size));
  decipher.setAuthTag(data.subarray(12, 28));
  return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]);
}
