-- Source-backed moments; no uploaded video storage. Existing clients omit this.
ALTER TABLE recommendations ADD COLUMN moment_json TEXT;
