import { access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { buildApp } from './app.js';
import { readAuthKeys } from './auth/credentials.js';
import { createParentStore } from './auth/parent-store.js';
import { migrate, migrations, openDatabase } from './db/database.js';
import { readSecret } from './installation/secrets.js';
import { startRetention } from './db/retention.js';
import { createRecoveryMailer } from './direction/recovery-mail.js';

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
  const mediaSecret = readSecret(env, 'BLOG_MEDIA_KEY');
  if (mediaSecret !== undefined && !/^[0-9a-f]{64}$/.test(mediaSecret)) {
    throw new Error('La clé de chiffrement des photos doit contenir 64 caractères hexadécimaux.');
  }
  let parentAuth;
  let webRoot;
  let installation;
  const token = readSecret(env, 'INSTALLATION_TOKEN');
  const webOrigin = env.WEB_ORIGIN === undefined ? undefined : readWebOrigin(env.WEB_ORIGIN);
  if (token !== undefined && (!webOrigin || !/^[0-9a-f]{64}$/.test(token))) {
    throw new Error('La configuration de l’installation web est invalide.');
  }
  if (webOrigin) {
    webRoot = fileURLToPath(new URL('../mobile/dist/', import.meta.url));
    await access(new URL('../mobile/dist/index.html', import.meta.url)).catch(() => {
      throw new Error('L’export web est absent. Exécuter npm run build:web.');
    });
  }
  if ([env.DATABASE_URL, env.PGPASSWORD_FILE, env.AUTH_SIGNING_KEY, env.AUTH_SIGNING_KEY_FILE,
    env.AUTH_INVITE_KEY, env.AUTH_INVITE_KEY_FILE, webOrigin].some((value) => value !== undefined)) {
    const { signingKey, invitationKey } = readAuthKeys(env);
    pool = openDatabase(env.DATABASE_URL);
    pool.on('error', () => console.error('Une connexion PostgreSQL inactive a été interrompue.'));
    if (env.OPEN_CARTABLE_AUTO_MIGRATE === '1') await migrate(pool);
    const requiredMigrations = webOrigin ? migrations : migrations.filter((name) => name !== '002-browser-sessions.sql');
    const schema = await pool.query('SELECT 1 FROM schema_migrations WHERE name = ANY($1::text[])', [requiredMigrations])
      .catch(() => null);
    if (schema?.rowCount !== requiredMigrations.length) throw new Error('PostgreSQL est inaccessible ou des migrations doivent être exécutées.');
    parentAuth = { signingKey, store: createParentStore(pool, invitationKey), webOrigin };
    if (token) installation = { pool, token, invitationKey, webOrigin };
  }
  const securitySecret = readSecret(env, 'DIRECTION_TOTP_KEY');
  if (securitySecret !== undefined && !/^[0-9a-f]{64}$/.test(securitySecret)) {
    throw new Error('La clé de double authentification doit contenir 64 caractères hexadécimaux.');
  }
  const totpKey = securitySecret === undefined ? undefined : Buffer.from(securitySecret, 'hex');
  const mailer = createRecoveryMailer({
    url: readSecret(env, 'DIRECTION_SMTP_URL'), from: env.DIRECTION_SMTP_FROM, webOrigin,
  });
  const direction = webOrigin ? { pool, webOrigin, totpKey, mailer } : undefined;
  const blogMediaKey = mediaSecret === undefined ? undefined : Buffer.from(mediaSecret, 'hex');
  const app = buildApp({ parentAuth, webRoot, installation, direction, blogMediaKey });
  let stopRetention;
  if (pool) app.addHook('onClose', async () => {
    await stopRetention?.();
    await pool.end();
  });
  const address = await app.listen({ host: env.OPEN_CARTABLE_HOST ?? '127.0.0.1', port: 3000 });
  if (pool) stopRetention = startRetention(pool);
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
