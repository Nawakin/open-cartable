CREATE TABLE homework_entries (
    school_id uuid NOT NULL,
    class_id uuid NOT NULL,
    id uuid NOT NULL,
    entry_date date NOT NULL CHECK (entry_date BETWEEN DATE '0001-01-01' AND DATE '9999-12-31'),
    title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
    domain text NOT NULL CHECK (char_length(domain) BETWEEN 1 AND 80),
    description text NOT NULL CHECK (char_length(description) BETWEEN 1 AND 2500),
    PRIMARY KEY (school_id, class_id, id),
    FOREIGN KEY (school_id, class_id) REFERENCES classes(school_id, id)
);

CREATE INDEX homework_entries_by_class_date
    ON homework_entries (school_id, class_id, entry_date DESC, id DESC);
