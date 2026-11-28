import { randomUUID } from 'node:crypto';
import { markDevice, redeemDevicePair } from '../devices/store.js';
import { agendaPageSize, eventDetails, eventScope, pageEvents } from '../agenda/events.js';
import { transaction } from '../db/database.js';
import { homeworkPage, homeworkPageSize } from '../homework/entries.js';
import { generateInvitationCode, generateRefreshToken, invitationDigest, refreshDigest } from './credentials.js';

export const parentSessionSeconds = 90 * 24 * 60 * 60;
const nativeParentSessionSeconds = 365 * 24 * 60 * 60;

const activeParentQuery = `
  SELECT s.school_id, s.guardian_id
  FROM parent_sessions s
  JOIN guardians g ON (g.school_id, g.id) = (s.school_id, s.guardian_id)
  WHERE s.id = $1 AND s.guardian_id = $2 AND s.revoked_at IS NULL
    AND s.expires_at > statement_timestamp() AND g.active
`;

const eligibleChildren = `
  SELECT student.school_id, student.class_id, student.id, student.display_name, p.guardian_id, c.name AS class_name
  FROM active_parent p
  JOIN guardian_students l ON (l.school_id, l.guardian_id) = (p.school_id, p.guardian_id)
  JOIN students student ON (student.school_id, student.id) = (l.school_id, l.student_id) AND student.left_at IS NULL
  JOIN classes c ON (c.school_id, c.id) = (student.school_id, student.class_id) AND c.archived_year IS NULL
`;
const permittedChildQuery = `WITH active_parent AS (${activeParentQuery}),
  permitted_child AS (${eligibleChildren} WHERE l.student_id = $3)`;
const childFields = `EXISTS (SELECT 1 FROM active_parent) AS authenticated,
  (SELECT json_build_object('id', id, 'displayName', display_name,
    'classId', class_id, 'className', class_name) FROM permitted_child) AS child`;

const childAgendaJoin = `JOIN agenda_events e ON e.school_id = c.school_id AND (e.class_id IS NULL OR e.class_id = c.class_id)
  AND (e.appointment_student_id IS NULL OR
    (e.appointment_student_id, e.appointment_guardian_id) = (c.id, c.guardian_id))`;

const childAgendaEvents = `SELECT e.id, e.class_id, e.starts_at, e.ends_at, e.title, e.location, e.description,
    e.appointment_student_id IS NOT NULL AS private
  FROM permitted_child c ${childAgendaJoin}`;

async function lockActiveGuardian(client, schoolId, guardianId) {
  const result = await client.query(`
    SELECT 1 FROM guardians
    WHERE school_id = $1 AND id = $2 AND active
    FOR UPDATE
  `, [schoolId, guardianId]);
  return result.rowCount === 1;
}

export async function insertParentInvitation(client, invitationKey, { schoolCode, schoolId, guardianId }) {
  const code = generateInvitationCode();
  const digest = invitationDigest(invitationKey, schoolCode, code);
  const result = await client.query(`
    INSERT INTO parent_invitations (digest, school_id, guardian_id, expires_at)
    VALUES ($1, $2, $3, statement_timestamp() + interval '7 days')
    RETURNING expires_at
  `, [digest, schoolId, guardianId]);
  return { code, expiresAt: result.rows[0].expires_at };
}

async function openParentSession(client, schoolId, guardianId, browser) {
  const result = await client.query(`
    INSERT INTO parent_sessions (id, school_id, guardian_id, expires_at)
    VALUES ($1, $2, $3, statement_timestamp() + $4::interval)
    RETURNING id, guardian_id, expires_at
  `, [randomUUID(), schoolId, guardianId, browser ? `${parentSessionSeconds} seconds` : `${nativeParentSessionSeconds} seconds`]);
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
}

