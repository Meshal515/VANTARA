-- VANTARA Together: بطاقة الدعوة في المجلس. الغرفة نفسها في Durable Object
-- (حالتها لحظية)، وهنا فقط ما يجب أن يبقى ويصل كل جهاز: من دعا من، إلى ماذا،
-- وبأي نوع (متزامن/منفصل). invitees_json: مصفوفة معرّفات، أو ["*"] للكل.
-- لا يراها إلا المضيف ومن دُعي.
CREATE TABLE IF NOT EXISTS together_invites (
  code          TEXT PRIMARY KEY,
  host_id       TEXT NOT NULL REFERENCES accounts (user_id) ON DELETE CASCADE,
  invitees_json TEXT NOT NULL,
  mode          TEXT NOT NULL CHECK (mode IN ('sync', 'free')),
  kind          TEXT NOT NULL CHECK (kind IN ('anime', 'cinema', 'manga')),
  media_json    TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  rev           INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS together_invites_rev ON together_invites (rev);
