CREATE TABLE attendance_rolls (
    school_id uuid NOT NULL,
    class_id uuid NOT NULL,
    day date NOT NULL,
    revision uuid NOT NULL,
    PRIMARY KEY (school_id, class_id, day),
    FOREIGN KEY (school_id, class_id) REFERENCES classes(school_id, id) ON DELETE CASCADE
);

CREATE TABLE attendance_entries (
    school_id uuid NOT NULL,
    class_id uuid NOT NULL,
    day date NOT NULL,
    student_id uuid NOT NULL,
    status text NOT NULL CHECK (status IN ('present', 'absent', 'late', 'left')),
    justified boolean NOT NULL DEFAULT false CHECK (status = 'absent' OR NOT justified),
    PRIMARY KEY (school_id, class_id, day, student_id),
    FOREIGN KEY (school_id, class_id, day) REFERENCES attendance_rolls(school_id, class_id, day) ON DELETE CASCADE,
    FOREIGN KEY (school_id, student_id) REFERENCES students(school_id, id) ON DELETE CASCADE
);

CREATE INDEX attendance_rolls_by_day ON attendance_rolls (day);
CREATE INDEX attendance_entries_by_student ON attendance_entries (school_id, student_id, day);
