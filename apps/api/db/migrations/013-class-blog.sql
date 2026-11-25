CREATE TABLE class_blog_articles (
    school_id uuid NOT NULL,
    id uuid NOT NULL,
    class_id uuid NOT NULL,
    title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
    body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 8000),
    version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
    updated_at timestamptz NOT NULL,
    published_at timestamptz,
    PRIMARY KEY (school_id, id),
    FOREIGN KEY (school_id, class_id) REFERENCES classes(school_id, id) ON DELETE CASCADE
);

CREATE INDEX class_blog_articles_by_activity
    ON class_blog_articles (school_id, class_id, updated_at DESC, id DESC);
CREATE INDEX class_blog_articles_by_publication
    ON class_blog_articles (school_id, class_id, published_at DESC, id DESC)
    WHERE published_at IS NOT NULL;
