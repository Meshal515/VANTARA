-- Scheduled collectors run without a phone session. A lease prevents overlap;
-- successful scan times and failures remain observable independently of the UI.
CREATE TABLE collector_state (
  source TEXT PRIMARY KEY,
  lease_until INTEGER NOT NULL DEFAULT 0,
  last_attempt_at INTEGER NOT NULL DEFAULT 0,
  last_success_at INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  cursor INTEGER NOT NULL DEFAULT 0
);
