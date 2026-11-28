ALTER TABLE parent_sessions ADD COLUMN device_name text, ADD COLUMN device_os text, ADD COLUMN device_type text,
    ADD COLUMN last_seen timestamptz;
ALTER TABLE teacher_sessions ADD COLUMN public_id uuid NOT NULL DEFAULT gen_random_uuid(),
    ADD COLUMN device_name text, ADD COLUMN device_os text, ADD COLUMN device_type text, ADD COLUMN last_seen timestamptz;
ALTER TABLE teacher_sessions ADD UNIQUE (public_id);
ALTER TABLE direction_devices ADD COLUMN public_id uuid NOT NULL DEFAULT gen_random_uuid(),
    ADD COLUMN device_name text, ADD COLUMN device_os text, ADD COLUMN device_type text, ADD COLUMN last_seen timestamptz;
ALTER TABLE direction_devices ADD UNIQUE (public_id);
CREATE TABLE device_pairings (
    school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    role text NOT NULL CHECK (role IN ('parent','teacher','direction')),
    actor_id uuid NOT NULL,
    source_device uuid NOT NULL,
    digest bytea NOT NULL CHECK (octet_length(digest)=32),
    expires_at timestamptz NOT NULL,
    PRIMARY KEY (school_id,role,actor_id),
    UNIQUE (school_id,role,digest)
);
CREATE INDEX device_pairings_expires ON device_pairings (expires_at);
