-- One-time repair for the unowned device anime migration attributed to dahmi.
-- Preserve every other row: the five views, two library entries and four episode
-- marks below all came from the same migration at rev 5407. The private owner
-- already had the matching work and earlier library rows. Tombstones advance the
-- shared cursor so every device withdraws these rows on its next sync.
--
-- Run only after the Worker is deployed and verified. The guard deliberately
-- aborts the entire D1 batch if any audited fact changed before execution.
-- A fresh database (or a previously cleaned one)
-- has no matching batch and performs no writes.
INSERT INTO sync_tx_guard (token, ok)
SELECT 'repair-dahmi-anime-202609',
       CASE WHEN
         (SELECT COUNT(*) FROM work_views v JOIN accounts a ON a.user_id = v.user_id
          WHERE lower(a.username) = 'dahmi' AND v.rev = 5407 AND v.removed = 0
            AND v.series_ref LIKE 'anime:%') = 5
         AND (SELECT COUNT(*) FROM work_views v JOIN accounts a ON a.user_id = v.user_id
              JOIN accounts o ON lower(o.username) = 'ngm'
              JOIN work_views owner ON owner.user_id = o.user_id AND owner.series_ref = v.series_ref
              WHERE lower(a.username) = 'dahmi' AND v.rev = 5407
                AND owner.viewed_at >= v.viewed_at) = 5
         AND (SELECT COUNT(*) FROM public_work_views v JOIN accounts a ON a.user_id = v.user_id
              JOIN work_views private ON private.user_id = v.user_id AND private.series_ref = v.series_ref
              WHERE lower(a.username) = 'dahmi' AND v.removed = 0
                AND v.viewed_at = private.viewed_at AND v.chapter_number = private.chapter_number
                AND private.rev = 5407 AND private.series_ref LIKE 'anime:%') = 5
         AND (SELECT COUNT(*) FROM library l JOIN accounts a ON a.user_id = l.user_id
              JOIN accounts o ON lower(o.username) = 'ngm'
              JOIN library owner ON owner.user_id = o.user_id AND owner.series_ref = l.series_ref
              WHERE lower(a.username) = 'dahmi' AND l.rev = 5407 AND l.removed = 0
                AND l.series_ref LIKE 'anime:%' AND owner.added_at < l.added_at) = 2
         AND (SELECT MIN(l.added_at) = MAX(l.added_at) FROM library l JOIN accounts a ON a.user_id = l.user_id
              WHERE lower(a.username) = 'dahmi' AND l.rev = 5407 AND l.removed = 0) = 1
         AND (SELECT COUNT(*) FROM chapter_marks m JOIN accounts a ON a.user_id = m.user_id
              JOIN accounts o ON lower(o.username) = 'ngm'
              JOIN chapter_marks owner ON owner.user_id = o.user_id AND owner.chapter_key = m.chapter_key
              WHERE lower(a.username) = 'dahmi' AND m.rev = 5407 AND m.read = 1
                AND m.series_ref LIKE 'anime:%' AND owner.updated_at < m.updated_at) = 4
         AND (SELECT MIN(m.updated_at) = MAX(m.updated_at) FROM chapter_marks m JOIN accounts a ON a.user_id = m.user_id
              WHERE lower(a.username) = 'dahmi' AND m.rev = 5407 AND m.read = 1) = 1
       THEN 1 ELSE 0 END
WHERE EXISTS (
  SELECT 1 FROM work_views v JOIN accounts a ON a.user_id = v.user_id
  WHERE lower(a.username) = 'dahmi' AND v.rev = 5407 AND v.series_ref LIKE 'anime:%'
);

UPDATE sync_state SET rev = rev + 1
WHERE id = 1 AND EXISTS (SELECT 1 FROM sync_tx_guard WHERE token = 'repair-dahmi-anime-202609');

UPDATE work_views
SET removed = 1, rev = (SELECT rev FROM sync_state WHERE id = 1),
    social_at = NULL, published = 1, chapter_label = NULL, chapter_number = NULL
WHERE user_id = (SELECT user_id FROM accounts WHERE lower(username) = 'dahmi')
  AND rev = 5407 AND removed = 0
  AND series_ref LIKE 'anime:%'
  AND EXISTS (SELECT 1 FROM sync_tx_guard WHERE token = 'repair-dahmi-anime-202609');

UPDATE public_work_views
SET removed = 1, rev = (SELECT rev FROM sync_state WHERE id = 1),
    social_at = NULL, published = 1, chapter_label = NULL, chapter_number = NULL
WHERE user_id = (SELECT user_id FROM accounts WHERE lower(username) = 'dahmi')
  AND removed = 0
  AND series_ref IN (
    SELECT series_ref FROM work_views
    WHERE user_id = (SELECT user_id FROM accounts WHERE lower(username) = 'dahmi')
      AND rev = (SELECT rev FROM sync_state WHERE id = 1) AND removed = 1
  )
  AND EXISTS (SELECT 1 FROM sync_tx_guard WHERE token = 'repair-dahmi-anime-202609');

UPDATE library
SET removed = 1, rev = (SELECT rev FROM sync_state WHERE id = 1)
WHERE user_id = (SELECT user_id FROM accounts WHERE lower(username) = 'dahmi')
  AND rev = 5407 AND removed = 0
  AND series_ref LIKE 'anime:%'
  AND EXISTS (SELECT 1 FROM sync_tx_guard WHERE token = 'repair-dahmi-anime-202609');

UPDATE chapter_marks
SET read = 0, rev = (SELECT rev FROM sync_state WHERE id = 1)
WHERE user_id = (SELECT user_id FROM accounts WHERE lower(username) = 'dahmi')
  AND rev = 5407 AND read = 1
  AND series_ref LIKE 'anime:%'
  AND EXISTS (SELECT 1 FROM sync_tx_guard WHERE token = 'repair-dahmi-anime-202609');

DELETE FROM sync_tx_guard WHERE token = 'repair-dahmi-anime-202609';
