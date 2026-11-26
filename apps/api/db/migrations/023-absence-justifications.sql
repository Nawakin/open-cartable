CREATE TABLE absence_justifications (
    school_id uuid NOT NULL,
    class_id uuid NOT NULL,
    day date NOT NULL,
    student_id uuid NOT NULL,
    guardian_id uuid NOT NULL,
    kind text NOT NULL CHECK (kind IN ('image', 'pdf')),
    content bytea NOT NULL,
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'refused')),
    updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
    PRIMARY KEY (school_id, class_id, day, student_id),
    FOREIGN KEY (school_id, class_id, day, student_id)
      REFERENCES attendance_entries(school_id, class_id, day, student_id) ON DELETE CASCADE,
    FOREIGN KEY (school_id, guardian_id, student_id)
      REFERENCES guardian_students(school_id, guardian_id, student_id) ON DELETE CASCADE
);
