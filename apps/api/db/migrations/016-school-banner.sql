CREATE TABLE school_banners (
    school_id uuid PRIMARY KEY REFERENCES schools(id) ON DELETE CASCADE,
    title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 64),
    text_color text NOT NULL CHECK (char_length(text_color) = 7 AND text_color ~ '^#[0-9a-f]{6}$'),
    background_color text NOT NULL CHECK (char_length(background_color) = 7 AND background_color ~ '^#[0-9a-f]{6}$'),
    revision uuid NOT NULL
);
