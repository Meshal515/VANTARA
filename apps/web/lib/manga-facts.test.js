import { expect, it } from 'vitest';
import { voteStatus } from './manga-facts.js';

it('الحالة: «مكتمل» إن قاله أي مصدر (AniList القديم «مستمر» لا يغلب)، وإلا الأغلب', () => {
  expect(voteStatus(['RELEASING', null, 'FINISHED'])).toBe('FINISHED'); // Jujutsu Kaisen: AniList قديم، MangaDex مكتمل
  expect(voteStatus(['RELEASING', 'HIATUS', 'HIATUS'])).toBe('HIATUS');
  expect(voteStatus(['RELEASING', null, null])).toBe('RELEASING');
  expect(voteStatus([null, null, null])).toBeNull();
});
