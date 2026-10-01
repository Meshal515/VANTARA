import { describe, expect, it, vi } from 'vitest';
import { collectTimelines } from './collectors.ts';
import { sqliteEnv } from './test-d1.ts';
import { handleUpdatesList } from './updates.ts';

const NOW = Date.UTC(2026, 9, 1, 22);
const H = 3_600_000;
const setup = () => sqliteEnv({ VANTARA_SESSION_SECRET: 's'.repeat(40), VANTARA_IDENTITY_SECRET: 'i'.repeat(40), VANTARA_DEVICE_PEPPER: 'p'.repeat(40) } as never);
const reply = (data: unknown) => Response.json(data);

describe('server collectors', () => {
  it('prepares manga, anime and cinema history without any app opening, preserving canonical firstSeenAt on rescan', async () => {
    const { env } = setup();
    const fetcher = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('olympustaff.com/series/')) return new Response(`<div class="chapter-card" data-date="${(NOW - 5 * H) / 1000}" data-number="627"><a href="/series/lookism/627">627</a></div><div class="chapter-card" data-date="${(NOW - H) / 1000}" data-number="628"><a href="/series/lookism/628">628</a></div>`);
      if (url.includes('olympustaff.com')) return new Response('<div class="last-chapter"><div class="box"><img src="/cover.jpg"><div class="info"><a href="/series/lookism"><h3>Lookism</h3></a></div></div></div>');
      if (url.includes('mangadex')) return reply({ data: [] });
      if (url.includes('anilist')) return reply({ data: { Page: { airingSchedules: [{ episode: 12, airingAt: (NOW - 10 * 60_000) / 1000, media: { id: 21, title: { english: 'One Piece' }, coverImage: { large: 'https://c/anime.jpg' } } }] } } });
      if (url.includes('/catalog/movie/')) return reply({ metas: [] });
      if (url.includes('/catalog/')) return reply({ metas: [{ id: 'tt1', type: 'series', name: 'Show' }] });
      return reply({ meta: { id: 'tt1', name: 'Show', videos: [{ season: 1, episode: 2, released: new Date(NOW - 3 * H).toISOString() }] } });
    }) as typeof fetch;
    await collectTimelines(env, { now: NOW, fetchImpl: fetcher });
    const list = async (section: string) => (await handleUpdatesList(new URL(`https://x/v1/updates?section=${section}`), env)).json() as Promise<{ events: Array<{ at: number; firstSeenAt: number; work: string }> }>;
    expect((await list('manga')).events.map((r) => r.at)).toEqual([NOW - H, NOW - 5 * H]);
    expect((await list('anime')).events[0]?.at).toBe(NOW - 10 * 60_000);
    expect((await list('cinema')).events[0]?.at).toBe(NOW - 3 * H);
    await collectTimelines(env, { now: NOW + H, fetchImpl: fetcher });
    expect((await list('manga')).events.every((r) => r.firstSeenAt === NOW)).toBe(true);
  });
  it('falls back to exact AniList mappings and absolute episode numbers during an AniList outage', async () => {
    const { env } = setup();
    await collectTimelines(env, { now: NOW, fetchImpl: (async input => {
      const url = String(input);
      if (url.includes('graphql.anilist.co')) return new Response('blocked', { status: 403 });
      if (url.includes('kitsu')) return reply({ data: [{ id: '12', attributes: { canonicalTitle: 'One Piece' }, relationships: { mappings: { data: [{ id: 'mapping1' }] } } }],
        included: [{ id: 'mapping1', type: 'mappings', attributes: { externalSite: 'anilist/anime', externalId: '21' } }] });
      if (url.includes('ani.zip')) return reply({ mappings: { anilist_id: 21 }, episodes: { '1160': { episodeNumber: 5, absoluteEpisodeNumber: 1160, airDateUtc: new Date(NOW - H).toISOString() } } });
      if (url.includes('olympus')) return new Response('');
      if (url.includes('mangadex')) return reply({ data: [] });
      return reply({ metas: [] });
    }) as typeof fetch });
    const response = await handleUpdatesList(new URL('https://x/v1/updates?section=anime'), env);
    expect((await response.json() as { events: unknown[] }).events).toEqual([expect.objectContaining({ work: 'anime:21', number: 1160, at: NOW - H })]);
  });
  it('collects dated movies without opening them and ignores undated or future catalog entries', async () => {
    const { env } = setup();
    // Pick the movie collection minute and let the other providers return empty feeds.
    const now = NOW + ((1 - Math.floor(NOW / 60_000) % 2 + 2) % 2) * 60_000;
    await collectTimelines(env, { now, scheduled: true, fetchImpl: (async input => {
      if (!String(input).includes('/catalog/movie/')) return reply(String(input).includes('anilist') ? { data: { Page: { airingSchedules: [] } } } : { metas: [] });
      return reply({ metas: [
      { id: 'tt1', name: 'Released', released: new Date(now - H).toISOString() },
      { id: 'tt2', name: 'Undated' }, { id: 'tt3', name: 'Future', released: new Date(now + H).toISOString() },
    ] }); }) as typeof fetch });
    const response = await handleUpdatesList(new URL('https://x/v1/updates?section=cinema'), env);
    expect((await response.json() as { events: unknown[] }).events).toEqual([expect.objectContaining({ work: 'cinema:tt1', kind: 'movie', at: now - H })]);
  });
  it('advances rotation despite a broken detail page, so later works are not starved', async () => {
    const { env } = setup();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const now = NOW - (Math.floor(NOW / 60_000) % 2) * 60_000;
    await collectTimelines(env, { now, scheduled: true, fetchImpl: (async input => {
      const url = String(input);
      if (url.includes('/series/work0')) return new Response('broken', { status: 503 });
      if (url.includes('olympustaff.com/series/')) return new Response(`<div class="chapter-card" data-date="${(now-H)/1000}" data-number="1"></div>`);
      if (url.includes('olympus')) return new Response('<div class="last-chapter">' + Array.from({ length: 16 }, (_, i) => `<div class="box"><a href="/series/work${i}"><h3>Work${i}</h3></a></div>`).join(''));
      return reply({ data: [] });
    }) as typeof fetch });
    const status = await env.DB.prepare('SELECT cursor,last_error FROM collector_state WHERE source=?').bind('teamx').first<{ cursor: number; last_error: string }>();
    expect(status?.cursor).toBe(4);
    expect(status?.last_error).toContain('1 chapter pages failed');
    errors.mockRestore();
  });
  it('keeps scheduled ingestion under the 50-query D1 Free limit during a full catch-up', async () => {
    for (let slot = 0; slot < 2; slot++) {
      const { env } = setup();
      let queries = 0;
      const prepare = env.DB.prepare.bind(env.DB);
      env.DB.prepare = (sql: string) => { queries++; return prepare(sql); };
      const now = NOW + ((slot - Math.floor(NOW / 60_000) % 2 + 2) % 2) * 60_000;
      await collectTimelines(env, { now, scheduled: true, fetchImpl: (async input => {
        const url = String(input);
        if (url.includes('olympustaff.com/series/')) return new Response(Array.from({ length: 40 }, (_, i) => `<div class="chapter-card" data-date="${(now - (i+1)*60_000)/1000}" data-number="${400-i}"></div>`).join(''));
        if (url.includes('olympus')) return new Response('<div class="last-chapter">' + Array.from({ length: 24 }, (_, i) => `<div class="box"><a href="/series/work${i}"><h3>Work${i}</h3></a></div>`).join(''));
        if (url.includes('mangadex')) return reply({ data: Array.from({ length: 50 }, (_, i) => ({ attributes: { chapter: '1', publishAt: new Date(now-H).toISOString() }, relationships: [{ id: String(i), type: 'manga', attributes: { title: { en: `Dex${i}` } } }] })) });
        if (url.includes('anilist')) return reply({ data: { Page: { airingSchedules: Array.from({ length: 50 }, (_, i) => ({ episode: 1, airingAt: (now-H)/1000, media: { id: i+1, title: { english: `Anime${i}` } } })) } } });
        if (url.includes('/catalog/movie/')) return reply({ metas: Array.from({ length: 40 }, (_, i) => ({ id: `tt${i+1}`, name: `Movie${i}`, released: new Date(now-H).toISOString() })) });
        if (url.includes('/catalog/')) return reply({ metas: Array.from({ length: 100 }, (_, i) => ({ id: `tt${i+1}` })) });
        return reply({ meta: { name: 'Series', videos: Array.from({ length: 40 }, (_, i) => ({ season: 1, episode: i+1, released: new Date(now-H).toISOString() })) } });
      }) as typeof fetch });
      expect(queries).toBeLessThanOrEqual(50);
      const statuses = await env.DB.prepare('SELECT last_error FROM collector_state').all<{ last_error: string | null }>();
      expect(statuses.results.every(r => r.last_error === null)).toBe(true);
      expect((await env.DB.prepare('SELECT count(*) as n FROM update_events').first<{ n: number }>())!.n).toBeGreaterThan(0);
    }
  });
  it('one source outage keeps other collectors running and persists a truthful failure status', async () => {
    const { env } = setup();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    await collectTimelines(env, { now: NOW, fetchImpl: (async (input) => {
      if (String(input).includes('anilist')) return reply({ data: { Page: { airingSchedules: [] } } });
      throw new Error('source unavailable');
    }) as typeof fetch });
    const rows = await env.DB.prepare('SELECT source, last_success_at, last_error FROM collector_state ORDER BY source').all<{ source: string; last_success_at: number; last_error: string | null }>();
    expect(rows.results.find((r) => r.source === 'anilist')?.last_success_at).toBe(NOW);
    expect(rows.results.find((r) => r.source === 'teamx')?.last_error).toContain('source unavailable');
    expect(errors).toHaveBeenCalledTimes(4);
    errors.mockRestore();
  });
});
