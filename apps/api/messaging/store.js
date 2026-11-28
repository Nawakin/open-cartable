import { randomUUID } from 'node:crypto';
import { pageByTimestamp } from '../db/keyset.js';
import { openPrivateFile, sealPrivateFile } from '../files/private-files.js';

const pageSize = 30;
const retainedSince = "statement_timestamp() - interval '1 year'";

const teacherAvailable = `EXISTS (
  SELECT 1 FROM teacher_accounts account
  JOIN teacher_classes assignment ON (assignment.school_id, assignment.teacher_id) = (account.school_id, account.id)
  JOIN students current_student ON (current_student.school_id, current_student.class_id) = (assignment.school_id, assignment.class_id)
  WHERE (account.school_id, account.id, current_student.id) = (c.school_id, c.teacher_id, c.student_id)
    AND account.password_hash IS NOT NULL AND current_student.left_at IS NULL
)`;

const visibleThread = `
  c.school_id = $1
  AND (
    ($2::uuid IS NOT NULL AND c.guardian_id = $2)
    OR ($3::uuid IS NOT NULL AND c.channel = 'teacher' AND c.teacher_id = $3 AND ${teacherAvailable})
    OR ($2 IS NULL AND $3 IS NULL AND c.channel = 'direction')
  )
  AND c.last_message_at > ${retainedSince}
  AND EXISTS (SELECT 1 FROM guardians g WHERE (g.school_id, g.id) = (c.school_id, c.guardian_id) AND g.active)
`;

const threadColumns = `
  c.id, c.subject, c.channel, c.teacher_label AS "teacherLabel",
  c.last_message_at AS "lastMessageAt", student.display_name AS "studentName"
`;
const threadStudent = 'JOIN students student ON (student.school_id, student.id) = (c.school_id, c.student_id)';

const unread = `EXISTS (
  SELECT 1 FROM conversation_messages m
  WHERE (m.school_id, m.conversation_id) = (c.school_id, c.id)
    AND m.sender = CASE WHEN $2::uuid IS NULL THEN 'parent' ELSE c.channel END
    AND m.sent_at > ${retainedSince}
    AND m.sent_at > COALESCE(CASE WHEN $2::uuid IS NULL THEN c.staff_read_at ELSE c.parent_read_at END, '-infinity')
)`;

function actorScope(actor) {
  return [actor.school_id, actor.guardian_id ?? null, actor.teacher_id ?? null];
}

export async function listConversations(db, actor, { beforeAt, beforeId }) {
  const { rows } = await db.query(`
    SELECT ${threadColumns}, ${unread} AS unread, (
      SELECT json_build_object('sender', m.sender, 'body',
        CASE WHEN char_length(m.body) > 140 THEN left(m.body, 140) || '…' ELSE m.body END)
      FROM conversation_messages m
      WHERE (m.school_id, m.conversation_id) = (c.school_id, c.id) AND m.sent_at > ${retainedSince}
      ORDER BY m.sent_at DESC, m.id DESC LIMIT 1
    ) AS "lastMessage"
    FROM message_conversations c ${threadStudent}
    WHERE ${visibleThread} AND ($4::timestamptz IS NULL OR (c.last_message_at, c.id) < ($4, $5::uuid))
    ORDER BY c.last_message_at DESC, c.id DESC LIMIT $6
  `, [...actorScope(actor), beforeAt, beforeId, pageSize + 1]);
  const { items, nextCursor } = pageByTimestamp(rows, pageSize, 'lastMessageAt');
  return { conversations: items, nextCursor };
}

export async function unreadParentThreads(db, actor, childId) {
  const { rows } = await db.query(`
    SELECT c.id,c.subject,c.last_message_at AS "lastMessageAt",student.display_name AS "studentName"
    FROM message_conversations c ${threadStudent}
    WHERE ${visibleThread} AND ${unread} AND ($4::uuid IS NULL OR c.student_id=$4)
      AND student.left_at IS NULL AND EXISTS (
        SELECT 1 FROM guardian_students g JOIN classes room ON (room.school_id,room.id)=(student.school_id,student.class_id)
        WHERE (g.school_id,g.guardian_id,g.student_id)=(c.school_id,$2,c.student_id) AND room.archived_year IS NULL
      )
    ORDER BY c.last_message_at DESC,c.id LIMIT 12
  `, [...actorScope(actor), childId]);
  return rows;
}

