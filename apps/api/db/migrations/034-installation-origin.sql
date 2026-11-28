ALTER TABLE schools ADD COLUMN connection_origin text CHECK (char_length(connection_origin) <= 512);
