import { describe, expect, it } from 'vitest';
import { feedEvents, feedFilters } from './friends.js';
import { actionPosition, itemReaders, messageReaders, timeline } from './majlis-chat.js';
import { shortAgo } from './social-kit.js';
import { toWaveform, formatDuration } from './voice.js';

/**
 * الأصدقاء والمجلس.
 *
 * السؤال: هل «آخر ما صار» يعرض قسمك وحده (والمحادثة للكل)؟ هل يختفي ما حُذف
 * للجميع وما أخفيته لديك دون أن يمسّ غيرك؟ وهل «نشاط القراءة ← إخفاء لدي»
 * مصفاتك أنت فقط؟ وهل المحادثة مرتّبة ومجمّعة كما يُقرأ الشات؟
 */
function fakeSync(tables) {
  return { user: { userId: 'me' }, rows: (t, p) => (tables[t] ?? []).filter(p ?? (() => true)) };
}
const base = () => ({
  majlis_messages: [
    { id: 'm1', sender_id: 'a', kind: 'text', body: 'هلا', created_at: 9 },
    { id: 'm2', sender_id: 'a', kind: 'text', body: 'انحذف', created_at: 10, deleted: 1 },
  ],
  frames: [{ id: 'f1', from_id: 'a', created_at: 5 }],
  recommendations: [
    { id: 'r1', from_id: 'a', series_ref: 'ext:lookism', created_at: 4 },
    { id: 'r2', from_id: 'b', series_ref: 'anime:21', created_at: 6 },
    { id: 'r3', from_id: 'me', series_ref: 'ext:x', created_at: 7, removed: 1 },
  ],
  activity: [
    { id: 'a1', actor_id: 'b', verb: 'CHAPTER_DONE', series_ref: 'ext:lookism', created_at: 3 },
    { id: 'a2', actor_id: 'me', verb: 'CHAPTER_DONE', series_ref: 'ext:lookism', created_at: 2 },
    { id: 'a3', actor_id: 'b', verb: 'EPISODE_DONE', series_ref: 'anime:21', created_at: 8 },
  ],
  majlis_hidden: [],
});
const ids = (list) => list.map((e) => `${e.kind}:${e.id}`);

describe('آخر ما صار', () => {
  it('manga: chat for all sections + manga recs/frames/reading; deleted gone', () => {
    const out = feedEvents(fakeSync(base()), { anime: false, filter: 'all', me: 'me' });
    expect(ids(out)).toEqual(['msg:m1', 'frame:f1', 'rec:r1', 'activity:a1', 'activity:a2']);
  });

  it('anime: its own recs and episodes, and the shared chat', () => {
    const out = feedEvents(fakeSync(base()), { anime: true, filter: 'all', me: 'me' });
    expect(ids(out)).toEqual(['msg:m1', 'activity:a3', 'rec:r2']);
  });

  it('cinema: its own recs and completions, the shared chat, and no manga frames', () => {
    const t = base();
    t.recommendations.push({ id: 'r9', from_id: 'a', series_ref: 'cinema:tt1375666', created_at: 11 });
    t.activity.push({ id: 'a9', actor_id: 'b', verb: 'EPISODE_DONE', series_ref: 'cinema:tt0944947', created_at: 12 });
    const out = feedEvents(fakeSync(t), { section: 'cinema', filter: 'all', me: 'me' });
    expect(ids(out)).toEqual(['activity:a9', 'rec:r9', 'msg:m1']);
    // ولا تتسرّب للمانجا ولا للأنمي
    expect(ids(feedEvents(fakeSync(t), { anime: false, filter: 'recs', me: 'me' }))).toEqual(['rec:r1']);
    expect(ids(feedEvents(fakeSync(t), { anime: true, filter: 'recs', me: 'me' }))).toEqual(['rec:r2']);
    expect(feedFilters('cinema', false).at(-1)).toEqual(['reading', 'المشاهدة']);
  });

  it('filters: chat, recs, reading', () => {
    const sync = fakeSync(base());
    expect(ids(feedEvents(sync, { anime: false, filter: 'chat', me: 'me' }))).toEqual(['msg:m1', 'frame:f1']);
    expect(ids(feedEvents(sync, { anime: false, filter: 'recs', me: 'me' }))).toEqual(['rec:r1']);
    expect(ids(feedEvents(sync, { anime: false, filter: 'reading', me: 'me' }))).toEqual(['activity:a1', 'activity:a2']);
  });

  it('hide for me comes from my own hidden rows only', () => {
    const t = base();
    t.majlis_hidden = [
      { user_id: 'me', target: 'rec:r1' },
      { user_id: 'b', target: 'msg:m1' },
    ];
    const out = feedEvents(fakeSync(t), { anime: false, filter: 'all', me: 'me' });
    expect(ids(out)).toEqual(['msg:m1', 'frame:f1', 'activity:a1', 'activity:a2']);
  });

  it('«نشاط القراءة ← إخفاء لدي» hides friends’ completions for me, keeps mine, and drops the tab', () => {
    const out = feedEvents(fakeSync(base()), { anime: false, filter: 'all', me: 'me', readingHidden: true });
    expect(ids(out)).toEqual(['msg:m1', 'frame:f1', 'rec:r1', 'activity:a2']);
    expect(feedFilters(false, true).map(([k]) => k)).toEqual(['all', 'chat', 'recs']);
    expect(feedFilters(true, false).at(-1)).toEqual(['reading', 'المشاهدة']);
  });
});