export async function countUnreadConversations(db, actor) {
  const { rows: [result] } = await db.query(`
    SELECT count(*)::integer AS "unreadCount" FROM message_conversations c
    WHERE ${visibleThread} AND ${unread}
  `, actorScope(actor));
  return result;
}

export async function markConversationRead(db, actor, id, messageId) {
  // Le client confirme uniquement les messages chargés, même si le fil a reçu une réponse depuis.
  const result = await db.query(`
    UPDATE message_conversations c
    SET parent_read_at = CASE WHEN $2::uuid IS NOT NULL THEN greatest(c.parent_read_at, m.sent_at) ELSE c.parent_read_at END,
        staff_read_at = CASE WHEN $2::uuid IS NULL THEN greatest(c.staff_read_at, m.sent_at) ELSE c.staff_read_at END
    FROM conversation_messages m
    WHERE ${visibleThread} AND c.id = $4
      AND (m.school_id, m.conversation_id, m.id) = (c.school_id, c.id, $5)
      AND m.sent_at > ${retainedSince}
  `, [...actorScope(actor), id, messageId]);
  return result.rowCount === 1;
}

export async function readConversation(db, actor, id, { beforeAt, beforeId }) {
  const { rows: [result] } = await db.query(`
    WITH visible AS (
      SELECT c.school_id, ${threadColumns},
        CASE WHEN $2::uuid IS NULL THEN c.guardian_id END AS "guardianReference",
        (student.left_at IS NULL AND (c.channel = 'direction' OR ${teacherAvailable})) AS "canReply"
      FROM message_conversations c ${threadStudent}
      WHERE ${visibleThread} AND c.id = $4
    ), page AS (
      SELECT m.id, m.sender, m.body, m.sent_at AS "sentAt", m.attachment_kind IS NOT NULL AS "hasDocument"
      FROM visible v JOIN conversation_messages m ON (m.school_id, m.conversation_id) = (v.school_id, v.id)
      WHERE m.sent_at > ${retainedSince}
        AND ($5::timestamptz IS NULL OR (m.sent_at, m.id) < ($5, $6::uuid))
      ORDER BY m.sent_at DESC, m.id DESC LIMIT $7
    )
    SELECT
      (SELECT json_build_object('id', id, 'subject', subject, 'studentName', "studentName",
        'channel', channel, 'teacherLabel', "teacherLabel", 'canReply', "canReply",
        'guardianReference', "guardianReference") FROM visible) AS conversation,
      COALESCE((SELECT json_agg(page ORDER BY "sentAt" DESC, id DESC) FROM page), '[]'::json) AS messages
  `, [...actorScope(actor), id, beforeAt, beforeId, pageSize + 1]);
  if (!result.conversation) return null;
  const messages = result.messages.map(({ hasDocument, ...message }) => ({
    ...message, sentAt: new Date(message.sentAt).toISOString(), ...(hasDocument ? { hasDocument: true } : {}),
  }));
  const { items, nextCursor } = pageByTimestamp(messages, pageSize, 'sentAt');
  return { conversation: result.conversation, messages: items, nextCursor };
}

export async function listParentRecipients(db, actor, childId) {
  const { rows: [result] } = await db.query(`
    SELECT COALESCE((
      SELECT json_agg(json_build_object('id', a.id, 'label', a.login) ORDER BY a.login)
      FROM teacher_classes t JOIN teacher_accounts a ON (a.school_id, a.id) = (t.school_id, t.teacher_id)
      WHERE (t.school_id, t.class_id) = (s.school_id, s.class_id)
        AND a.password_hash IS NOT NULL
    ), '[]'::json) AS teachers
    FROM guardian_students l JOIN students s ON (s.school_id, s.id) = (l.school_id, l.student_id)
    WHERE (l.school_id, l.guardian_id, l.student_id) = ($1, $2, $3) AND s.left_at IS NULL
  `, [actor.school_id, actor.guardian_id, childId]);
  return result ?? null;
}

async function lockActiveTeacher(db, schoolId, teacherId) {
  const { rows: [account] } = await db.query(`
    SELECT login FROM teacher_accounts
    WHERE school_id = $1 AND id = $2 AND password_hash IS NOT NULL FOR SHARE
  `, [schoolId, teacherId]);
  return account;
}

