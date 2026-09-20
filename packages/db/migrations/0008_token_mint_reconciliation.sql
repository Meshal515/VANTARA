-- Final adversarial closure for #22/#23.
--
-- Token creation is a non-idempotent upstream operation. Persist the unique
-- attempt name before POST so a lost response can never create an untracked
-- credential: the exact name can be reconciled on a later authenticated call.
CREATE TABLE vantara_token_mint_attempts (
  name               text PRIMARY KEY,
  uchiyomi_user_id   uuid NOT NULL,
  token_id           text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  resolved_at        timestamptz
);

CREATE INDEX vantara_token_mint_attempts_unresolved
  ON vantara_token_mint_attempts (uchiyomi_user_id, created_at)
  WHERE resolved_at IS NULL;

-- Migration 0007 backfilled linked_at + the historical 60-day TTL. That was a
-- safe estimate, not upstream truth. Existing rows reconcile once against
-- Uchiyomi metadata; newly minted/rotated rows store the exact expiry and true.
ALTER TABLE vantara_identity_links
  ADD COLUMN token_expiry_authoritative boolean NOT NULL DEFAULT false;
