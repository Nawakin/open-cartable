ALTER TABLE parent_push_subscriptions
    ADD COLUMN subscribed_at timestamptz NOT NULL DEFAULT statement_timestamp(),
    ADD COLUMN categories text[] NOT NULL DEFAULT '{homework,messages,liaison,blog,agenda,attendance}'
        CHECK (categories <@ ARRAY['homework','messages','liaison','blog','agenda','attendance']),
    ADD COLUMN weekends boolean NOT NULL DEFAULT true,
    ADD COLUMN payload_version smallint NOT NULL DEFAULT 1 CHECK (payload_version IN (1, 2));
UPDATE parent_push_subscriptions SET subscribed_at = notified_at;
ALTER TABLE parent_push_subscriptions DROP COLUMN notified_at;

ALTER TABLE parent_push_events
    ADD COLUMN kind text NOT NULL DEFAULT 'general'
        CHECK (kind IN ('general','homework','messages','liaison','blog','agenda','agenda-reminder','attendance')),
    ADD COLUMN deliver_after timestamptz NOT NULL DEFAULT statement_timestamp(),
    ADD COLUMN deliver_until timestamptz NOT NULL DEFAULT (statement_timestamp() + interval '15 minutes'),
    ADD COLUMN agenda_id uuid,
    ADD COLUMN absence_day date,
    ADD CONSTRAINT push_agenda_fk FOREIGN KEY (school_id, agenda_id)
        REFERENCES agenda_events (school_id, id) ON DELETE CASCADE,
    ADD CONSTRAINT push_attendance_fk FOREIGN KEY (school_id, class_id, absence_day, student_id)
        REFERENCES attendance_entries (school_id, class_id, day, student_id) ON DELETE CASCADE;
UPDATE parent_push_events SET deliver_after = created_at, deliver_until = created_at + interval '15 minutes';
ALTER TABLE parent_push_events ADD CONSTRAINT push_delivery_window CHECK (deliver_until > deliver_after);
DROP INDEX parent_push_events_expiration;
DROP INDEX parent_push_events_school;
CREATE INDEX parent_push_events_expiration ON parent_push_events (deliver_until);
CREATE INDEX parent_push_events_school ON parent_push_events (school_id, deliver_after);
CREATE INDEX parent_push_events_agenda ON parent_push_events (school_id, agenda_id) WHERE agenda_id IS NOT NULL;
CREATE UNIQUE INDEX parent_push_events_attendance ON parent_push_events (school_id, class_id, absence_day, student_id)
    WHERE absence_day IS NOT NULL;

CREATE TABLE parent_push_deliveries (
    event_id bigint NOT NULL REFERENCES parent_push_events(id) ON DELETE CASCADE,
    session_id uuid NOT NULL REFERENCES parent_push_subscriptions(session_id) ON DELETE CASCADE,
    PRIMARY KEY (session_id, event_id)
);
CREATE INDEX parent_push_deliveries_by_event ON parent_push_deliveries (event_id);

CREATE OR REPLACE FUNCTION queue_parent_push() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_TABLE_NAME = 'conversation_messages' THEN
        IF NEW.sender <> 'parent' THEN
            INSERT INTO parent_push_events (school_id, guardian_id, student_id, kind)
            SELECT school_id, guardian_id, student_id, 'messages' FROM message_conversations
            WHERE (school_id, id) = (NEW.school_id, NEW.conversation_id);
        END IF;
    ELSIF TG_TABLE_NAME = 'class_blog_articles' THEN
        IF NEW.published_at IS NOT NULL AND OLD.published_at IS NULL THEN
            INSERT INTO parent_push_events (school_id, class_id, kind) VALUES (NEW.school_id, NEW.class_id, 'blog');
        END IF;
    ELSE
        INSERT INTO parent_push_events (school_id, class_id, kind)
        VALUES (NEW.school_id, NEW.class_id, CASE WHEN TG_TABLE_NAME = 'homework_entries' THEN 'homework' ELSE 'liaison' END);
    END IF;
    RETURN NULL;
END;
$$;

DROP TRIGGER push_new_agenda ON agenda_events;
CREATE FUNCTION queue_agenda_push() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    now_at timestamptz := statement_timestamp();
    reminder_at timestamptz := NEW.starts_at - interval '24 hours';
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF (OLD.starts_at, OLD.class_id, OLD.appointment_guardian_id, OLD.appointment_student_id)
            IS NOT DISTINCT FROM (NEW.starts_at, NEW.class_id, NEW.appointment_guardian_id, NEW.appointment_student_id) THEN
            RETURN NULL;
        END IF;
        DELETE FROM parent_push_events WHERE (school_id, agenda_id) = (NEW.school_id, NEW.id);
    END IF;
    IF NEW.ends_at > now_at THEN
        INSERT INTO parent_push_events (school_id, class_id, guardian_id, student_id, agenda_id, kind)
        VALUES (NEW.school_id, NEW.class_id, NEW.appointment_guardian_id, NEW.appointment_student_id, NEW.id, 'agenda');
    END IF;
    IF reminder_at > now_at THEN
        INSERT INTO parent_push_events (school_id, class_id, guardian_id, student_id, agenda_id, kind, deliver_after, deliver_until)
        VALUES (NEW.school_id, NEW.class_id, NEW.appointment_guardian_id, NEW.appointment_student_id,
            NEW.id, 'agenda-reminder', reminder_at, reminder_at + interval '4 hours');
    END IF;
    RETURN NULL;
END;
$$;
CREATE TRIGGER push_agenda_changes AFTER INSERT OR UPDATE OF starts_at, class_id, appointment_guardian_id, appointment_student_id
    ON agenda_events FOR EACH ROW EXECUTE FUNCTION queue_agenda_push();

INSERT INTO parent_push_events (school_id, class_id, guardian_id, student_id, agenda_id, kind, deliver_after, deliver_until)
SELECT school_id, class_id, appointment_guardian_id, appointment_student_id, id,
    'agenda-reminder', starts_at - interval '24 hours', starts_at - interval '20 hours'
FROM agenda_events WHERE starts_at - interval '24 hours' > statement_timestamp();

CREATE FUNCTION queue_absence_push() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    reminder_at timestamptz := ((NEW.day + 1) + time '09:00') AT TIME ZONE 'Europe/Paris';
BEGIN
    IF NEW.status = 'absent' AND NOT NEW.justified AND reminder_at > statement_timestamp() THEN
        INSERT INTO parent_push_events (school_id, class_id, student_id, absence_day, kind, deliver_after, deliver_until)
        VALUES (NEW.school_id, NEW.class_id, NEW.student_id, NEW.day, 'attendance', reminder_at, reminder_at + interval '8 hours')
        ON CONFLICT (school_id, class_id, absence_day, student_id) WHERE absence_day IS NOT NULL DO NOTHING;
    END IF;
    RETURN NULL;
END;
$$;
CREATE TRIGGER push_absence_changes AFTER INSERT OR UPDATE OF status, justified
    ON attendance_entries FOR EACH ROW EXECUTE FUNCTION queue_absence_push();

INSERT INTO parent_push_events (school_id, class_id, student_id, absence_day, kind, deliver_after, deliver_until)
SELECT school_id, class_id, student_id, day, 'attendance', local_due, local_due + interval '8 hours'
FROM attendance_entries
CROSS JOIN LATERAL (SELECT ((day + 1) + time '09:00') AT TIME ZONE 'Europe/Paris' AS local_due) timing
WHERE day >= (statement_timestamp() AT TIME ZONE 'Europe/Paris')::date - 1
    AND status = 'absent' AND NOT justified AND local_due > statement_timestamp();
