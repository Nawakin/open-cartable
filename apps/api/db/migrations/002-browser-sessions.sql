CREATE TABLE parent_browser_sessions (
    digest bytea PRIMARY KEY,
    session_id uuid NOT NULL UNIQUE REFERENCES parent_sessions(id) ON DELETE CASCADE
);
