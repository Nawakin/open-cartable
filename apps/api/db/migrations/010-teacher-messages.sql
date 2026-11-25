ALTER TABLE direction_conversations RENAME TO message_conversations;
ALTER TABLE direction_messages RENAME TO conversation_messages;

ALTER TABLE message_conversations
    ADD COLUMN channel text NOT NULL DEFAULT 'direction',
    ADD COLUMN teacher_id uuid,
    ADD COLUMN teacher_label text,
    ADD CONSTRAINT message_conversation_channel CHECK (
        (channel = 'direction' AND teacher_id IS NULL AND teacher_label IS NULL)
        OR (channel = 'teacher' AND teacher_label IS NOT NULL AND char_length(teacher_label) BETWEEN 3 AND 32)
    ),
    ADD CONSTRAINT message_conversation_teacher FOREIGN KEY (school_id, teacher_id)
        REFERENCES teacher_accounts(school_id, id) ON DELETE SET NULL (teacher_id);

CREATE INDEX message_conversations_by_teacher ON message_conversations (school_id, teacher_id, last_message_at DESC, id DESC)
    WHERE channel = 'teacher';

ALTER TABLE conversation_messages DROP CONSTRAINT direction_messages_sender_check;
ALTER TABLE conversation_messages ADD CONSTRAINT conversation_messages_sender_check
    CHECK (sender IN ('parent', 'direction', 'teacher'));
