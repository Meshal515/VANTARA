import { expect, it } from 'vitest';
import { momentSendPayload } from './player.js';
it('emits the source-backed selection with the originating account and canonical work reference', () => {
  const selection = { startMs: 85000, endMs: 155000, episode: 3, work: { ref: 'cinema:tt1:2', title: 'عمل', cover: 'https://image.example/cover.jpg' }, toIds: ['a'], broadcast: false, message: 'لقطة', moment: { version: 1, startMs: 85000, endMs: 155000, episode: 3, sources: [] } };
  expect(momentSendPayload({ usageUserId: 'me', animeId: 'tt1:2', section: 'cinema' }, selection)).toEqual({ userId: 'me', seriesRef: 'cinema:tt1:2', seriesTitle: 'عمل', coverUrl: 'https://image.example/cover.jpg', chapterLabel: 'الحلقة 3 · 1:25–2:35', chapterNumber: 3, moment: selection.moment, toIds: ['a'], broadcast: false, message: 'لقطة' });
  expect(momentSendPayload({ presenceUserId: 'fallback' }, selection).userId).toBe('fallback');
  expect(momentSendPayload({}, { ...selection, episode: null, moment: { ...selection.moment, episode: null } })).toMatchObject({ chapterNumber: null, chapterLabel: 'الفيلم · 1:25–2:35', moment: { episode: null } });
});
