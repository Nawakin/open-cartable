CREATE TABLE school_reports (
    school_id uuid NOT NULL,
    id uuid NOT NULL,
    class_id uuid NOT NULL,
    student_id uuid NOT NULL,
    school_year smallint NOT NULL CHECK (school_year BETWEEN 1900 AND 9999),
    term smallint NOT NULL CHECK (term BETWEEN 1 AND 3),
    assessments jsonb NOT NULL CHECK (jsonb_typeof(assessments) = 'array'),
    appreciation text NOT NULL DEFAULT '' CHECK (char_length(appreciation) <= 2000),
    published boolean NOT NULL DEFAULT false,
    revision uuid NOT NULL,
    PRIMARY KEY (school_id, id),
    UNIQUE (school_id, student_id, school_year, term),
    FOREIGN KEY (school_id, class_id) REFERENCES classes(school_id, id),
    FOREIGN KEY (school_id, student_id) REFERENCES students(school_id, id) ON DELETE CASCADE
);
