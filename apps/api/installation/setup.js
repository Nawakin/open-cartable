import { randomUUID, timingSafeEqual } from 'node:crypto';
import { schoolCodePattern } from '../auth/credentials.js';
import { insertParentInvitation } from '../auth/parent-store.js';
import { transaction } from '../db/database.js';
import { hashPassword, passwordLimits, validPassword } from '../auth/password.js';
import { setDirectionPassword } from '../direction/store.js';

export async function isInstalled(db) {
  const result = await db.query(`SELECT EXISTS (SELECT 1 FROM schools)
    OR EXISTS (SELECT 1 FROM installation_completed) AS installed`);
  return result.rows[0].installed;
}

async function createSchool(pool, invitationKey, { schoolName, schoolCode, className, studentName, directionPassword }) {
  if (await isInstalled(pool)) return null;
  const directionCredential = await hashPassword(directionPassword);
  return transaction(pool, async (client) => {
    await client.query('LOCK TABLE schools IN SHARE ROW EXCLUSIVE MODE');
    if (await isInstalled(client)) return null;

    const [schoolId, classId, studentId, guardianId] = Array.from({ length: 4 }, () => randomUUID());
    await client.query('INSERT INTO schools (id, code, name) VALUES ($1, $2, $3)', [schoolId, schoolCode, schoolName]);
    await setDirectionPassword(client, schoolId, directionCredential);
    await client.query('INSERT INTO classes (school_id, id, name) VALUES ($1, $2, $3)', [schoolId, classId, className]);
    await client.query('INSERT INTO students (school_id, id, class_id, display_name) VALUES ($1, $2, $3, $4)',
      [schoolId, studentId, classId, studentName]);
    await client.query('INSERT INTO guardians (school_id, id) VALUES ($1, $2)', [schoolId, guardianId]);
    await client.query('INSERT INTO guardian_students (school_id, guardian_id, student_id) VALUES ($1, $2, $3)',
      [schoolId, guardianId, studentId]);
    const invitation = await insertParentInvitation(client, invitationKey, { schoolCode, schoolId, guardianId });
    await client.query('INSERT INTO installation_completed (singleton) VALUES (true)');
    return { schoolCode, ...invitation };
  });
}

export async function installationRoutes(app, { pool, token, invitationKey, webOrigin }) {
  const name = { type: 'string', minLength: 1, maxLength: 100 };
  app.addHook('onRequest', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
  });
  app.get('/installation', async () => ({ installed: await isInstalled(pool) }));
  app.post('/installation', {
    bodyLimit: 4096,
    onRequest: async (request, reply) => {
      if (request.headers.origin !== webOrigin) return reply.code(403).send({ error: 'Origine non autorisée.' });
    },
    schema: {
      body: {
        type: 'object',
        additionalProperties: false,
        required: ['token', 'schoolCode', 'schoolName', 'className', 'studentName', 'directionPassword'],
        properties: {
          token: { type: 'string', minLength: 64, maxLength: 64, pattern: '^[0-9a-f]{64}$' },
          schoolCode: { type: 'string', pattern: schoolCodePattern.source },
          schoolName: name,
          className: name,
          studentName: name,
          directionPassword: { type: 'string', ...passwordLimits },
        },
      },
    },
  }, async (request, reply) => {
    const { token: supplied, schoolCode, directionPassword } = request.body;
    if (!timingSafeEqual(Buffer.from(supplied), Buffer.from(token))) {
      return reply.code(403).send({ error: 'Code d’installation invalide.' });
    }
    const [schoolName, className, studentName] = ['schoolName', 'className', 'studentName']
      .map((field) => request.body[field].trim());
    if ([schoolName, className, studentName].some((value) => !value || value.includes('\0'))) {
      return reply.code(400).send({ error: 'Complétez les noms de l’école, de la classe et de l’élève.' });
    }
    if (!validPassword(directionPassword)) return reply.code(400).send({ error: 'Le mot de passe direction est invalide.' });
    const result = await createSchool(pool, invitationKey, { schoolName, schoolCode, className, studentName, directionPassword });
    if (!result) return reply.code(409).send({ error: 'L’installation est déjà configurée.' });
    return reply.code(201).send(result);
  });
  app.setErrorHandler((error, _request, reply) => {
    if (error.statusCode >= 400 && error.statusCode < 500) {
      return reply.code(error.statusCode).send({ error: 'Requête non valide.' });
    }
    return reply.code(500).send({ error: 'L’installation n’a pas abouti.' });
  });
}
