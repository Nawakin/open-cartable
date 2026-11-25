import { openDatabase } from '../apps/api/db/database.js';
import { readSecret } from '../apps/api/installation/secrets.js';
import { isInstalled } from '../apps/api/installation/setup.js';

const pool = openDatabase(process.env.DATABASE_URL);
try {
  const url = new URL(process.env.WEB_ORIGIN);
  if (!await isInstalled(pool)) url.hash = 'installation=' + readSecret(process.env, 'INSTALLATION_TOKEN');
  process.stdout.write(url.href + '\n');
} finally {
  await pool.end();
}
