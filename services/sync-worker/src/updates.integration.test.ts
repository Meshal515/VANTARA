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
  it('accepts real canonical multi-word manga refs used by the app', async () => {
    const e = env();
    expect(await observe(e, [manga('ext:one piece', [1120], 'x', { 1120: NOW - H })], NOW)).toMatchObject({ accepted: 1, created: 1 });
    expect((await list(e, 'section=manga')).events[0]?.work).toBe('ext:one piece');
  });
  it('keeps all trustworthy catch-up chapters at their historic time, including gaps below the watermark', async () => {
    const e = env();
    await observe(e, [manga('ext:backfill', [20], 'x')], NOW);
    const dates = { 16: NOW - 30 * H, 17: NOW - 5 * H, 18: NOW - 3 * H, 19: NOW - H, 20: NOW - 10 * 60_000 };
    await observe(e, [manga('ext:backfill', [16, 17, 18, 19, 20], 'y', dates)], NOW + H);
    const events = (await list(e, 'section=manga')).events;
    expect(events.map((r) => r.number)).toEqual([20, 19, 18, 17, 16]);
    expect(events.map((r) => r.at)).toEqual([20, 19, 18, 17, 16].map((n) => dates[n as keyof typeof dates]));
    expect(events.every((r) => r.firstSeenAt === NOW + H)).toBe(true);
  });
  it('opening an undated or old movie never manufactures a release now', async () => {
    const e = env();
    const film = (id: string, publishedAt?: number) => ({ work: `cinema:${id}`, section: 'cinema', kind: 'movie', title: id, units: [{ publishedAt }] });
    expect(await observe(e, [film('tt1')], NOW)).toMatchObject({ created: 0 });
    await observe(e, [film('tt2', Date.UTC(2010, 6, 16)), film('tt3', NOW - 30_000)], NOW);
    const events = (await list(e, 'section=cinema')).events;
    expect(events.map((r) => [r.work, r.at])).toEqual([['cinema:tt3', NOW - 30_000], ['cinema:tt2', Date.UTC(2010, 6, 16)]]);
  });
  it('first sight of a 400-chapter work is a baseline, not 400 updates; 401 from any path is one event', async () => {
    const e = env();
    expect(await observe(e, [manga('ext:solo', range(343, 400), 'mangalek', { 400: NOW - 30 * 86_400_000 })], NOW)).toMatchObject({ created: 1, baselined: 1 });
    expect((await list(e, 'section=manga')).events.map((r) => r.at)).toEqual([NOW - 30 * 86_400_000]);
    // صفحة العمل في مصدر آخر تكشف 401 (لم يظهر في Latest)
    expect(await observe(e, [manga('ext:solo', range(380, 401), 'teamx')], NOW + H)).toMatchObject({ created: 1, baselined: 0 });
    // Latest المصدر الأول يلحق بعد ساعتين: يُدمج تحت نفس الحدث بلا تغيير وقته
    expect(await observe(e, [manga('ext:solo', [401], 'mangalek')], NOW + 3 * H)).toMatchObject({ created: 0 });
    const { events } = await list(e, 'section=manga');
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ id: 'ext:solo|c:401', at: NOW + H, firstSeenAt: NOW + H, publishedAt: null, sources: [{ s: 'teamx' }, { s: 'mangalek' }] });
  });

  it('dated first sightings enter complete history with their publication time', async () => {
    const e = env();
    await observe(e, [manga('ext:a', [9, 10], 'x', { 10: NOW - 5 * H, 9: NOW - 8 * 86_400_000 }), manga('ext:b', [70], 'x', { 70: NOW - 20 * 86_400_000 })], NOW);
    const { events } = await list(e, 'section=manga');
    expect(events.map((x) => [x.id, x.at, x.publishedAt, x.firstSeenAt])).toEqual([['ext:a|c:10', NOW - 5 * H, NOW - 5 * H, NOW], ['ext:a|c:9', NOW - 8 * 86_400_000, NOW - 8 * 86_400_000, NOW], ['ext:b|c:70', NOW - 20 * 86_400_000, NOW - 20 * 86_400_000, NOW]]);
  });

  it('never moves time on refresh; a reliable publish date is kept apart from firstSeenAt', async () => {
    const e = env();
    await observe(e, [manga('ext:c', [1], 'x')], NOW);
    await observe(e, [manga('ext:c', [2], 'x', { 2: NOW + 2 * H - 600_000 })], NOW + 2 * H);
    await observe(e, [manga('ext:c', [1, 2], 'y', { 2: NOW - 99 * H })], NOW + 5 * H);
    const ev = (await list(e, 'section=manga')).events[0]!;
    expect(ev).toMatchObject({ id: 'ext:c|c:2', at: NOW + 2 * H - 600_000, publishedAt: NOW + 2 * H - 600_000, firstSeenAt: NOW + 2 * H });
  });

  it('a fuller source catching up is not 19 new chapters (النهايات); old-dated chapters are not news', async () => {
    const e = env();
    await observe(e, [manga('ext:finals', [1, 2], 'small')], NOW);
    const dates = { 19: Date.UTC(2025, 10, 15), 20: Date.UTC(2026, 0, 8), 21: Date.UTC(2026, 7, 7) };
    expect(await observe(e, [manga('ext:finals', range(1, 21), 'full', dates)], NOW + H)).toMatchObject({ created: 3 });
    expect((await list(e, 'section=manga')).events.map((r) => r.at)).toEqual([dates[21], dates[20], dates[19]]);
    // الفصل 22 الحقيقي بعدها: حدث واحد بوقته
    expect(await observe(e, [manga('ext:finals', range(1, 22), 'full', dates)], NOW + 2 * H)).toMatchObject({ created: 1 });
    expect((await list(e, 'section=manga')).events.map((x) => x.id)).toEqual(['ext:finals|c:22', 'ext:finals|c:21', 'ext:finals|c:20', 'ext:finals|c:19']);
  });

  it('one canonical cover: the timeline shows the work cover, not the reporting source thumbnail', async () => {
    const e = env();
    await e.DB.prepare('INSERT INTO works (series_ref, title, cover_url, source_id, updated_at, rev) VALUES (?, ?, ?, ?, 0, 0)').bind('ext:finals', 'النهايات', 'https://c/vol1.jpg', 'a').run();
    await observe(e, [{ ...manga('ext:finals', [1], 's'), cover: 'https://c/vol3.jpg' }], NOW);
    await observe(e, [{ ...manga('ext:finals', [2], 's'), cover: 'https://c/vol3.jpg' }], NOW + H);
    expect((await list(e, 'section=manga')).events[0]).toMatchObject({ cover: 'https://c/vol1.jpg' });
  });

  it('legacy undated bursts stay hidden, while dated history remains available', async () => {
    const e = env();
    const put = (id: string, number: number, published: number | null, first: number) =>
      e.DB.prepare('INSERT INTO update_events (id, work, section, kind, season, number, title, cover, at, published_at, first_seen_at, sources, updated_at) VALUES (?, ?, ?, ?, NULL, ?, ?, NULL, ?, ?, ?, ?, ?)')
        .bind(id, 'ext:old', 'manga', 'chapter', number, 'old', published ?? first, published, first, '[]', first);
    await e.DB.batch([
      ...range(3, 9).map((n) => put(`ext:old|c:${n}`, n, null, NOW)),
      put('ext:old|c:21', 21, Date.UTC(2026, 7, 7), NOW),
      put('ext:ok|c:5', 5, null, NOW - H),
    ]);
    await e.DB.prepare("UPDATE update_events SET work = 'ext:ok' WHERE id = 'ext:ok|c:5'").run();
    expect((await list(e, 'section=manga')).events.map((x) => x.id)).toEqual(['ext:ok|c:5', 'ext:old|c:21']);
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
    const movie = { work: 'cinema:tt1375666', section: 'cinema', kind: 'movie', title: 'Inception', units: [{ publishedAt: NOW + 3 * H }] };
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
