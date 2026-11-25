import { randomUUID } from 'node:crypto';
import { transaction } from '../db/database.js';
import { generateInvitationCode, generateRefreshToken, invitationDigest, refreshDigest } from './credentials.js';

export const parentSessionSeconds = 30 * 24 * 60 * 60;
const homeworkPageSize = 30;

const activeParentQuery = `
  SELECT s.school_id, s.guardian_id
  FROM parent_sessions s
  JOIN guardians g ON (g.school_id, g.id) = (s.school_id, s.guardian_id)
  WHERE s.id = $1 AND s.guardian_id = $2 AND s.revoked_at IS NULL
    AND s.expires_at > statement_timestamp() AND g.active
`;

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

    async redeem(schoolCode, code, { browser = false } = {}) {
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
          VALUES ($1, $2, $3, statement_timestamp() + $4::interval)
          RETURNING id, guardian_id, expires_at
        `, [randomUUID(), invitation.school_id, invitation.guardian_id, `${parentSessionSeconds} seconds`]);
        const session = result.rows[0];
        if (browser) {
          const browserToken = generateRefreshToken();
          await client.query('INSERT INTO parent_browser_sessions (digest, session_id) VALUES ($1, $2)', [
            refreshDigest(browserToken), session.id,
          ]);
          return { session, browserToken };
        }
        const refreshToken = generateRefreshToken();
        await client.query('INSERT INTO parent_refresh_tokens (digest, session_id) VALUES ($1, $2)', [
          refreshDigest(refreshToken), session.id,
        ]);
        return { session, refreshToken };
      });
    },

    async browserIdentity(token) {
      const result = await pool.query(`
        SELECT s.id AS "sessionId", s.guardian_id AS "guardianId"
        FROM parent_browser_sessions b
        JOIN parent_sessions s ON s.id = b.session_id
        WHERE b.digest = $1 AND s.revoked_at IS NULL AND s.expires_at > statement_timestamp()
      `, [refreshDigest(token)]);
      return result.rows[0] ?? null;
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

    async revokeRefreshToken(token) {
      await pool.query(`
        UPDATE parent_sessions s SET revoked_at = statement_timestamp()
        FROM parent_refresh_tokens r
        WHERE s.id = r.session_id AND r.digest = $1 AND s.revoked_at IS NULL
      `, [refreshDigest(token)]);
    },

    async children({ sessionId, guardianId }) {
      const result = await pool.query(`
        WITH active_parent AS (${activeParentQuery})
        SELECT student.id, student.display_name, c.name AS class_name
        FROM active_parent p
        LEFT JOIN guardian_students l ON (l.school_id, l.guardian_id) = (p.school_id, p.guardian_id)
        LEFT JOIN students student ON (student.school_id, student.id) = (l.school_id, l.student_id)
        LEFT JOIN classes c ON (c.school_id, c.id) = (student.school_id, student.class_id)
        ORDER BY student.display_name, student.id
      `, [sessionId, guardianId]);
      if (!result.rowCount) return null;
      return result.rows.filter(({ id }) => id !== null).map(({ id, display_name, class_name }) => ({
        id, displayName: display_name, className: class_name,
      }));
    },

    async homework({ sessionId, guardianId }, childId, { from, to, domain, beforeDate, beforeId }) {
      const result = await pool.query(`
        WITH active_parent AS (${activeParentQuery}),
        permitted_child AS (
          SELECT student.school_id, student.class_id, student.id, student.display_name, c.name AS class_name
          FROM active_parent p
          JOIN guardian_students l ON (l.school_id, l.guardian_id) = (p.school_id, p.guardian_id)
          JOIN students student ON (student.school_id, student.id) = (l.school_id, l.student_id)
          JOIN classes c ON (c.school_id, c.id) = (student.school_id, student.class_id)
          WHERE l.student_id = $3
        ), page AS (
          SELECT e.id, e.entry_date, e.title, e.domain, e.description
          FROM permitted_child c
          JOIN homework_entries e ON (e.school_id, e.class_id) = (c.school_id, c.class_id)
          WHERE e.entry_date BETWEEN $4 AND $5
            AND ($6::text IS NULL OR strpos(lower(e.domain), lower($6)) > 0)
            AND ($7::date IS NULL OR (e.entry_date, e.id) < ($7, $8::uuid))
          ORDER BY e.entry_date DESC, e.id DESC
          LIMIT $9
        )
        SELECT EXISTS (SELECT 1 FROM active_parent) AS authenticated,
               (SELECT json_build_object('id', id, 'displayName', display_name,
                 'classId', class_id, 'className', class_name) FROM permitted_child) AS child,
               COALESCE((SELECT json_agg(json_build_object(
                 'id', id, 'date', to_char(entry_date, 'YYYY-MM-DD'),
                 'title', title, 'domain', domain, 'description', description
               ) ORDER BY entry_date DESC, id DESC) FROM page), '[]'::json) AS entries
      `, [sessionId, guardianId, childId, from, to, domain, beforeDate, beforeId, homeworkPageSize + 1]);
      const { authenticated, child, entries } = result.rows[0];
      const hasMore = entries.length > homeworkPageSize;
      if (hasMore) entries.pop();
      const last = entries.at(-1);
      return { authenticated, child, entries, nextCursor: hasMore ? `${last.date}~${last.id}` : null };
    },
  };
}
