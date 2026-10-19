-- MP4 bytes live in <=512 KiB chunks (base64 <700 KiB per D1 row).
-- Existing image/audio rows and old recommendations are unchanged.
ALTER TABLE media ADD COLUMN duration_ms INTEGER;
CREATE TABLE media_chunks (
  hash TEXT NOT NULL REFERENCES media(hash) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL CHECK (chunk_index >= 0),
  size INTEGER NOT NULL CHECK (size > 0 AND size <= 524288),
  data TEXT NOT NULL,
  PRIMARY KEY (hash, chunk_index)
);
ALTER TABLE recommendations ADD COLUMN moment_json TEXT;
