import { randomUUID } from 'node:crypto';
import { transaction } from '../db/database.js';
import { generateInvitationCode, generateRefreshToken, invitationDigest, refreshDigest } from './credentials.js';

async function lockActiveGuardian(client, schoolId, guardianId) {
  const result = await client.query(`
    SELECT 1 FROM guardians
    WHERE school_id = $1 AND id = $2 AND active
    FOR UPDATE
  `, [schoolId, guardianId]);
  return result.rowCount === 1;
}

export function createParentStore(pool, invitationKey) {
  return {
    async invite(schoolCode, guardianId, replaceSessions = false) {
      const code = generateInvitationCode();
      const digest = invitationDigest(invitationKey, schoolCode, code);
      return transaction(pool, async (client) => {
        const school = await client.query('SELECT id FROM schools WHERE code = $1', [schoolCode]);
        const schoolId = school.rows[0]?.id;
        if (!schoolId || !await lockActiveGuardian(client, schoolId, guardianId)) return null;

        await client.query(`
          UPDATE parent_invitations SET revoked_at = statement_timestamp()
          WHERE school_id = $1 AND guardian_id = $2 AND consumed_at IS NULL AND revoked_at IS NULL
        `, [schoolId, guardianId]);
        if (replaceSessions) {
          await client.query(`
            UPDATE parent_sessions SET revoked_at = statement_timestamp()
            WHERE school_id = $1 AND guardian_id = $2 AND revoked_at IS NULL
          `, [schoolId, guardianId]);
        }
        const result = await client.query(`
          INSERT INTO parent_invitations (digest, school_id, guardian_id, expires_at)
          VALUES ($1, $2, $3, statement_timestamp() + interval '7 days')
          RETURNING expires_at
        `, [digest, schoolId, guardianId]);
        return { code, expiresAt: result.rows[0].expires_at };
      });
    },

    async redeem(schoolCode, code) {
      const digest = invitationDigest(invitationKey, schoolCode, code);
      return transaction(pool, async (client) => {
        const lookup = await client.query(`
          SELECT i.school_id, i.guardian_id
          FROM parent_invitations i
          JOIN schools s ON s.id = i.school_id
          WHERE i.digest = $1 AND s.code = $2
            AND i.consumed_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > statement_timestamp()
        `, [digest, schoolCode]);
        const invitation = lookup.rows[0];
        if (!invitation || !await lockActiveGuardian(client, invitation.school_id, invitation.guardian_id)) return null;
        // La commande de remplacement verrouille le même compte avant de toucher à ses invitations.
        const used = await client.query(`
          UPDATE parent_invitations SET consumed_at = statement_timestamp()
          WHERE digest = $1 AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at > statement_timestamp()
        `, [digest]);
        if (used.rowCount !== 1) return null;

        const result = await client.query(`
          INSERT INTO parent_sessions (id, school_id, guardian_id, expires_at)
          VALUES ($1, $2, $3, statement_timestamp() + interval '30 days')
          RETURNING id, guardian_id, expires_at
        `, [randomUUID(), invitation.school_id, invitation.guardian_id]);
        const session = result.rows[0];
        const refreshToken = generateRefreshToken();
        await client.query('INSERT INTO parent_refresh_tokens (digest, session_id) VALUES ($1, $2)', [
          refreshDigest(refreshToken), session.id,
        ]);
        return { session, refreshToken };
      });
    },

    async rotate(token) {
      const digest = refreshDigest(token);
      return transaction(pool, async (client) => {
        const lookup = await client.query('SELECT session_id FROM parent_refresh_tokens WHERE digest = $1', [digest]);
        if (!lookup.rowCount) return null;
        const sessionId = lookup.rows[0].session_id;
        const result = await client.query(`
          SELECT s.id, s.guardian_id, s.expires_at
          FROM parent_sessions s
          JOIN guardians g ON (g.school_id, g.id) = (s.school_id, s.guardian_id)
          WHERE s.id = $1 AND s.revoked_at IS NULL AND s.expires_at > statement_timestamp() AND g.active
          FOR UPDATE OF s
        `, [sessionId]);
        const session = result.rows[0];
        if (!session) return null;

        // Relire l'état du jeton après le verrou de session, en cas de renouvellements concurrents.
        const updated = await client.query(`
          UPDATE parent_refresh_tokens SET consumed_at = statement_timestamp()
          WHERE digest = $1 AND consumed_at IS NULL
        `, [digest]);
        if (updated.rowCount !== 1) {
          await client.query('UPDATE parent_sessions SET revoked_at = statement_timestamp() WHERE id = $1', [sessionId]);
          return null;
        }

        const refreshToken = generateRefreshToken();
        await client.query('INSERT INTO parent_refresh_tokens (digest, session_id) VALUES ($1, $2)', [
          refreshDigest(refreshToken), session.id,
        ]);
        return { session, refreshToken };
      });
    },

    async revoke({ sessionId, guardianId }) {
      await pool.query(`
        UPDATE parent_sessions SET revoked_at = statement_timestamp()
        WHERE id = $1 AND guardian_id = $2 AND revoked_at IS NULL
      `, [sessionId, guardianId]);
    },

    async children({ sessionId, guardianId }) {
      const result = await pool.query(`
        SELECT student.id, student.display_name, c.name AS class_name
        FROM parent_sessions s
        JOIN guardians g ON (g.school_id, g.id) = (s.school_id, s.guardian_id)
        LEFT JOIN guardian_students l ON (l.school_id, l.guardian_id) = (g.school_id, g.id)
        LEFT JOIN students student ON (student.school_id, student.id) = (l.school_id, l.student_id)
        LEFT JOIN classes c ON (c.school_id, c.id) = (student.school_id, student.class_id)
        WHERE s.id = $1 AND s.guardian_id = $2 AND s.revoked_at IS NULL
          AND s.expires_at > statement_timestamp() AND g.active
        ORDER BY student.display_name, student.id
      `, [sessionId, guardianId]);
      if (!result.rowCount) return null;
      return result.rows.filter(({ id }) => id !== null).map(({ id, display_name, class_name }) => ({
        id, displayName: display_name, className: class_name,
      }));
    },
  };
}
