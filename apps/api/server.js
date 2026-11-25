import { buildApp } from './app.js';
import { readAuthKeys } from './auth/credentials.js';
import { createParentStore } from './auth/parent-store.js';
import { openDatabase } from './db/database.js';

let pool;

try {
  const env = process.env;
  let parentAuth;
  if ([env.DATABASE_URL, env.AUTH_SIGNING_KEY, env.AUTH_INVITE_KEY].some((value) => value !== undefined)) {
    const { signingKey, invitationKey } = readAuthKeys(env);
    pool = openDatabase(env.DATABASE_URL);
    pool.on('error', () => console.error('Une connexion PostgreSQL inactive a été interrompue.'));
    const schema = await pool.query('SELECT 1 FROM schema_migrations WHERE name = $1', ['001-parent-auth.sql'])
      .catch(() => null);
    if (!schema?.rowCount) throw new Error('PostgreSQL est inaccessible ou la migration initiale doit être exécutée.');
    parentAuth = { signingKey, store: createParentStore(pool, invitationKey) };
  }
  const app = buildApp({ parentAuth });
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
