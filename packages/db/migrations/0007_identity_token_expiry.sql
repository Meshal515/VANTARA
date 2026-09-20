-- Track the Uchiyomi API credential independently from the VANTARA
-- trusted-device/session lifetime. Existing rows are learned lazily from
-- GET /api/tokens on first use instead of guessing their historic TTL.
ALTER TABLE vantara_identity_links
  ADD COLUMN token_expires_at timestamptz;

CREATE INDEX vantara_identity_links_expiry
  ON vantara_identity_links (token_expires_at)
  WHERE revoked_at IS NULL;
