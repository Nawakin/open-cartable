CREATE TABLE school_activities (
    school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    id uuid NOT NULL,
    teacher_id uuid,
    kind text NOT NULL CHECK (kind IN ('announcement','invitation','slot')),
    class_ids uuid[] NOT NULL CHECK (cardinality(class_ids) <= 100),
    title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
    body text NOT NULL CHECK (char_length(body) <= 2500),
    needs_receipt boolean NOT NULL DEFAULT false,
    publish_at timestamptz,
    starts_at timestamptz,
    ends_at timestamptz,
    updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
    attachment_kind text,
    attachment_data bytea,
    PRIMARY KEY (school_id,id),
    CHECK ((attachment_kind IS NULL) = (attachment_data IS NULL)),
    CHECK (attachment_kind IN ('pdf','image')),
    FOREIGN KEY (school_id,teacher_id) REFERENCES teacher_accounts(school_id,id) ON DELETE CASCADE,
    CHECK (teacher_id IS NULL OR cardinality(class_ids) > 0),
    CHECK ((kind = 'announcement' AND starts_at IS NULL AND ends_at IS NULL)
        OR (kind <> 'announcement' AND starts_at IS NOT NULL AND ends_at > starts_at
            AND NOT needs_receipt AND (publish_at IS NULL OR publish_at < starts_at))),
    CHECK (kind <> 'slot' OR cardinality(class_ids) = 1)
);
CREATE INDEX school_activities_publication ON school_activities (school_id,publish_at DESC);

CREATE TABLE school_activity_responses (
    school_id uuid NOT NULL,
    activity_id uuid NOT NULL,
    guardian_id uuid NOT NULL,
    student_id uuid,
    answer text NOT NULL CHECK (answer IN ('read','yes','no','booked')),
    agenda_id uuid,
    updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
    UNIQUE NULLS NOT DISTINCT (school_id,activity_id,guardian_id,student_id),
    FOREIGN KEY (school_id,activity_id) REFERENCES school_activities(school_id,id) ON DELETE CASCADE,
    FOREIGN KEY (school_id,guardian_id) REFERENCES guardians(school_id,id) ON DELETE CASCADE,
    FOREIGN KEY (school_id,guardian_id,student_id)
        REFERENCES guardian_students(school_id,guardian_id,student_id) ON DELETE CASCADE,
    FOREIGN KEY (school_id,agenda_id) REFERENCES agenda_events(school_id,id) ON DELETE CASCADE,
    CHECK ((answer = 'read') = (student_id IS NULL)),
    CHECK ((answer IN ('yes','booked')) = (agenda_id IS NOT NULL))
);
CREATE UNIQUE INDEX school_activity_unique_booking ON school_activity_responses (school_id,activity_id)
    WHERE answer = 'booked';

CREATE TABLE planned_absences (
    school_id uuid NOT NULL,
    guardian_id uuid NOT NULL,
    student_id uuid NOT NULL,
    day date NOT NULL,
    reason text NOT NULL CHECK (char_length(reason) <= 300),
    PRIMARY KEY (school_id,guardian_id,student_id,day),
    FOREIGN KEY (school_id,guardian_id,student_id)
        REFERENCES guardian_students(school_id,guardian_id,student_id) ON DELETE CASCADE
);
CREATE INDEX planned_absences_by_day ON planned_absences (school_id,day);

CREATE TABLE teaching_templates (
    school_id uuid NOT NULL,
    teacher_id uuid NOT NULL,
    id uuid NOT NULL,
    kind text NOT NULL CHECK (kind IN ('homework','liaison')),
    name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
    content jsonb NOT NULL CHECK (jsonb_typeof(content) = 'object'),
    PRIMARY KEY (school_id,teacher_id,id),
    FOREIGN KEY (school_id,teacher_id) REFERENCES teacher_accounts(school_id,id) ON DELETE CASCADE,
    UNIQUE (school_id,teacher_id,kind,name)
);

ALTER TABLE homework_entries ADD COLUMN publish_at timestamptz DEFAULT statement_timestamp();
ALTER TABLE parent_push_events ADD COLUMN homework_id uuid, ADD COLUMN liaison_note_id uuid;
ALTER TABLE parent_push_events
    ADD FOREIGN KEY (school_id,class_id,homework_id) REFERENCES homework_entries(school_id,class_id,id) ON DELETE CASCADE,
    ADD FOREIGN KEY (school_id,liaison_note_id) REFERENCES liaison_notes(school_id,id) ON DELETE CASCADE;
CREATE INDEX push_events_homework ON parent_push_events (school_id,class_id,homework_id) WHERE homework_id IS NOT NULL;
CREATE INDEX push_events_liaison ON parent_push_events (school_id,liaison_note_id) WHERE liaison_note_id IS NOT NULL;

CREATE FUNCTION queue_class_publication() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    scheduled timestamptz;
    category text;
BEGIN
    IF TG_TABLE_NAME = 'homework_entries' THEN
        IF TG_OP = 'UPDATE' THEN
            IF (OLD.publish_at IS NOT NULL AND OLD.publish_at <= statement_timestamp()) OR
                (NEW.publish_at,NEW.kind) IS NOT DISTINCT FROM (OLD.publish_at,OLD.kind) THEN RETURN NULL; END IF;
            DELETE FROM parent_push_events WHERE (school_id,class_id,homework_id) = (NEW.school_id,NEW.class_id,NEW.id);
        END IF;
        scheduled := NEW.publish_at;
        IF scheduled IS NULL THEN RETURN NULL; END IF;
        category := CASE WHEN NEW.kind = 'assignment' THEN 'assignments' ELSE 'homework' END;
        INSERT INTO parent_push_events (school_id,class_id,homework_id,kind,deliver_after,deliver_until)
        VALUES (NEW.school_id,NEW.class_id,NEW.id,category,scheduled,scheduled + interval '24 hours');
    ELSE
        INSERT INTO parent_push_events (school_id,class_id,liaison_note_id,kind,deliver_after,deliver_until)
        VALUES (NEW.school_id,NEW.class_id,NEW.id,'liaison',NEW.published_at,NEW.published_at + interval '24 hours');
    END IF;
    RETURN NULL;
END;
$$;

DROP TRIGGER push_new_homework ON homework_entries;
DROP TRIGGER push_new_liaison ON liaison_notes;
CREATE TRIGGER push_new_homework AFTER INSERT OR UPDATE OF publish_at,kind ON homework_entries
    FOR EACH ROW EXECUTE FUNCTION queue_class_publication();
CREATE TRIGGER push_new_liaison AFTER INSERT ON liaison_notes
    FOR EACH ROW EXECUTE FUNCTION queue_class_publication();

CREATE TABLE directory_access_log (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    guardian_id uuid NOT NULL,
    student_id uuid,
    action text NOT NULL CHECK (action IN ('created','linked','unlinked','suspended','reactivated','invited','sessions-replaced')),
    occurred_at timestamptz NOT NULL DEFAULT statement_timestamp()
);
CREATE INDEX directory_access_log_latest ON directory_access_log (school_id,id DESC);
