-- Track the lifetime of the Uchiyomi credential behind a VANTARA identity.
-- Existing rows stay NULL deliberately: the first successful identity request
-- will rotate them while the old credential can still authenticate, instead of
-- guessing what SESSION_TTL_DAYS was when an older row was created.
ALTER TABLE vantara_identity_links
  ADD COLUMN IF NOT EXISTS token_expires_at timestamptz;