export function createParentStore(pool, invitationKey) {
  return {
    async invite(schoolCode, guardianId, replaceSessions = false) {
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
        return insertParentInvitation(client, invitationKey, { schoolCode, schoolId, guardianId });
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

        return openParentSession(client, invitation.school_id, invitation.guardian_id, browser);
      });
    },

    async pairDevice(schoolCode, code, browser, metadata) {
      return transaction(pool, (db) => redeemDevicePair(db, invitationKey, 'parent', schoolCode, code, async (schoolId, guardianId) => {
        const session = await openParentSession(db, schoolId, guardianId, browser);
        await markDevice(db, 'parent', session.session.id, metadata);
        return session;
      }));
    },

    seenDevice(sessionId, metadata) {
      return markDevice(pool, 'parent', sessionId, metadata);
    },

    async browserIdentity(token, remember = false) {
      const result = await pool.query(`
        SELECT s.id AS "sessionId", s.guardian_id AS "guardianId",
          s.expires_at < statement_timestamp() + ($2 - 86400) * interval '1 second' AS renewal
        FROM parent_browser_sessions b
        JOIN parent_sessions s ON s.id = b.session_id
        JOIN guardians g ON (g.school_id,g.id) = (s.school_id,s.guardian_id)
        WHERE b.digest = $1 AND s.revoked_at IS NULL AND s.expires_at > statement_timestamp() AND g.active
      `, [refreshDigest(token), parentSessionSeconds]);
      if (!result.rowCount) return null;
      const { renewal, ...identity } = result.rows[0];
      if (!remember || !renewal) return identity;
      const updated = await pool.query(`
        UPDATE parent_sessions SET expires_at = GREATEST(expires_at, statement_timestamp() + $2 * interval '1 second')
        WHERE id = $1 AND revoked_at IS NULL AND expires_at > statement_timestamp()
      `, [identity.sessionId, parentSessionSeconds]);
      return updated.rowCount ? { ...identity, renewed: true } : null;
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
        const { rows: [renewed] } = await client.query(`
          UPDATE parent_sessions SET expires_at = GREATEST(expires_at, statement_timestamp() + $2 * interval '1 second')
          WHERE id = $1 RETURNING expires_at
        `, [sessionId, nativeParentSessionSeconds]);
        session.expires_at = renewed.expires_at;
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
        LEFT JOIN students student ON (student.school_id, student.id) = (l.school_id, l.student_id) AND student.left_at IS NULL
        LEFT JOIN classes c ON (c.school_id, c.id) = (student.school_id, student.class_id)
        ORDER BY student.display_name, student.id
      `, [sessionId, guardianId]);
      if (!result.rowCount) return null;
      return result.rows.filter(({ id }) => id !== null).map(({ id, display_name, class_name }) => ({
        id, displayName: display_name, className: class_name,
      }));
    },

    async tutorReference({ sessionId, guardianId }) {
      const { rows } = await pool.query(`SELECT guardian_id FROM (${activeParentQuery}) parent`, [sessionId, guardianId]);
      return rows[0]?.guardian_id ?? null;
    },

    async withParentSession({ sessionId, guardianId }, operation) {
      return transaction(pool, async (client) => {
        const parameters = [sessionId, guardianId];
        const { rows: [identity] } = await client.query(activeParentQuery, parameters);
        if (!identity) return { authorized: false };
        // Garder le même ordre de verrouillage que le remplacement d’un appareil.
        const guardian = await client.query(`
          SELECT 1 FROM guardians WHERE school_id = $1 AND id = $2 AND active FOR SHARE
        `, [identity.school_id, guardianId]);
        if (!guardian.rowCount) return { authorized: false };
        const { rows: [actor] } = await client.query(`${activeParentQuery} FOR SHARE OF s`, parameters);
        if (!actor) return { authorized: false };
        return { authorized: true, value: await operation(client, { ...actor, sessionId }) };
      });
    },

    async homework({ sessionId, guardianId }, childId, { from, to, domain, beforeDate, beforeId, kind }) {
      const result = await pool.query(`
        ${permittedChildQuery}, page AS (
          SELECT e.id, e.entry_date, e.title, e.domain, e.description, e.kind, e.attachment_kind IS NOT NULL AS "hasDocument"
          FROM permitted_child c
          JOIN homework_entries e ON (e.school_id, e.class_id) = (c.school_id, c.class_id)
          WHERE e.entry_date BETWEEN $4 AND $5 AND e.publish_at <= statement_timestamp()
            AND ($6::text IS NULL OR strpos(lower(e.domain), lower($6)) > 0)
            AND ($7::date IS NULL OR (e.entry_date, e.id) < ($7, $8::uuid))
            AND ($10::text IS NULL OR e.kind = $10)
          ORDER BY e.entry_date DESC, e.id DESC
          LIMIT $9
        )
        SELECT ${childFields},
               COALESCE((SELECT json_agg(json_build_object(
                 'id', id, 'date', to_char(entry_date, 'YYYY-MM-DD'),
                 'title', title, 'domain', domain, 'description', description, 'hasDocument', "hasDocument", 'kind', kind
               ) ORDER BY entry_date DESC, id DESC) FROM page), '[]'::json) AS entries
      `, [sessionId, guardianId, childId, from, to, domain, beforeDate, beforeId, homeworkPageSize + 1, kind]);
      const { authenticated, child, entries } = result.rows[0];
      return { authenticated, child, ...homeworkPage(entries) };
    },

    async agenda({ sessionId, guardianId }, childId, { from, until, afterStartsAt, afterId }) {
      const { rows: [result] } = await pool.query(`
        ${permittedChildQuery}, page AS (
          ${childAgendaEvents}
          WHERE e.ends_at > $4 AND e.starts_at < $5
            AND ($6::timestamptz IS NULL OR (e.starts_at, e.id) > ($6, $7::uuid))
          ORDER BY e.starts_at, e.id
          LIMIT $8
        )
        SELECT ${childFields}, COALESCE((SELECT json_agg(page ORDER BY starts_at, id) FROM page), '[]'::json) AS events
      `, [sessionId, guardianId, childId, from, until, afterStartsAt, afterId, agendaPageSize + 1]);
      return { authenticated: result.authenticated, child: result.child, ...pageEvents(result.events) };
    },

    async agendaEvent({ sessionId, guardianId }, childId, eventId) {
      const { rows: [result] } = await pool.query(`
        ${permittedChildQuery}, visible AS (${childAgendaEvents} WHERE e.id = $4)
        SELECT EXISTS (SELECT 1 FROM active_parent) AS authenticated,
               (SELECT row_to_json(visible) FROM visible) AS event
      `, [sessionId, guardianId, childId, eventId]);
      return { authenticated: result.authenticated, event: result.event ? eventDetails(result.event) : null };
    },

    async agendaReminders({ sessionId, guardianId }, { afterStartsAt, afterId }, now = new Date()) {
      const { rows: [result] } = await pool.query(`
        WITH active_parent AS (${activeParentQuery}), permitted_child AS (${eligibleChildren}),
        bounds AS (
          SELECT (school_day + 1)::timestamp AT TIME ZONE 'Europe/Paris' AS tomorrow,
                 (school_day + 2)::timestamp AT TIME ZONE 'Europe/Paris' AS until
          FROM (SELECT ($3::timestamptz AT TIME ZONE 'Europe/Paris')::date AS school_day) local_clock
        ), page AS (
          SELECT * FROM (
            SELECT DISTINCT ON (e.id) e.id, e.class_id, e.starts_at, e.title,
                   e.appointment_student_id IS NOT NULL AS private, e.starts_at >= bounds.tomorrow AS tomorrow,
                   c.id AS child_id, c.display_name, c.class_name
            FROM permitted_child c ${childAgendaJoin}
            CROSS JOIN bounds
            WHERE e.starts_at >= $3 AND e.starts_at < bounds.until
              AND ($4::timestamptz IS NULL OR (e.starts_at, e.id) > ($4, $5::uuid))
            ORDER BY e.id, c.display_name, c.id
          ) matching
          ORDER BY starts_at, id LIMIT $6
        )
        SELECT EXISTS (SELECT 1 FROM active_parent) AS authenticated,
               COALESCE((SELECT json_agg(page ORDER BY starts_at, id) FROM page), '[]'::json) AS reminders
      `, [sessionId, guardianId, now, afterStartsAt, afterId, agendaPageSize + 1]);
      if (!result.authenticated) return null;

      const reminders = result.reminders.slice(0, agendaPageSize).map((row) => ({
        id: row.id, startsAt: new Date(row.starts_at).toISOString(), title: row.title,
        scope: eventScope(row), day: row.tomorrow ? 'tomorrow' : 'today',
        child: { id: row.child_id, displayName: row.display_name, className: row.class_name },
      }));
      const last = reminders.at(-1);
      return { reminders, nextCursor: result.reminders.length > agendaPageSize ? `${last.startsAt}~${last.id}` : null };
    },
  };
}
