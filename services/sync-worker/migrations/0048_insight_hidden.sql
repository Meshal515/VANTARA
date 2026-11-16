-- أعمال أخفاها صاحبها من إحصائياته نهائيًا: تختفي من القائمة عن الجميع (وعنه)، ووقتها يبقى في المجموع.
CREATE TABLE IF NOT EXISTS insight_hidden (
  user_id TEXT NOT NULL,
  series_ref TEXT NOT NULL,
  hidden_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, series_ref)
);
