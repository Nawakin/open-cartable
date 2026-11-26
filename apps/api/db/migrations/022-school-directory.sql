ALTER TABLE guardians ADD COLUMN display_name text NOT NULL DEFAULT '' CHECK (char_length(display_name) <= 100);
ALTER TABLE students ADD COLUMN birth_date date;
