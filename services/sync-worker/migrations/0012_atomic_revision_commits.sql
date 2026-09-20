-- Revision publication must be atomic with the rows carrying that revision.
-- claim_id lets the committing batch prove it won the compare-and-swap even
-- while requests from the previous Worker version are still draining.
ALTER TABLE sync_state ADD COLUMN claim_id TEXT;

CREATE TABLE sync_commits (
  rev INTEGER PRIMARY KEY,
  claim_id TEXT NOT NULL UNIQUE,
  committed_at INTEGER NOT NULL,
  owned INTEGER NOT NULL CHECK (owned = 1)
);
