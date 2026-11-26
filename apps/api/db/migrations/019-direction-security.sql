ALTER TABLE direction_accounts
    ADD COLUMN recovery_email text CHECK (char_length(recovery_email) <= 254),
    ADD COLUMN recovery_verified boolean NOT NULL DEFAULT false CHECK (NOT recovery_verified OR recovery_email IS NOT NULL),
    ADD COLUMN totp_secret bytea,
    ADD COLUMN totp_step bigint,
    ADD COLUMN totp_failed_attempts smallint NOT NULL DEFAULT 0 CHECK (totp_failed_attempts BETWEEN 0 AND 8),
    ADD COLUMN totp_failed_until timestamptz,
    ADD COLUMN totp_pending bytea,
    ADD COLUMN totp_pending_session bytea,
    ADD COLUMN totp_pending_until timestamptz,
    ADD CHECK ((totp_secret IS NULL) = (totp_step IS NULL)),
    ADD CHECK ((totp_pending IS NULL) = (totp_pending_until IS NULL)
        AND (totp_pending IS NULL) = (totp_pending_session IS NULL));

CREATE TABLE direction_recovery_tokens (
    school_id uuid NOT NULL REFERENCES direction_accounts(school_id) ON DELETE CASCADE,
    purpose text NOT NULL CHECK (purpose IN ('verify', 'reset')),
    digest bytea NOT NULL UNIQUE CHECK (octet_length(digest) = 32),
    attempts smallint NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 8),
    issued_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
    expires_at timestamptz NOT NULL,
    PRIMARY KEY (school_id, purpose)
);
