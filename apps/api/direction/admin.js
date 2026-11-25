import { randomBytes } from 'node:crypto';
import { schoolCodePattern } from '../auth/credentials.js';
import { openDatabase, transaction } from '../db/database.js';
import { hashPassword } from '../auth/password.js';
import { setDirectionPassword } from './store.js';

async function main([code, ...rest]) {
  if (!code || rest.length || !schoolCodePattern.test(code)) {
    throw new Error('Indiquez le code de l’école après direction:admin --.');
  }
  const password = randomBytes(24).toString('base64url');
  const derived = await hashPassword(password);
  const pool = openDatabase(process.env.DATABASE_URL);
  try {
    await transaction(pool, async (client) => {
      const school = await client.query('SELECT id FROM schools WHERE code = $1', [code]);
      if (!school.rowCount) throw new Error('École introuvable.');
      await setDirectionPassword(client, school.rows[0].id, derived);
    });
    console.log(password);
  } finally {
    await pool.end();
  }
}

try {
  await main(process.argv.slice(2));
} catch (error) {
  console.error(error.code ? 'La configuration du compte direction a échoué.' : error.message);
  process.exitCode = 1;
}
