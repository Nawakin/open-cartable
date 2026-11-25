CREATE TABLE student_photo_authorizations (
    school_id uuid NOT NULL,
    student_id uuid NOT NULL,
    status text NOT NULL CHECK (status IN ('unrecorded', 'allowed', 'refused')),
    revision uuid NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
    PRIMARY KEY (school_id, student_id),
    FOREIGN KEY (school_id, student_id) REFERENCES students(school_id, id) ON DELETE CASCADE
);

ALTER TABLE class_blog_photos ADD COLUMN review_basis text;
UPDATE class_blog_photos SET review_basis = 'legacy' WHERE reviewed;
ALTER TABLE class_blog_photos ADD CONSTRAINT class_blog_photos_review_basis CHECK (
    (NOT reviewed AND review_basis IS NULL)
    OR (reviewed AND review_basis IS NOT NULL AND review_basis IN ('legacy', 'none', 'students'))
);

CREATE TABLE class_blog_photo_subjects (
    school_id uuid NOT NULL,
    article_id uuid NOT NULL,
    photo_id uuid NOT NULL,
    student_id uuid,
    authorization_revision uuid NOT NULL,
    PRIMARY KEY (school_id, article_id, photo_id, authorization_revision),
    FOREIGN KEY (school_id, article_id, photo_id)
        REFERENCES class_blog_photos(school_id, article_id, id) ON DELETE CASCADE,
    FOREIGN KEY (school_id, student_id) REFERENCES students(school_id, id) ON DELETE SET NULL (student_id)
);

CREATE INDEX class_blog_photo_subjects_by_student ON class_blog_photo_subjects (school_id, student_id);
