ALTER TABLE message_conversations
    ADD COLUMN parent_read_at timestamptz,
    ADD COLUMN staff_read_at timestamptz;
