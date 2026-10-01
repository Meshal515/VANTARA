import { describe, expect, it } from 'vitest';
import { eventId, handleUpdatesList, handleUpdatesObserve, type UpdatesEnv } from './updates.ts';
import { sqliteEnv } from './test-d1.ts';

/**
 * السؤال: هل VANTARA هي المصدر الأب؟ نفس الفصل من مصدرين = حدث واحد؛ الوقت
 * يثبت عند أول اكتشاف ولا يتبدّل بإعادة المسح؛ الخط الزمني الجديد فوق
 * والقديم تحته بترتيب لا يتغيّر.
 */
const NOW = Date.UTC(2026, 9, 1, 12);
const env = () => sqliteEnv({ VANTARA_SESSION_SECRET: 'x'.repeat(40), VANTARA_IDENTITY_SECRET: 'y'.repeat(40), VANTARA_DEVICE_PEPPER: 'z'.repeat(40) } as never).env as unknown as UpdatesEnv;
const observe = (e: UpdatesEnv, events: unknown[], now: number) =>
  handleUpdatesObserve(new Request('https://x/v1/updates/observe', { method: 'POST', body: JSON.stringify({ events }) }), e, now).then((r) => r.json() as Promise<{ accepted: number; created: number }>);
const list = (e: UpdatesEnv, q: string) =>
  handleUpdatesList(new URL(`https://x/v1/updates?${q}`), e).then((r) => r.json() as Promise<{ events: Array<Record<string, unknown>>; next: string | null }>);
const ch = (work: string, number: number, s: string, extra: Record<string, unknown> = {}) => ({ work, section: 'manga', kind: 'chapter', number, title: work.slice(4), source: { s, u: `/m/${work}` }, ...extra });

describe('Update Engine', () => {
  it('one event per work+chapter; a second source merges under it without moving it', async () => {
    const e = env();
    expect(await observe(e, [ch('ext:solo', 201, 'mangalek')], NOW)).toEqual({ accepted: 1, created: 1 });
    expect(await observe(e, [ch('ext:solo', 201, 'teamx'), ch('ext:solo', 201.0, 'mangalek')], NOW + 3_600_000)).toEqual({ accepted: 1, created: 0 });
    const { events } = await list(e, 'section=manga');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ id: 'ext:solo|c:201', at: NOW, firstSeenAt: NOW, sources: [{ s: 'mangalek', u: '/m/ext:solo' }, { s: 'teamx', u: '/m/ext:solo' }] });
  });

  it('time: reliable publish date when given, else first seen; never reset by a later scan', async () => {
    const e = env();
    await observe(e, [ch('ext:a', 10, 'x', { publishedAt: NOW - 7_200_000 }), ch('ext:b', 5, 'x'), ch('ext:c', 1, 'x', { publishedAt: NOW + 86_400_000 })], NOW);
    await observe(e, [ch('ext:b', 5, 'y', { publishedAt: NOW - 50_000_000 })], NOW + 600_000);
    const { events } = await list(e, 'section=manga');
    const at = Object.fromEntries(events.map((x) => [x.id, x.at]));
    expect(at).toEqual({ 'ext:a|c:10': NOW - 7_200_000, 'ext:b|c:5': NOW, 'ext:c|c:1': NOW });
  });

  it('timeline: newest first, stable cursor, sections and works kept apart', async () => {
    const e = env();
    for (let i = 0; i < 5; i++) await observe(e, [ch(`ext:w${i}`, 1, 's')], NOW + i * 1000);
    await observe(e, [{ work: 'anime:21', section: 'anime', kind: 'episode', number: 1150, title: 'ONE PIECE', publishedAt: NOW - 1000 }], NOW);
    await observe(e, [{ work: 'cinema:tt0944947', section: 'cinema', kind: 'episode', season: 2, number: 3, title: 'GoT' }, { work: 'cinema:tt1375666', section: 'cinema', kind: 'movie', title: 'Inception' }], NOW);
    const first = await list(e, 'section=manga&limit=2');
    expect(first.events.map((x) => x.id)).toEqual(['ext:w4|c:1', 'ext:w3|c:1']);
    await observe(e, [ch('ext:new', 1, 's')], NOW + 99_000);
    const second = await list(e, `section=manga&limit=2&before=${encodeURIComponent(first.next!)}`);
    expect(second.events.map((x) => x.id)).toEqual(['ext:w2|c:1', 'ext:w1|c:1']);
    expect((await list(e, 'section=anime')).events.map((x) => x.id)).toEqual(['anime:21|e:1150']);
    expect((await list(e, 'section=cinema')).events.map((x) => x.id).sort()).toEqual(['cinema:tt0944947|s2e:3', 'cinema:tt1375666|movie']);
  });

  it('rejects malformed events and section/kind mismatches', async () => {
    const e = env();
    const out = await observe(e, [
      { work: 'anime:21', section: 'manga', kind: 'chapter', number: 1, title: 'x' },
      { work: 'ext:a', section: 'anime', kind: 'episode', number: 1, title: 'x' },
      { work: 'cinema:tt1', section: 'cinema', kind: 'episode', number: 1, title: 'no season' },
      { work: 'ext:a', section: 'manga', kind: 'chapter', number: -1, title: 'x' },
      { work: 'ext:a', section: 'manga', kind: 'chapter', number: 3, title: '' },
    ], NOW);
    expect(out).toEqual({ accepted: 0, created: 0 });
    expect(eventId('ext:a', 'chapter', null, 12.5)).toBe(eventId('ext:a', 'chapter', null, 12.50));
  });
});
