CREATE TABLE direction_conversations (
    school_id uuid NOT NULL,
    id uuid NOT NULL,
    guardian_id uuid NOT NULL,
    student_id uuid NOT NULL,
    subject text NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 120),
    last_message_at timestamptz NOT NULL,
    PRIMARY KEY (school_id, id),
    FOREIGN KEY (school_id, guardian_id, student_id)
        REFERENCES guardian_students(school_id, guardian_id, student_id) ON DELETE CASCADE
);

CREATE INDEX direction_conversations_by_latest ON direction_conversations (school_id, last_message_at DESC, id DESC);
CREATE INDEX direction_conversations_by_guardian ON direction_conversations (school_id, guardian_id, student_id);
CREATE INDEX direction_conversations_by_expiry ON direction_conversations (last_message_at);

CREATE TABLE direction_messages (
    school_id uuid NOT NULL,
    conversation_id uuid NOT NULL,
    id uuid NOT NULL,
    sender text NOT NULL CHECK (sender IN ('parent', 'direction')),
    body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4000),
    sent_at timestamptz NOT NULL,
    PRIMARY KEY (school_id, conversation_id, id),
    FOREIGN KEY (school_id, conversation_id) REFERENCES direction_conversations(school_id, id) ON DELETE CASCADE
);

CREATE INDEX direction_messages_by_conversation ON direction_messages (school_id, conversation_id, sent_at DESC, id DESC);
CREATE INDEX direction_messages_by_expiry ON direction_messages (sent_at);
