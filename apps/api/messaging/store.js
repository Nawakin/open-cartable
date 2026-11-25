import { randomUUID } from 'node:crypto';

const pageSize = 30;
const retainedSince = "statement_timestamp() - interval '1 year'";

const visibleThread = `
  c.school_id = $1 AND ($2::uuid IS NULL OR c.guardian_id = $2)
  AND c.last_message_at > ${retainedSince}
  AND EXISTS (SELECT 1 FROM guardians g WHERE (g.school_id, g.id) = (c.school_id, c.guardian_id) AND g.active)
`;

const threadColumns = `
  c.id, c.subject, c.last_message_at AS "lastMessageAt", student.display_name AS "studentName",
  CASE WHEN $2::uuid IS NULL THEN c.guardian_id END AS "guardianReference"
`;
const threadStudent = 'JOIN students student ON (student.school_id, student.id) = (c.school_id, c.student_id)';

function page(rows, field) {
  const items = rows.slice(0, pageSize);
  const last = items.at(-1);
  return { items, nextCursor: rows.length > pageSize ? `${new Date(last[field]).toISOString()}~${last.id}` : null };
}

export async function listConversations(db, actor, { beforeAt, beforeId }) {
  const { rows } = await db.query(`
    SELECT ${threadColumns} FROM direction_conversations c ${threadStudent}
    WHERE ${visibleThread} AND ($3::timestamptz IS NULL OR (c.last_message_at, c.id) < ($3, $4::uuid))
    ORDER BY c.last_message_at DESC, c.id DESC LIMIT $5
  `, [actor.school_id, actor.guardian_id ?? null, beforeAt, beforeId, pageSize + 1]);
  const { items, nextCursor } = page(rows, 'lastMessageAt');
  return { conversations: items, nextCursor };
}

export async function readConversation(db, actor, id, { beforeAt, beforeId }) {
  const { rows: [result] } = await db.query(`
    WITH visible AS (
      SELECT c.school_id, ${threadColumns} FROM direction_conversations c ${threadStudent}
      WHERE ${visibleThread} AND c.id = $3
    ), page AS (
      SELECT m.id, m.sender, m.body, m.sent_at AS "sentAt"
      FROM visible v JOIN direction_messages m ON (m.school_id, m.conversation_id) = (v.school_id, v.id)
      WHERE m.sent_at > ${retainedSince}
        AND ($4::timestamptz IS NULL OR (m.sent_at, m.id) < ($4, $5::uuid))
      ORDER BY m.sent_at DESC, m.id DESC LIMIT $6
    )
    SELECT
      (SELECT json_build_object('id', id, 'subject', subject, 'studentName', "studentName",
        'guardianReference', "guardianReference") FROM visible) AS conversation,
      COALESCE((SELECT json_agg(page ORDER BY "sentAt" DESC, id DESC) FROM page), '[]'::json) AS messages
  `, [actor.school_id, actor.guardian_id ?? null, id, beforeAt, beforeId, pageSize + 1]);
  if (!result.conversation) return null;
  const messages = result.messages.map((message) => ({
    ...message, sentAt: new Date(message.sentAt).toISOString(),
  }));
  const { items, nextCursor } = page(messages, 'sentAt');
  return { conversation: result.conversation, messages: items, nextCursor };
}

async function insertMessage(db, schoolId, id, sender, body, sentAt) {
  const messageId = randomUUID();
  await db.query(`
    INSERT INTO direction_messages (school_id, conversation_id, id, sender, body, sent_at)
    VALUES ($1, $2, $3, $4, $5, $6)
  `, [schoolId, id, messageId, sender, body, sentAt]);
  return messageId;
}

export async function createConversation(db, actor, { childId, subject, body }) {
  const link = await db.query(`
    SELECT 1 FROM guardian_students
    WHERE school_id = $1 AND guardian_id = $2 AND student_id = $3 FOR SHARE
  `, [actor.school_id, actor.guardian_id, childId]);
  if (!link.rowCount) return null;
  const id = randomUUID();
  const { rows } = await db.query(`
    INSERT INTO direction_conversations (school_id, id, guardian_id, student_id, subject, last_message_at)
    VALUES ($1, $2, $3, $4, $5, date_trunc('milliseconds', clock_timestamp()))
    RETURNING last_message_at
  `, [actor.school_id, id, actor.guardian_id, childId, subject]);
  await insertMessage(db, actor.school_id, id, 'parent', body, rows[0].last_message_at);
  return { id };
}

export async function addMessage(db, actor, id, body) {
  const { rows: [thread] } = await db.query(`
    UPDATE direction_conversations c
    SET last_message_at = greatest(c.last_message_at + interval '1 millisecond', date_trunc('milliseconds', clock_timestamp()))
    WHERE ${visibleThread} AND c.id = $3
    RETURNING c.last_message_at
  `, [actor.school_id, actor.guardian_id ?? null, id]);
  if (!thread) return null;
  const sender = actor.guardian_id ? 'parent' : 'direction';
  return { id: await insertMessage(db, actor.school_id, id, sender, body, thread.last_message_at) };
}
