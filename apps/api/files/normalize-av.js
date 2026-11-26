import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const maxMediaBytes = 24 * 1024 * 1024;
export const mediaEncoded = { type: 'string', minLength: 4, maxLength: Math.ceil(maxMediaBytes / 3) * 4,
  pattern: '^[A-Za-z0-9+/]+={0,2}$' };

function format(bytes, kind) {
  if (kind === 'video') {
    if (bytes.toString('ascii', 4, 8) === 'ftyp') return 'mov';
    if (bytes.subarray(0, 4).equals(Buffer.from([26, 69, 223, 163]))) return 'matroska';
  } else {
    if (bytes.toString('ascii', 0, 3) === 'ID3' || (bytes[0] === 255 && (bytes[1] & 224) === 224)) return 'mp3';
    if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WAVE') return 'wav';
  }
  throw Object.assign(new Error('Format média non valide.'), { statusCode: 415 });
}

export async function normalizeAV(content, kind) {
  const bytes = Buffer.from(content, 'base64');
  if (bytes.length > maxMediaBytes || bytes.toString('base64') !== content) {
    throw Object.assign(new Error('Contenu média non valide.'), { statusCode: 413 });
  }
  const input = format(bytes, kind);
  const temporary = await mkdtemp(join(tmpdir(), 'open-cartable-media-'));
  try {
    const filename = join(temporary, 'source');
    await writeFile(filename, bytes, { mode: 0o600 });
    return await encode(filename, input, kind);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

function encode(filename, input, kind) {
  const video = ['-map', '0:v:0', '-map', '0:a:0?', '-vf', 'scale=960:540:force_original_aspect_ratio=decrease:force_divisible_by=2,fps=25',
    '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+frag_keyframe+empty_moov', '-f', 'mp4'];
  const audio = ['-map', '0:a:0', '-c:a', 'libmp3lame', '-b:a', '96k', '-f', 'mp3'];
  return new Promise((resolve, reject) => {
    const job = spawn('ffmpeg', ['-v', 'error', '-nostdin', '-protocol_whitelist', 'file,pipe', '-max_alloc', '67108864',
      '-threads', '1', '-filter_threads', '1', '-f', input,
      ...(input === 'mov' ? ['-enable_drefs', '0', '-use_absolute_path', '0'] : []), '-i', filename, '-t', '120', '-sn', '-dn',
      '-map_metadata', '-1', '-map_chapters', '-1', ...(kind === 'video' ? video : audio), '-threads', '1', 'pipe:1'],
    { stdio: ['ignore', 'pipe', 'ignore'] });
    const clock = setTimeout(() => job.kill('SIGKILL'), 45_000);
    const parts = [];
    let size = 0;
    job.on('error', () => {
      clearTimeout(clock);
      reject(Object.assign(new Error('Conversion des médias indisponible.'), { statusCode: 503 }));
    });
    job.stdout.on('data', (part) => {
      size += part.length;
      if (size > maxMediaBytes) job.kill('SIGKILL');
      else parts.push(part);
    });
    job.on('close', (status) => {
      clearTimeout(clock);
      if (status === 0 && parts.length && size <= maxMediaBytes) resolve({ kind, bytes: Buffer.concat(parts) });
      else reject(Object.assign(new Error('Média illisible ou trop volumineux.'), { statusCode: size > maxMediaBytes ? 413 : 415 }));
    });
  });
}
