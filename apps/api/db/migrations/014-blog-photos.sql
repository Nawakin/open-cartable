ALTER TABLE class_blog_articles DROP CONSTRAINT class_blog_articles_body_check;
ALTER TABLE class_blog_articles ADD CONSTRAINT class_blog_articles_body_check CHECK (char_length(body) <= 8000);

CREATE TABLE class_blog_photos (
    school_id uuid NOT NULL,
    article_id uuid NOT NULL,
    id uuid NOT NULL,
    position integer NOT NULL,
    description text NOT NULL DEFAULT '' CHECK (char_length(description) <= 180),
    reviewed boolean NOT NULL DEFAULT false,
    thumbnail_data bytea NOT NULL,
    full_data bytea NOT NULL,
    expires_at timestamptz NOT NULL DEFAULT (statement_timestamp() + interval '1 year'),
    first_published_at timestamptz,
    PRIMARY KEY (school_id, article_id, id),
    FOREIGN KEY (school_id, article_id) REFERENCES class_blog_articles(school_id, id) ON DELETE CASCADE
);

CREATE INDEX class_blog_photos_by_position ON class_blog_photos (school_id, article_id, position, id);
CREATE INDEX class_blog_photos_by_expiry ON class_blog_photos (expires_at);
