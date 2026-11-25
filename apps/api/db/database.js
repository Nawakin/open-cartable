import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { readSecret } from '../installation/secrets.js';

export const migrations = [
  '001-parent-auth.sql', '002-browser-sessions.sql', '003-homework-entries.sql',
  '004-school-name.sql', '005-direction.sql', '006-teachers.sql', '007-agenda.sql',
  '008-private-appointments.sql', '009-private-messages.sql', '010-teacher-messages.sql',
  '011-message-reading.sql', '012-liaison-notebook.sql', '013-class-blog.sql',
];

export function openDatabase(connectionString) {
  const password = connectionString ? undefined : readSecret(process.env, 'PGPASSWORD');
  if (!connectionString && (!password || !process.env.PGHOST)) throw new Error('La connexion PostgreSQL doit être configurée.');
  return new pg.Pool({
    ...(connectionString ? { connectionString } : { password }),
    connectionTimeoutMillis: 3000,
    statement_timeout: 5000,
    max: 10,
  });
}

export async function transaction(pool, operation) {
  const client = await pool.connect();
  let rollbackError;
  try {
    await client.query('BEGIN');
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (failure) {
      rollbackError = failure;
    }
    throw error;
  } finally {
    client.release(rollbackError);
  }
}

export async function migrate(pool) {
  await transaction(pool, async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(192615, 1)");
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY)');
    const applied = await client.query('SELECT name FROM schema_migrations');
    const names = new Set(applied.rows.map(({ name }) => name));
    for (const name of migrations) {
      if (names.has(name)) continue;
      await client.query(await readFile(new URL(`migrations/${name}`, import.meta.url), 'utf8'));
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name]);
    }
  });
}
