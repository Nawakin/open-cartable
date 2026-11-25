CREATE TABLE liaison_notes (
    school_id uuid NOT NULL,
    id uuid NOT NULL,
    class_id uuid NOT NULL,
    note_day date NOT NULL,
    body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 1000),
    published_at timestamptz NOT NULL DEFAULT statement_timestamp(),
    PRIMARY KEY (school_id, id),
    UNIQUE (school_id, class_id, note_day),
    FOREIGN KEY (school_id, class_id) REFERENCES classes(school_id, id) ON DELETE CASCADE
);

CREATE TABLE liaison_replies (
    school_id uuid NOT NULL,
    id uuid NOT NULL,
    note_id uuid NOT NULL,
    guardian_id uuid NOT NULL,
    student_id uuid NOT NULL,
    body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 500),
    PRIMARY KEY (school_id, id),
    UNIQUE (school_id, note_id, guardian_id, student_id),
    FOREIGN KEY (school_id, note_id) REFERENCES liaison_notes(school_id, id) ON DELETE CASCADE,
    FOREIGN KEY (school_id, guardian_id, student_id)
        REFERENCES guardian_students(school_id, guardian_id, student_id) ON DELETE CASCADE
);

CREATE INDEX liaison_notes_by_expiry ON liaison_notes (published_at);
CREATE INDEX liaison_replies_by_note ON liaison_replies (school_id, note_id, id);
CREATE INDEX liaison_replies_by_guardianship ON liaison_replies (school_id, guardian_id, student_id);
