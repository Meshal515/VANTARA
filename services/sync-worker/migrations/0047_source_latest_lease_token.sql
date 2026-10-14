-- A lease timestamp is guessable and cannot identify its holder.
ALTER TABLE source_latest ADD COLUMN lease_token TEXT;
