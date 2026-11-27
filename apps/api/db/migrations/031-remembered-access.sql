CREATE TABLE direction_devices (
    digest bytea PRIMARY KEY CHECK (octet_length(digest) = 32),
    school_id uuid NOT NULL REFERENCES direction_accounts(school_id) ON DELETE CASCADE,
    expires_at timestamptz NOT NULL
);
CREATE INDEX direction_devices_expiry ON direction_devices (expires_at);
CREATE INDEX direction_devices_school ON direction_devices (school_id);

ALTER TABLE direction_sessions
    ADD COLUMN assurance text NOT NULL DEFAULT 'legacy' CHECK (assurance IN ('legacy','enroll','totp')),
    ADD COLUMN device_digest bytea REFERENCES direction_devices(digest) ON DELETE CASCADE;
CREATE INDEX direction_sessions_device ON direction_sessions (device_digest) WHERE device_digest IS NOT NULL;
