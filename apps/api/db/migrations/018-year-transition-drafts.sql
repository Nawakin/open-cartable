CREATE TABLE year_transition_drafts (
    school_id uuid PRIMARY KEY REFERENCES schools(id) ON DELETE CASCADE,
    start_year smallint NOT NULL CHECK (start_year BETWEEN 1900 AND 9998),
    revision uuid NOT NULL,
    configuration jsonb NOT NULL CHECK (jsonb_typeof(configuration) = 'object')
);
