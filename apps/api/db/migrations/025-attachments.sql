ALTER TABLE homework_entries
    ADD COLUMN attachment_kind text CHECK (attachment_kind IN ('image', 'pdf')),
    ADD COLUMN attachment_data bytea,
    ADD CHECK ((attachment_kind IS NULL) = (attachment_data IS NULL));

ALTER TABLE conversation_messages
    ADD COLUMN attachment_kind text CHECK (attachment_kind IN ('image', 'pdf')),
    ADD COLUMN attachment_data bytea,
    ADD CHECK ((attachment_kind IS NULL) = (attachment_data IS NULL));
