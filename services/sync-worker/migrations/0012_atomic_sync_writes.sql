-- B12 adversarial follow-up: revision visibility + concurrent op idempotency.
--
-- writer_token lets a D1 batch prove that its compare-and-swap of sync_state.rev
-- actually won before any state effect runs. The CHECK guard deliberately aborts
-- the entire batch when it did not.
ALTER TABLE sync_state ADD COLUMN writer_token TEXT;

CREATE TABLE sync_tx_guard (
  token TEXT PRIMARY KEY,
  ok INTEGER NOT NULL,
  CONSTRAINT sync_tx_guard_ok CHECK (ok = 1)
);

-- Permanent claim ledger for post-0012 writes. applied_ops remains the public
-- audit/ack ledger; this table exists only to make concurrent duplicate op_id
-- delivery fail atomically before any effect is committed.
CREATE TABLE op_claims (
  op_id TEXT PRIMARY KEY,
  claimed_at INTEGER NOT NULL
);

CREATE INDEX idx_op_claims_claimed_at ON op_claims(claimed_at);
