CREATE TABLE parent_teacher_links (
    school_id uuid NOT NULL,
    guardian_id uuid NOT NULL,
    teacher_id uuid NOT NULL,
    PRIMARY KEY (school_id, guardian_id),
    UNIQUE (school_id, teacher_id),
    FOREIGN KEY (school_id, guardian_id) REFERENCES guardians(school_id, id) ON DELETE CASCADE,
    FOREIGN KEY (school_id, teacher_id) REFERENCES teacher_accounts(school_id, id) ON DELETE CASCADE
);
