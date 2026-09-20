-- Adversarial audit #23: a trusted VANTARA device can outlive the
-- Uchiyomi API credential that backs content access. Persist the upstream
-- expiry so SessionStore can renew before it expires instead of failing after
-- ~60 days with a still-valid VANTARA identity.
ALTER TABLE vantara_identity_links
  ADD COLUMN token_expires_at timestamptz;

-- Existing links were minted with SESSION_TTL_DAYS=60 but their exact mint
-- instant is linked_at. Backfill the known historical contract.
UPDATE vantara_identity_links
   SET token_expires_at = linked_at + interval '60 days'
 WHERE token_expires_at IS NULL;

ALTER TABLE vantara_identity_links
  ALTER COLUMN token_expires_at SET NOT NULL;
