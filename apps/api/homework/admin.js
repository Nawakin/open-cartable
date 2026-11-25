import { schoolCodePattern, uuidPattern } from '../auth/credentials.js';
import { openDatabase } from '../db/database.js';
import { createEntry, deleteEntry, readEntry, updateEntry } from './entries.js';

async function readInput() {
  if (process.stdin.isTTY) throw new Error('Transmettez l’entrée en JSON sur l’entrée standard.');
  const chunks = [];
  let bytes = 0;
  for await (const chunk of process.stdin) {
    bytes += chunk.length;
    if (bytes > 16 * 1024) throw new Error('Le document JSON dépasse 16 Kio.');
    chunks.push(chunk);
  }
  let input;
  try {
    input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
  } catch {
    throw new Error('Un objet JSON UTF-8 est requis.');
  }
  const entry = readEntry(input);
  if (!entry) throw new Error('Renseignez date, title, domain et description dans les limites indiquées.');
  return entry;
}

async function main(args) {
  const [command, schoolCode, classId, entryId] = args;
  if (!((command === 'create' && args.length === 3)
      || (['update', 'delete'].includes(command) && args.length === 4 && uuidPattern.test(entryId)))
      || !schoolCodePattern.test(schoolCode) || !uuidPattern.test(classId)) {
    throw new Error('Usage : homework:admin -- create CODE_ECOLE UUID_CLASSE | update CODE_ECOLE UUID_CLASSE UUID_ENTREE | delete CODE_ECOLE UUID_CLASSE UUID_ENTREE');
  }

  const entry = command === 'delete' ? undefined : await readInput();
  const pool = openDatabase(process.env.DATABASE_URL);
  try {
    const id = command === 'create' ? await createEntry(pool, schoolCode, classId, entry) : entryId;
    if (!id || (command === 'update' && !await updateEntry(pool, schoolCode, classId, id, entry))
      || (command === 'delete' && !await deleteEntry(pool, schoolCode, classId, id))) {
      throw new Error('Classe ou entrée introuvable pour cette école.');
    }
    console.log(JSON.stringify({ id }));
  } finally {
    await pool.end();
  }
}

try {
  await main(process.argv.slice(2));
} catch (error) {
  console.error(error.code ? 'La commande PostgreSQL a échoué.' : error.message);
  process.exitCode = 1;
}
