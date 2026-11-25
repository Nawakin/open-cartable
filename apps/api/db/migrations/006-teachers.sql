CREATE TABLE teacher_accounts (
    school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    id uuid NOT NULL,
    login text NOT NULL CHECK (login ~ '^[a-z0-9][a-z0-9._-]{2,31}$'),
    password_salt bytea CHECK (octet_length(password_salt) = 16),
    password_hash bytea CHECK (octet_length(password_hash) = 32),
    activation_digest bytea CHECK (octet_length(activation_digest) = 32),
    activation_expires_at timestamptz,
    PRIMARY KEY (school_id, id),
    UNIQUE (school_id, login),
    CHECK (
        (password_salt IS NULL AND password_hash IS NULL AND activation_digest IS NOT NULL AND activation_expires_at IS NOT NULL)
        OR (password_salt IS NOT NULL AND password_hash IS NOT NULL AND activation_digest IS NULL AND activation_expires_at IS NULL)
    )
);

CREATE TABLE teacher_classes (
    school_id uuid NOT NULL,
    teacher_id uuid NOT NULL,
    class_id uuid NOT NULL,
    PRIMARY KEY (school_id, teacher_id, class_id),
    FOREIGN KEY (school_id, teacher_id) REFERENCES teacher_accounts(school_id, id) ON DELETE CASCADE,
    FOREIGN KEY (school_id, class_id) REFERENCES classes(school_id, id) ON DELETE CASCADE
);

CREATE TABLE teacher_sessions (
    digest bytea PRIMARY KEY CHECK (octet_length(digest) = 32),
    school_id uuid NOT NULL,
    teacher_id uuid NOT NULL,
    expires_at timestamptz NOT NULL,
    FOREIGN KEY (school_id, teacher_id) REFERENCES teacher_accounts(school_id, id) ON DELETE CASCADE
);

CREATE INDEX teacher_sessions_by_account ON teacher_sessions (school_id, teacher_id);
CREATE INDEX teacher_sessions_by_expiry ON teacher_sessions (expires_at);
