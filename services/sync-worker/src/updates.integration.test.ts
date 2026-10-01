import { describe, expect, it } from 'vitest';
import { eventId, handleUpdatesList, handleUpdatesObserve, type UpdatesEnv } from './updates.ts';
import { sqliteEnv } from './test-d1.ts';

/**
 * السؤال: هل المصادر تكتشف وVANTARA يقرّر؟
 * - أول مرة يُرى عمل بـ400 فصل: خط أساس بلا 400 حدث قديم.
 * - بعدها الفصل 401 من أي مسار: حدث واحد، والمصدر الثاني يُدمج تحته.
 * - publishedAt وfirstSeenAt منفصلان، والوقت لا يتبدّل بإعادة المسح.
 */
const NOW = Date.UTC(2026, 9, 1, 12);
const H = 3_600_000;
const env = () => sqliteEnv({ VANTARA_SESSION_SECRET: 'x'.repeat(40), VANTARA_IDENTITY_SECRET: 'y'.repeat(40), VANTARA_DEVICE_PEPPER: 'z'.repeat(40) } as never).env as unknown as UpdatesEnv;
type Out = { accepted: number; created: number; baselined: number };
const observe = (e: UpdatesEnv, works: unknown[], now: number) =>
  handleUpdatesObserve(new Request('https://x/v1/updates/observe', { method: 'POST', body: JSON.stringify({ works }) }), e, now).then((r) => r.json() as Promise<Out>);
const list = (e: UpdatesEnv, q: string) =>
  handleUpdatesList(new URL(`https://x/v1/updates?${q}`), e).then((r) => r.json() as Promise<{ events: Array<Record<string, unknown>>; next: string | null }>);
const manga = (work: string, numbers: number[], s: string, dates: Record<number, number> = {}) => ({
  work, section: 'manga', kind: 'chapter', title: work.slice(4), source: { s, u: `/m/${work}` },
  units: numbers.map((number) => ({ number, ...(dates[number] ? { publishedAt: dates[number] } : {}) })),
});
const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

describe('Update Engine: خط الأساس', () => {
  it('first sight of a 400-chapter work is a baseline, not 400 updates; 401 from any path is one event', async () => {
    const e = env();
    expect(await observe(e, [manga('ext:solo', range(343, 400), 'mangalek', { 400: NOW - 30 * 86_400_000 })], NOW)).toMatchObject({ created: 0, baselined: 1 });
    expect((await list(e, 'section=manga')).events).toEqual([]);
    // صفحة العمل في مصدر آخر تكشف 401 (لم يظهر في Latest)
    expect(await observe(e, [manga('ext:solo', range(380, 401), 'teamx')], NOW + H)).toMatchObject({ created: 1, baselined: 0 });
    // Latest المصدر الأول يلحق بعد ساعتين: يُدمج تحت نفس الحدث بلا تغيير وقته
    expect(await observe(e, [manga('ext:solo', [401], 'mangalek')], NOW + 3 * H)).toMatchObject({ created: 0 });
    const { events } = await list(e, 'section=manga');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ id: 'ext:solo|c:401', at: NOW + H, firstSeenAt: NOW + H, publishedAt: null, sources: [{ s: 'teamx' }, { s: 'mangalek' }] });
  });

  it('a genuinely recent dated chapter on first sight is an event; old dates are not', async () => {
    const e = env();
    await observe(e, [manga('ext:a', [9, 10], 'x', { 10: NOW - 5 * H, 9: NOW - 8 * 86_400_000 }), manga('ext:b', [70], 'x', { 70: NOW - 20 * 86_400_000 })], NOW);
    const { events } = await list(e, 'section=manga');
    expect(events.map((x) => [x.id, x.at, x.publishedAt, x.firstSeenAt])).toEqual([['ext:a|c:10', NOW - 5 * H, NOW - 5 * H, NOW]]);
  });

  it('never moves time on refresh; a reliable publish date is kept apart from firstSeenAt', async () => {
    const e = env();
    await observe(e, [manga('ext:c', [1], 'x')], NOW);
    await observe(e, [manga('ext:c', [2], 'x', { 2: NOW + 2 * H - 600_000 })], NOW + 2 * H);
    await observe(e, [manga('ext:c', [1, 2], 'y', { 2: NOW - 99 * H })], NOW + 5 * H);
    const ev = (await list(e, 'section=manga')).events[0]!;
    expect(ev).toMatchObject({ id: 'ext:c|c:2', at: NOW + 2 * H - 600_000, publishedAt: NOW + 2 * H - 600_000, firstSeenAt: NOW + 2 * H });
  });

  it('ignores absurd jumps (bad numbering) and older backfill under the watermark', async () => {
    const e = env();
    await observe(e, [manga('ext:d', [50], 'x')], NOW);
    expect(await observe(e, [manga('ext:d', [9999, 12], 'x')], NOW + H)).toMatchObject({ created: 0 });
    expect(await observe(e, [manga('ext:d', [51, 52], 'x')], NOW + 2 * H)).toMatchObject({ created: 2 });
  });
});

