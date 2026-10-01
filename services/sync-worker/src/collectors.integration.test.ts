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
    expect(errors).toHaveBeenCalledTimes(3);
    errors.mockRestore();
  });
});
