-- Shared collector policy, independent of account sync and latest threads.
CREATE TABLE IF NOT EXISTS collector_policy (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  mode TEXT NOT NULL CHECK(mode IN ('hybrid','manga-local','exclusive')),
  updated_at INTEGER NOT NULL
);
INSERT OR IGNORE INTO collector_policy (id,mode,updated_at) VALUES (1,'hybrid',0);