describe('Update Engine: الأقسام والخط الزمني', () => {
  it('series seasons, anime episodes, movie availability; newest first with a stable cursor', async () => {
    const e = env();
    const got = (s: number, n: number) => ({ season: s, number: n });
    const series = (units: Array<{ season: number; number: number }>) => ({ work: 'cinema:tt0944947', section: 'cinema', kind: 'episode', title: 'GoT', units });
    await observe(e, [series([got(1, 1), got(1, 10)])], NOW);
    expect(await observe(e, [series([got(1, 10), got(2, 1)])], NOW + H)).toMatchObject({ created: 1 });
    expect(await observe(e, [series([got(4, 1)])], NOW + 2 * H)).toMatchObject({ created: 0 }); // قفز مواسم = ترقيم خاطئ
    const anime = (n: number, at?: number) => ({ work: 'anime:21', section: 'anime', kind: 'episode', title: 'ONE PIECE', units: [{ number: n, ...(at ? { publishedAt: at } : {}) }] });
    await observe(e, [anime(1149)], NOW);
    await observe(e, [anime(1150, NOW + 4 * H)], NOW + 4 * H);
    const movie = { work: 'cinema:tt1375666', section: 'cinema', kind: 'movie', title: 'Inception', units: [{}] };
    expect(await observe(e, [movie], NOW + 3 * H)).toMatchObject({ created: 1 });
    expect(await observe(e, [movie], NOW + 9 * H)).toMatchObject({ created: 0 });
    expect((await list(e, 'section=cinema')).events.map((x) => x.id)).toEqual(['cinema:tt1375666|movie', 'cinema:tt0944947|s2e:1']);
    expect((await list(e, 'section=anime')).events.map((x) => x.id)).toEqual(['anime:21|e:1150']);

    for (let i = 0; i < 4; i++) {
      await observe(e, [manga(`ext:w${i}`, [1], 's')], NOW);
      await observe(e, [manga(`ext:w${i}`, [2], 's')], NOW + i * 1000);
    }
    const first = await list(e, 'section=manga&limit=2');
    expect(first.events.map((x) => x.id)).toEqual(['ext:w3|c:2', 'ext:w2|c:2']);
    await observe(e, [manga('ext:w0', [3], 's')], NOW + 99_000);
    const second = await list(e, `section=manga&limit=2&before=${encodeURIComponent(first.next!)}`);
    expect(second.events.map((x) => x.id)).toEqual(['ext:w1|c:2', 'ext:w0|c:2']);
  });

  it('rejects malformed reports and section/kind mismatches', async () => {
    const e = env();
    const out = await observe(e, [
      { work: 'anime:21', section: 'manga', kind: 'chapter', title: 'x', units: [{ number: 1 }] },
      { work: 'ext:a', section: 'anime', kind: 'episode', title: 'x', units: [{ number: 1 }] },
      { work: 'cinema:tt1', section: 'cinema', kind: 'episode', title: 'no season', units: [{ number: 1 }] },
      { work: 'ext:a', section: 'manga', kind: 'chapter', title: 'x', units: [{ number: -1 }] },
      { work: 'ext:a', section: 'manga', kind: 'chapter', title: '', units: [{ number: 3 }] },
    ], NOW);
    expect(out).toEqual({ accepted: 0, created: 0, baselined: 0 });
    expect(eventId('ext:a', 'chapter', null, 12.5)).toBe(eventId('ext:a', 'chapter', null, 12.50));
  });
});
