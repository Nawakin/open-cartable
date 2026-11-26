ALTER TABLE schools ADD COLUMN school_year smallint CHECK (school_year BETWEEN 1900 AND 9999);
ALTER TABLE classes
  ADD COLUMN archived_year smallint CHECK (archived_year BETWEEN 1900 AND 9998),
  ADD COLUMN levels text[] NOT NULL DEFAULT '{}' CHECK (levels <@ ARRAY['TPS','PS','MS','GS','CP','CE1','CE2','CM1','CM2']);
ALTER TABLE students
  ADD COLUMN grade text CHECK (grade IN ('TPS','PS','MS','GS','CP','CE1','CE2','CM1','CM2')),
  ADD COLUMN left_at timestamptz;

CREATE INDEX classes_archive_by_year ON classes (school_id, archived_year) WHERE archived_year IS NOT NULL;

CREATE TABLE school_year_changes (
    school_id uuid NOT NULL REFERENCES schools(id),
    source_year smallint NOT NULL,
    revision uuid NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
    moved integer NOT NULL DEFAULT 0 CHECK (moved >= 0),
    departed integer NOT NULL DEFAULT 0 CHECK (departed >= 0),
    PRIMARY KEY (school_id, source_year),
    UNIQUE (school_id, revision)
);
