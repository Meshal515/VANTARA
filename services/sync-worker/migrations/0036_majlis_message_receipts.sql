-- A server-timed read receipt for each member/message. Existing read
-- watermarks remain for unread counts; historical timestamps are not guessed.
CREATE TABLE majlis_message_receipts (
  message_id TEXT NOT NULL REFERENCES majlis_messages (id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES accounts (user_id) ON DELETE CASCADE,
  seen_at INTEGER NOT NULL,
  rev INTEGER NOT NULL,
  PRIMARY KEY (message_id, user_id)
);
CREATE INDEX majlis_message_receipts_rev ON majlis_message_receipts (rev);
