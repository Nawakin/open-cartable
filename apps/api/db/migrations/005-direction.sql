CREATE TABLE direction_accounts (
    school_id uuid PRIMARY KEY REFERENCES schools(id) ON DELETE CASCADE,
    password_salt bytea NOT NULL CHECK (octet_length(password_salt) = 16),
    password_hash bytea NOT NULL CHECK (octet_length(password_hash) = 32)
);

CREATE TABLE direction_sessions (
    digest bytea PRIMARY KEY CHECK (octet_length(digest) = 32),
    school_id uuid NOT NULL REFERENCES direction_accounts(school_id) ON DELETE CASCADE,
    expires_at timestamptz NOT NULL
);

CREATE INDEX direction_sessions_by_school ON direction_sessions (school_id);
CREATE INDEX direction_sessions_by_expiry ON direction_sessions (expires_at);
