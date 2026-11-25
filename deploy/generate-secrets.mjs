import { randomBytes, randomUUID } from 'node:crypto';
import { link, readFile, unlink, writeFile } from 'node:fs/promises';

async function supplySecret(path) {
  const value = await readFile(path, 'utf8').catch((error) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });

  if (value !== null) {
    if (!/^[0-9a-f]{64}$/.test(value)) throw new Error(`Secret persistant invalide dans ${path}.`);
    return;
  }

  const temporary = path + '.' + randomUUID();
  try {
    await writeFile(temporary, randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o444 });
    await link(temporary, path).catch((error) => {
      if (error.code !== 'EEXIST') throw error;
    });
  } finally {
    await unlink(temporary).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
}

for (const path of ['/postgres-admin/password', '/postgres-secrets/password', '/app-secrets/signing-key',
  '/app-secrets/invitation-key', '/app-secrets/installation-token', '/app-secrets/blog-media-key']) {
  await supplySecret(path);
}
