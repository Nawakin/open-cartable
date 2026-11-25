ALTER TABLE schools ADD COLUMN name text
    CHECK (name IS NULL OR char_length(name) BETWEEN 1 AND 100);

CREATE TABLE installation_completed (
    singleton boolean PRIMARY KEY CHECK (singleton)
);

INSERT INTO installation_completed (singleton)
    SELECT true WHERE EXISTS (SELECT 1 FROM schools);
