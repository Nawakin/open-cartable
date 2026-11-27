ALTER TABLE homework_entries ADD COLUMN kind text NOT NULL DEFAULT 'notebook' CHECK (kind IN ('notebook', 'assignment'));
ALTER TABLE parent_push_subscriptions DROP CONSTRAINT parent_push_subscriptions_categories_check;
ALTER TABLE parent_push_subscriptions DROP CONSTRAINT parent_push_subscriptions_payload_version_check;
ALTER TABLE parent_push_subscriptions
    ALTER COLUMN categories SET DEFAULT '{homework,assignments,messages,liaison,blog,agenda,agenda-reminder,attendance,reports,library}',
    ADD CHECK (categories <@ ARRAY['homework','assignments','messages','liaison','blog','agenda','agenda-reminder','attendance','reports','library']),
    ADD CHECK (payload_version IN (1,2,3));
UPDATE parent_push_subscriptions SET categories = array_append(categories, 'assignments') WHERE 'homework' = ANY(categories);
UPDATE parent_push_subscriptions SET categories = array_append(categories, 'agenda-reminder') WHERE 'agenda' = ANY(categories);

ALTER TABLE parent_push_events DROP CONSTRAINT parent_push_events_kind_check;
ALTER TABLE parent_push_events
    ADD CHECK (kind IN ('general','homework','assignments','messages','liaison','blog','agenda','agenda-reminder','attendance','reports','library'));

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
    ELSIF TG_TABLE_NAME = 'school_reports' THEN
        IF NEW.published AND (TG_OP = 'INSERT' OR NOT OLD.published) THEN
            INSERT INTO parent_push_events (school_id, student_id, kind) VALUES (NEW.school_id, NEW.student_id, 'reports');
        END IF;
    ELSIF TG_TABLE_NAME = 'class_media' THEN
        IF NEW.article_id IS NULL THEN
            INSERT INTO parent_push_events (school_id, class_id, kind) VALUES (NEW.school_id, NEW.class_id, 'library');
        END IF;
    ELSIF TG_TABLE_NAME = 'homework_entries' THEN
        INSERT INTO parent_push_events (school_id, class_id, kind)
        VALUES (NEW.school_id, NEW.class_id, CASE WHEN NEW.kind = 'assignment' THEN 'assignments' ELSE 'homework' END);
    ELSE
        INSERT INTO parent_push_events (school_id, class_id, kind) VALUES (NEW.school_id, NEW.class_id, 'liaison');
    END IF;
    RETURN NULL;
END;
$$;

CREATE TRIGGER push_published_report AFTER INSERT OR UPDATE OF published ON school_reports
    FOR EACH ROW EXECUTE FUNCTION queue_parent_push();
CREATE TRIGGER push_new_library_resource AFTER INSERT ON class_media
    FOR EACH ROW EXECUTE FUNCTION queue_parent_push();
