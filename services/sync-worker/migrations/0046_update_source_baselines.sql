-- Listing movement cannot prove publication; remember each reporting source.
CREATE TABLE IF NOT EXISTS update_source_watermarks (
  work TEXT NOT NULL,
  source_id TEXT NOT NULL,
  max_season INTEGER,
  max_number REAL NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (work, source_id)
);
-- Preserve new verified advances larger than the legacy catch-up heuristic.
ALTER TABLE update_events ADD COLUMN observed_advance INTEGER NOT NULL DEFAULT 0;
