ALTER TABLE agenda_events
    ADD COLUMN appointment_student_id uuid,
    ADD COLUMN appointment_guardian_id uuid,
    ADD COLUMN appointment_teacher_id uuid,
    ADD CONSTRAINT agenda_appointment_audience CHECK (
        (appointment_student_id IS NULL AND appointment_guardian_id IS NULL AND appointment_teacher_id IS NULL)
        OR (class_id IS NOT NULL AND appointment_student_id IS NOT NULL AND appointment_guardian_id IS NOT NULL)
    ),
    ADD CONSTRAINT agenda_appointment_guardian FOREIGN KEY (school_id, appointment_guardian_id, appointment_student_id)
        REFERENCES guardian_students(school_id, guardian_id, student_id) ON DELETE CASCADE,
    ADD CONSTRAINT agenda_appointment_teacher FOREIGN KEY (school_id, appointment_teacher_id)
        REFERENCES teacher_accounts(school_id, id) ON DELETE SET NULL (appointment_teacher_id);

CREATE INDEX agenda_events_by_appointment_recipient
    ON agenda_events (school_id, appointment_guardian_id, appointment_student_id, starts_at, id)
    WHERE appointment_student_id IS NOT NULL;
