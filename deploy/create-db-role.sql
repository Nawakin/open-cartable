SELECT pg_advisory_xact_lock(192615, 2);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'open_cartable') THEN
        EXECUTE format('CREATE ROLE open_cartable LOGIN PASSWORD %L', pg_read_file('/run/postgres-secrets/password'));
    END IF;
END $$;

ALTER DATABASE open_cartable OWNER TO open_cartable;
