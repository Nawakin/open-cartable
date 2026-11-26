CREATE TABLE class_media (
    school_id uuid NOT NULL,
    class_id uuid NOT NULL,
    id uuid NOT NULL,
    article_id uuid,
    title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
    folder text NOT NULL DEFAULT '' CHECK (char_length(folder) <= 80),
    kind text NOT NULL CHECK (kind IN ('image', 'pdf', 'video', 'audio')),
    content bytea NOT NULL,
    created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
    first_published_at timestamptz,
    expires_at timestamptz,
    PRIMARY KEY (school_id, id),
    FOREIGN KEY (school_id,class_id) REFERENCES classes(school_id,id) ON DELETE CASCADE,
    FOREIGN KEY (school_id,article_id) REFERENCES class_blog_articles(school_id,id) ON DELETE CASCADE,
    CHECK (article_id IS NULL OR (kind = 'video' AND expires_at IS NOT NULL))
);
CREATE INDEX class_media_library ON class_media (school_id,class_id,created_at DESC);
CREATE INDEX class_media_article ON class_media (school_id,article_id) WHERE article_id IS NOT NULL;