describe('المجلس', () => {
  it('shows viewers for voice, recommendation and frame with their actual audience', () => {
    const sync = fakeSync({
      majlis_receipts: [
        { target_kind: 'rec', target_id: 'r', user_id: 'a', seen_at: 4000 },
        { target_kind: 'frame', target_id: 'f', user_id: 'b', seen_at: 5000 },
      ],
      majlis_reads: [],
      majlis_message_receipts: [],
    });
    const members = ['me', 'a', 'b', 'c'];
    expect(itemReaders(sync, { type: 'msg', row: { id: 'v', sender_id: 'me', kind: 'voice', created_at: 3000 } }, members).map((r) => r.id))
      .toEqual(['a', 'b', 'c']);
    expect(itemReaders(sync, { type: 'rec', row: { id: 'r', from_id: 'me', hidden_json: '["c"]' } }, members))
      .toEqual([{ id: 'a', seen: true, seenAt: 4000 }, { id: 'b', seen: false, seenAt: null }]);
    expect(itemReaders(sync, { type: 'frame', row: { id: 'f', from_id: 'me', to_id: 'b', broadcast: 0 } }, members))
      .toEqual([{ id: 'b', seen: true, seenAt: 5000 }]);
  });
  it('keeps floating actions within both screen edges', () => {
    const viewport = { width: 360, height: 700 };
    const menu = { width: 290, height: 210 };
    expect(actionPosition({ left: 0, top: 30, width: 50, height: 40 }, viewport, menu)).toEqual({ left: 12, top: 80 });
    expect(actionPosition({ left: 325, top: 650, width: 35, height: 40 }, viewport, menu)).toEqual({ left: 58, top: 430 });
  });
  it('shows exact read times only for real receipts, with legacy watermarks marked without a time', () => {
    const sync = fakeSync({
      majlis_message_receipts: [{ message_id: 'm', user_id: 'a', seen_at: 4500 }],
      majlis_reads: [{ user_id: 'b', read_at: 3500 }],
    });
    expect(messageReaders(sync, { id: 'm', sender_id: 'me', created_at: 3000 }, ['me', 'a', 'b', 'c']))
      .toEqual([{ id: 'a', seen: true, seenAt: 4500 }, { id: 'b', seen: true, seenAt: null }, { id: 'c', seen: false, seenAt: null }]);
  });
  it('oldest first, messages + recs + frames, deleted messages stay as a placeholder', () => {
    const out = timeline(fakeSync(base()), 'me');
    expect(out.map((i) => i.key)).toEqual(['rec:r1', 'frame:f1', 'rec:r2', 'msg:m1', 'msg:m2']);
  });

  it('groups the same sender within five minutes', () => {
    const t = { majlis_messages: [
      { id: '1', sender_id: 'a', kind: 'text', created_at: 1_000 },
      { id: '2', sender_id: 'a', kind: 'text', created_at: 61_000 },
      { id: '3', sender_id: 'b', kind: 'text', created_at: 62_000 },
      { id: '4', sender_id: 'b', kind: 'text', created_at: 62_000 + 6 * 60_000 },
    ] };
    const out = timeline(fakeSync(t), 'me').map((i) => [i.key, i.first, i.last]);
    expect(out).toEqual([
      ['msg:1', true, false],
      ['msg:2', false, true],
      ['msg:3', true, true],
      ['msg:4', true, true],
    ]);
  });
});

describe('الصوت والوقت', () => {
  it('waveform is fixed-length and normalised', () => {
    const w = toWaveform([0, 0.5, 1, 0.25], 4);
    expect(w).toEqual([0.06, 0.5, 1, 0.25]);
    expect(toWaveform([], 8)).toHaveLength(8);
    expect(formatDuration(65_000)).toBe('1:05');
  });
  it('short relative time', () => {
    const now = 10 * 86_400_000;
    expect(shortAgo(now - 20_000, now)).toBe('الآن');
    expect(shortAgo(now - 12 * 60_000, now)).toBe('12 د');
    expect(shortAgo(now - 30 * 3_600_000, now)).toBe('أمس');
  });
});
