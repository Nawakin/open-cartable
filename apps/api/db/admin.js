import { readInvitationKey, schoolCodePattern, uuidPattern } from '../auth/credentials.js';
import { createParentStore } from '../auth/parent-store.js';
import { migrate, openDatabase, transaction } from './database.js';
import { demo, seedDemo } from './demo.js';

async function main(args) {
  const [command, schoolCode, guardianId] = args;
  const issuesInvitation = command === 'invite' || command === 'replace';
  const simpleCommand = ['migrate', 'seed-demo', 'purge-expired'].includes(command);
  if (!(simpleCommand && args.length === 1)
      && !(issuesInvitation && args.length === 3 && schoolCodePattern.test(schoolCode) && uuidPattern.test(guardianId))) {
    console.error('Usage : auth:admin -- migrate | seed-demo | purge-expired | invite CODE_ECOLE UUID_TUTEUR | replace CODE_ECOLE UUID_TUTEUR');
    return 1;
  }
  const pool = openDatabase(process.env.DATABASE_URL);
  try {
    if (command === 'migrate') {
      await migrate(pool);
      console.log('Migrations appliquées.');
    } else if (command === 'seed-demo') {
      await seedDemo(pool);
      console.log(JSON.stringify({ schoolCode: demo.school.code, guardians: demo.guardians }));
    } else if (command === 'purge-expired') {
      await transaction(pool, async (client) => {
        await client.query('DELETE FROM parent_invitations WHERE expires_at <= statement_timestamp()');
        await client.query('DELETE FROM parent_sessions WHERE expires_at <= statement_timestamp() OR revoked_at IS NOT NULL');
      });
      console.log('Identifiants expirés et sessions révoquées purgés.');
    } else {
      const store = createParentStore(pool, readInvitationKey(process.env));
      const invitation = await store.invite(schoolCode, guardianId, command === 'replace');
      if (!invitation) {
        console.error('École ou compte actif introuvable.');
        return 1;
      }
      process.stdout.write(JSON.stringify(invitation) + '\n');
    }
    return 0;
  } finally {
    await pool.end();
  }
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  const message = error.code ? 'La commande PostgreSQL a échoué.' : error.message;
  console.error(message);
  process.exitCode = 1;
}
