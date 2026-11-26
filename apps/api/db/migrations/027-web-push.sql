CREATE TABLE parent_push_subscriptions (
    session_id uuid PRIMARY KEY REFERENCES parent_sessions(id) ON DELETE CASCADE,
    subscription bytea NOT NULL,
    notified_at timestamptz NOT NULL DEFAULT statement_timestamp(),
    attempted_at timestamptz NOT NULL DEFAULT '-infinity'
);
CREATE TABLE parent_push_events (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    class_id uuid,
    guardian_id uuid,
    student_id uuid,
    created_at timestamptz NOT NULL DEFAULT statement_timestamp()
);
CREATE INDEX parent_push_events_expiration ON parent_push_events (created_at);
CREATE INDEX parent_push_events_school ON parent_push_events (school_id, created_at);

CREATE FUNCTION queue_parent_push() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_TABLE_NAME = 'conversation_messages' THEN
        IF NEW.sender <> 'parent' THEN
            INSERT INTO parent_push_events (school_id, guardian_id, student_id)
            SELECT school_id, guardian_id, student_id FROM message_conversations
            WHERE (school_id, id) = (NEW.school_id, NEW.conversation_id);
        END IF;
    ELSIF TG_TABLE_NAME = 'class_blog_articles' THEN
        IF NEW.published_at IS NOT NULL AND OLD.published_at IS NULL THEN
            INSERT INTO parent_push_events (school_id, class_id) VALUES (NEW.school_id, NEW.class_id);
        END IF;
    ELSIF TG_TABLE_NAME = 'agenda_events' THEN
        IF NEW.ends_at > statement_timestamp() THEN
            INSERT INTO parent_push_events (school_id, class_id, guardian_id, student_id)
            VALUES (NEW.school_id, NEW.class_id, NEW.appointment_guardian_id, NEW.appointment_student_id);
        END IF;
    ELSE
        INSERT INTO parent_push_events (school_id, class_id) VALUES (NEW.school_id, NEW.class_id);
    END IF;
    RETURN NULL;
END;
$$;

CREATE TRIGGER push_new_staff_message AFTER INSERT ON conversation_messages
    FOR EACH ROW EXECUTE FUNCTION queue_parent_push();
CREATE TRIGGER push_new_homework AFTER INSERT ON homework_entries
    FOR EACH ROW EXECUTE FUNCTION queue_parent_push();
CREATE TRIGGER push_new_liaison AFTER INSERT ON liaison_notes
    FOR EACH ROW EXECUTE FUNCTION queue_parent_push();
CREATE TRIGGER push_new_agenda AFTER INSERT ON agenda_events
    FOR EACH ROW EXECUTE FUNCTION queue_parent_push();
CREATE TRIGGER push_published_blog AFTER UPDATE OF published_at ON class_blog_articles
    FOR EACH ROW EXECUTE FUNCTION queue_parent_push();
