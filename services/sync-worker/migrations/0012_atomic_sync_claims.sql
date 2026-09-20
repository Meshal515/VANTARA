-- Atomic sync revision and operation claims.
--
-- A revision claim is created in the SAME D1 batch as the rows carrying that
-- revision. Concurrent writers that computed the same next revision collide on
-- the PK, roll back, then retry from the new committed cursor.
--
-- Operation claims close the concurrent op_id race. They are permanent just
-- like applied_ops: a replay must never regain the right to mutate state.
CREATE TABLE IF NOT EXISTS sync_revision_claims (
  rev INTEGER PRIMARY KEY,
  committed_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_op_claims (
  op_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  claimed_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sync_op_claims_claimed_at
  ON sync_op_claims(claimed_at);