async function lockFamilyLink(db, schoolId, guardianId, childId) {
  const guardian = await db.query('SELECT 1 FROM guardians WHERE school_id = $1 AND id = $2 AND active FOR SHARE',
    [schoolId, guardianId]);
  if (!guardian.rowCount) return false;
  const student = await db.query(`
    SELECT s.class_id
    FROM guardian_students l JOIN students s ON (s.school_id, s.id) = (l.school_id, l.student_id)
    WHERE (l.school_id, l.guardian_id, l.student_id) = ($1, $2, $3) AND s.left_at IS NULL FOR SHARE OF l, s
  `, [schoolId, guardianId, childId]);
  return student.rows[0]?.class_id;
}

async function lockParticipants(db, schoolId, guardianId, childId, teacherId) {
  // L’affectation se modifie sous un verrou exclusif du compte enseignant.
  const teacher = teacherId ? await lockActiveTeacher(db, schoolId, teacherId) : null;
  if (teacherId && !teacher) return null;
  const classId = await lockFamilyLink(db, schoolId, guardianId, childId);
  if (!classId) return null;
  if (teacher) {
    const assignment = await db.query(`
      SELECT 1 FROM teacher_classes WHERE school_id = $1 AND teacher_id = $2 AND class_id = $3
    `, [schoolId, teacherId, classId]);
    if (!assignment.rowCount) return null;
  }
  return { teacherLabel: teacher?.login ?? null };
}

function senderFor(actor) {
  if (actor.guardian_id) return 'parent';
  return actor.teacher_id ? 'teacher' : 'direction';
}

async function insertMessage(db, schoolId, id, sender, body, sentAt, file, key) {
  const messageId = randomUUID();
  const bytes = file ? sealPrivateFile(file.bytes, key, ['message', schoolId, id, messageId]) : null;
  await db.query(`
    INSERT INTO conversation_messages (school_id, conversation_id, id, sender, body, sent_at, attachment_kind, attachment_data)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
  `, [schoolId, id, messageId, sender, body, sentAt, file?.kind ?? null, bytes]);
  return messageId;
}

export async function createConversation(db, actor, { childId, subject, body, teacherId = null, guardianReference, file }, key) {
  const schoolId = actor.school_id;
  const guardianId = actor.guardian_id ?? guardianReference;
  const contactId = actor.teacher_id ?? teacherId;
  const participants = await lockParticipants(db, schoolId, guardianId, childId, contactId);
  if (!participants) return null;
  const id = randomUUID();
  const { rows: [{ last_message_at: sentAt }] } = await db.query(`
    INSERT INTO message_conversations (school_id, id, guardian_id, student_id, subject, channel, teacher_id, teacher_label, last_message_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, date_trunc('milliseconds', clock_timestamp()))
    RETURNING last_message_at
  `, [schoolId, id, guardianId, childId, subject, contactId ? 'teacher' : 'direction', contactId, participants.teacherLabel]);
  await insertMessage(db, schoolId, id, senderFor(actor), body, sentAt, file, key);
  return { id };
}

export async function addMessage(db, actor, id, body, file, key) {
  const parameters = [...actorScope(actor), id];
  const { rows: [target] } = await db.query(`
    SELECT c.guardian_id, c.student_id, c.channel, c.teacher_id
    FROM message_conversations c WHERE ${visibleThread} AND c.id = $4
  `, parameters);
  if (!target || (target.channel === 'teacher' && !target.teacher_id)) return null;
  if (!await lockParticipants(db, actor.school_id, target.guardian_id, target.student_id, target.teacher_id)) return null;

  const { rows: [thread] } = await db.query(`
    UPDATE message_conversations c
    SET last_message_at = greatest(c.last_message_at + interval '1 millisecond', date_trunc('milliseconds', clock_timestamp()))
    WHERE ${visibleThread} AND c.id = $4
    RETURNING c.last_message_at
  `, parameters);
  if (!thread) return null;
  return { id: await insertMessage(db, actor.school_id, id, senderFor(actor), body, thread.last_message_at, file, key) };
}

export async function conversationDocument(db, actor, id, messageId, key) {
  const { rows: [file] } = await db.query(`
    SELECT m.attachment_kind AS kind, m.attachment_data AS data
    FROM message_conversations c JOIN conversation_messages m ON (m.school_id,m.conversation_id) = (c.school_id,c.id)
    WHERE ${visibleThread} AND c.id = $4 AND m.id = $5 AND m.sent_at > ${retainedSince} AND m.attachment_kind IS NOT NULL
  `, [...actorScope(actor), id, messageId]);
  return file ? { kind: file.kind, body: openPrivateFile(file.data, key, ['message', actor.school_id, id, messageId]) } : null;
}
