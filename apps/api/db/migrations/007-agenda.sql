CREATE TABLE agenda_events (
    school_id uuid NOT NULL REFERENCES schools(id),
    id uuid NOT NULL,
    class_id uuid,
    starts_at timestamptz NOT NULL,
    ends_at timestamptz NOT NULL CHECK (ends_at > starts_at),
    title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
    location text NOT NULL CHECK (char_length(location) <= 160),
    description text NOT NULL CHECK (char_length(description) <= 2500),
    PRIMARY KEY (school_id, id),
    FOREIGN KEY (school_id, class_id) REFERENCES classes(school_id, id)
);

CREATE INDEX agenda_events_by_scope ON agenda_events (school_id, class_id, starts_at, id);
