ALTER TABLE parent_push_subscriptions
    ADD COLUMN transport text NOT NULL DEFAULT 'web' CHECK (transport IN ('web', 'fcm', 'apns')),
    ADD COLUMN device_digest bytea,
    ADD CONSTRAINT push_subscription_device
        CHECK ((transport = 'web' AND device_digest IS NULL)
            OR (transport <> 'web' AND octet_length(device_digest) = 32 AND device_digest IS NOT NULL));

CREATE UNIQUE INDEX parent_push_subscriptions_device
    ON parent_push_subscriptions (transport, device_digest) WHERE device_digest IS NOT NULL;
