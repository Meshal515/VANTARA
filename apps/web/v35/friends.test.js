import { describe, expect, it } from 'vitest';
import { feedEvents, shortAgo } from './friends.js';

/**
 * «آخر ما صار» في صفحة الأصدقاء.
 *
 * السؤال: هل يرى كل قسم ما يخصه وحده؟ وهل يختفي ما حُذف للجميع وما أخفيته
 * لديك، دون أن يمسّ ما يراه غيرك؟
 */
function fakeSync(tables) {
  return { user: { userId: 'me' }, rows: (t, p) => (tables[t] ?? []).filter(p ?? (() => true)) };
}
const tables = {
  frames: [{ id: 'f1', from_id: 'a', created_at: 5 }],
  recommendations: [
    { id: 'r1', from_id: 'a', series_ref: 'ext:lookism', created_at: 4 },
    { id: 'r2', from_id: 'b', series_ref: 'anime:21', created_at: 6 },
    { id: 'r3', from_id: 'me', series_ref: 'ext:x', created_at: 7, removed: 1 },
  ],
  activity: [
    { id: 'a1', actor_id: 'b', verb: 'CHAPTER_DONE', series_ref: 'ext:lookism', created_at: 3 },
    { id: 'a2', actor_id: 'b', verb: 'UNKNOWN', series_ref: 'ext:lookism', created_at: 8 },
  ],
};

describe('friends feed', () => {
  it('manga sees manga (frames, recs, reading) newest first; removed and unknown verbs are gone', () => {
    const out = feedEvents(fakeSync(tables), { anime: false, filter: 'all' });
    expect(out.map((e) => `${e.kind}:${e.id}`)).toEqual(['frame:f1', 'rec:r1', 'activity:a1']);
  });

  it('anime sees anime only, and no frames', () => {
    const out = feedEvents(fakeSync(tables), { anime: true, filter: 'all' });
    expect(out.map((e) => e.id)).toEqual(['r2']);
  });

  it('filters and hide-for-me', () => {
    const sync = fakeSync(tables);
    expect(feedEvents(sync, { anime: false, filter: 'reading' }).map((e) => e.id)).toEqual(['a1']);
    expect(feedEvents(sync, { anime: false, filter: 'recs' }).map((e) => e.id)).toEqual(['r1']);
    expect(feedEvents(sync, { anime: false, filter: 'all', hidden: new Set(['frame:f1']) }).map((e) => e.id)).toEqual(['r1', 'a1']);
  });

  it('short relative time', () => {
    const now = 10 * 86_400_000;
    expect(shortAgo(now - 20_000, now)).toBe('الآن');
    expect(shortAgo(now - 12 * 60_000, now)).toBe('12 د');
    expect(shortAgo(now - 5 * 3_600_000, now)).toBe('5 س');
    expect(shortAgo(now - 30 * 3_600_000, now)).toBe('أمس');
    expect(shortAgo(now - 3 * 86_400_000, now)).toBe('3 ي');
  });
});
