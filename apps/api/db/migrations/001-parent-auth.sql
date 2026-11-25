CREATE TABLE schools (
    id uuid PRIMARY KEY,
    code text NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9][A-Z0-9-]{1,31}$')
);

CREATE TABLE classes (
    school_id uuid NOT NULL REFERENCES schools(id),
    id uuid NOT NULL,
    name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),
    PRIMARY KEY (school_id, id)
);

CREATE TABLE students (
    school_id uuid NOT NULL,
    id uuid NOT NULL,
    class_id uuid NOT NULL,
    display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 100),
    PRIMARY KEY (school_id, id),
    FOREIGN KEY (school_id, class_id) REFERENCES classes(school_id, id)
);

CREATE TABLE guardians (
    school_id uuid NOT NULL REFERENCES schools(id),
    id uuid NOT NULL,
    active boolean NOT NULL DEFAULT true,
    PRIMARY KEY (school_id, id)
);

CREATE TABLE guardian_students (
    school_id uuid NOT NULL,
    guardian_id uuid NOT NULL,
    student_id uuid NOT NULL,
    PRIMARY KEY (school_id, guardian_id, student_id),
    FOREIGN KEY (school_id, guardian_id) REFERENCES guardians(school_id, id) ON DELETE CASCADE,
    FOREIGN KEY (school_id, student_id) REFERENCES students(school_id, id) ON DELETE CASCADE
);

CREATE TABLE parent_invitations (
    digest bytea PRIMARY KEY,
    school_id uuid NOT NULL,
    guardian_id uuid NOT NULL,
    expires_at timestamptz NOT NULL,
    consumed_at timestamptz,
    revoked_at timestamptz,
    FOREIGN KEY (school_id, guardian_id) REFERENCES guardians(school_id, id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX parent_invitations_one_pending
    ON parent_invitations (school_id, guardian_id)
    WHERE consumed_at IS NULL AND revoked_at IS NULL;

CREATE TABLE parent_sessions (
    id uuid PRIMARY KEY,
    school_id uuid NOT NULL,
    guardian_id uuid NOT NULL,
    expires_at timestamptz NOT NULL,
    revoked_at timestamptz,
    FOREIGN KEY (school_id, guardian_id) REFERENCES guardians(school_id, id) ON DELETE CASCADE
);

CREATE INDEX parent_sessions_by_guardian ON parent_sessions (school_id, guardian_id);
CREATE INDEX parent_sessions_by_expiration ON parent_sessions (expires_at);

CREATE TABLE parent_refresh_tokens (
    digest bytea PRIMARY KEY,
    session_id uuid NOT NULL REFERENCES parent_sessions(id) ON DELETE CASCADE,
    consumed_at timestamptz
);

CREATE UNIQUE INDEX parent_refresh_tokens_one_active
    ON parent_refresh_tokens (session_id) WHERE consumed_at IS NULL;
