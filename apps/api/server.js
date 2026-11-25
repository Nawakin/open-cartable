import { access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { buildApp } from './app.js';
import { readAuthKeys } from './auth/credentials.js';
import { createParentStore } from './auth/parent-store.js';
import { migrations, openDatabase } from './db/database.js';

function readWebOrigin(value) {
  const url = URL.parse(value);
  if (!url || url.origin !== value || (url.protocol !== 'https:'
    && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))) {
    throw new Error('WEB_ORIGIN doit être une origine HTTPS exacte, sans barre finale. HTTP est réservé à localhost et 127.0.0.1.');
  }
  return url.origin;
}

let pool;

try {
  const env = process.env;
  let parentAuth;
  let webRoot;
  const webOrigin = env.WEB_ORIGIN === undefined ? undefined : readWebOrigin(env.WEB_ORIGIN);
  if (webOrigin) {
    webRoot = fileURLToPath(new URL('../mobile/dist/', import.meta.url));
    await access(new URL('../mobile/dist/index.html', import.meta.url)).catch(() => {
      throw new Error('L’export web est absent. Exécuter npm run build:mobile.');
    });
  }
  if ([env.DATABASE_URL, env.AUTH_SIGNING_KEY, env.AUTH_INVITE_KEY, webOrigin].some((value) => value !== undefined)) {
    const { signingKey, invitationKey } = readAuthKeys(env);
    pool = openDatabase(env.DATABASE_URL);
    pool.on('error', () => console.error('Une connexion PostgreSQL inactive a été interrompue.'));
    const requiredMigrations = webOrigin ? migrations : migrations.slice(0, 1);
    const schema = await pool.query('SELECT 1 FROM schema_migrations WHERE name = ANY($1::text[])', [requiredMigrations])
      .catch(() => null);
    if (schema?.rowCount !== requiredMigrations.length) throw new Error('PostgreSQL est inaccessible ou des migrations doivent être exécutées.');
    parentAuth = { signingKey, store: createParentStore(pool, invitationKey), webOrigin };
  }
  const app = buildApp({ parentAuth, webRoot });
  if (pool) app.addHook('onClose', async () => pool.end());
  const address = await app.listen({ host: '127.0.0.1', port: 3000 });
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, async () => {
      try {
        await app.close();
      } catch {
        process.exitCode = 1;
      }
    });
  }
  console.info(`API disponible sur ${address}`);
} catch (error) {
  await pool?.end();
  console.error(error.message);
  process.exitCode = 1;
}
