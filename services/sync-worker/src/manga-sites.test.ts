import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ikenWorks, madaraCards, MANGA_SITES, readSite, siteReport, swatWorks } from './manga-sites.ts';
import { collectTimelines } from './collectors.ts';
import { normalizeTitle } from '../../../apps/web/lib/catalog.js';
import { sqliteEnv } from './test-d1.ts';
import { handleUpdatesList } from './updates.ts';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const NOW = Date.UTC(2026, 9, 16, 10);

/** عينات حية (16 أكتوبر 2026) من صفحات «آخر التحديثات» نفسها. */
describe('server manga sites', () => {
  it('reads Madara admin-ajax cards: title, path, cover and the two newest chapters', () => {
    const cards = madaraCards(fixture('madara-latest.html'), 'https://mangalik.net');
    expect(cards.length).toBe(3);
    expect(cards[0]).toMatchObject({ title: 'The Villain Family’s Strongest Butler', url: '/manga/the-villain-familys-strongest-butler/', units: [{ number: 22 }, { number: 21 }] });
    expect(cards[0]!.cover).toMatch(/^https:\/\/io\.mangalik\.net\//);
  });
  it('reads Madara archive pages (3asq) with the same parser', () => {
    const cards = madaraCards(fixture('madara-archive.html'), 'https://3asq.online');
    expect(cards.length).toBeGreaterThan(0);
    expect(cards.every((c) => c.title && c.url.startsWith('/') && c.units.length > 0 && c.units.length <= 2)).toBe(true);
    // العمل الأول عليه شارة «18+» في الموقع نفسه: محتوى للكبار لا يُبلَّغ، ولا تصير الشارة (رابط X) عملًا
    expect(cards.some((c) => c.title === 'Kimi wa Yotsuba no Clover' || c.url.includes('x.com'))).toBe(false);
  });
  it('reads Iken and MangaSwat JSON with exact upload times', () => {
    const raw = JSON.parse(fixture('iken-latest.json'));
    const iken = ikenWorks(raw, NOW);
    const first = raw.posts.find((p: { seriesType?: string }) => p.seriesType !== 'NOVEL');
    expect(iken.some((w) => w.title === raw.posts[0].postTitle)).toBe(raw.posts[0].seriesType !== 'NOVEL');
    expect(iken.find((w) => w.title === 'My Contract Husband Resembles the Male Protagonist')?.units.map((u) => u.number)).toEqual([64, 63]);
    expect(iken[0]).toMatchObject({ title: first.postTitle, url: `${first.slug}#${first.id}`, });
    expect(iken[0]!.units[0]!.number).toBe(first.chapters[0].number);
    expect(iken[0]!.units[0]!.publishedAt).toBe(Date.parse(first.chapters[0].createdAt));
    const swat = swatWorks(JSON.parse(fixture('swat-releases.json')), NOW);
    expect(swat[0]).toMatchObject({ title: 'Solo Max-Level Newbie', url: '800119' });
    expect(swat[0]!.units[0]).toMatchObject({ number: 281, publishedAt: Date.parse('2026-10-16T08:32:11.02886+00:00') });
  });
  it('keys works exactly like the app does so server and phone events meet', () => {
    const site = MANGA_SITES.find((s) => s.kind === 'madara')!;
    expect(siteReport(site, { title: 'Don’t Stop', url: '/manga/x/', cover: null, units: [{ number: 3 }] })?.work).toBe(`ext:${normalizeTitle('Don’t Stop')}`);
  });
  it('treats an empty or blocked listing as a site failure instead of silence', async () => {
    const site = MANGA_SITES[0]!;
    await expect(readSite(site, (async () => new Response('<html>Just a moment...</html>')) as typeof fetch, NOW)).rejects.toThrow('empty listing');
    await expect(readSite(site, (async () => new Response('no', { status: 403 })) as typeof fetch, NOW)).rejects.toThrow('HTTP 403');
  });
  it('turns a new chapter on a known work into a timeline event within the rotation, and records each site health', async () => {
    const { env } = sqliteEnv({ VANTARA_SESSION_SECRET: 's'.repeat(40), VANTARA_IDENTITY_SECRET: 'i'.repeat(40), VANTARA_DEVICE_PEPPER: 'p'.repeat(40) } as never);
    let chapter = 22;
    const html = () => fixture('madara-latest.html').replace(/\/22\/" class="btn-link"> 22 </g, `/${chapter}/" class="btn-link"> ${chapter} </`);
    const fetcher = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('mangalik.net')) return new Response(html());
      if (url.includes('azorafly')) return Response.json(JSON.parse(fixture('iken-latest.json')));
      if (url.includes('meshmanga')) return new Response('blocked', { status: 403 });
      return Response.json({});
    }) as typeof fetch;
    // دقائق المواقع فقط (الفردية): الدورة تمرّ على المواقع التسعة ثم تعود إلى mangalik
    const start = NOW - (NOW % 60_000);
    const minutes = Array.from({ length: 12 }, (_, k) => start + k * 60_000).filter((t) => Math.floor(t / 60_000) % 2 === 1);
    await collectTimelines(env, { now: minutes[0]!, fetchImpl: fetcher, scheduled: true });
    chapter = 23;
    for (const t of minutes.slice(1, 2)) await collectTimelines(env, { now: t, fetchImpl: fetcher, scheduled: true });
    const events = ((await (await handleUpdatesList(new URL('https://x/v1/updates?section=manga&limit=100'), env)).json()) as { events: Array<{ work: string; number: number; sources: Array<{ s: string }> }> }).events;
    const butler = events.filter((e) => e.work === `ext:${normalizeTitle('The Villain Family’s Strongest Butler')}`);
    expect(butler.map((e) => e.number)).toEqual([23]);
    expect(butler[0]!.sources[0]!.s).toBe('eu.kanade.tachiyomi.extension.ar.mangalek');
    const state = await env.DB.prepare(`SELECT source, last_error FROM collector_state WHERE source LIKE 'site:%' ORDER BY source`).all<{ source: string; last_error: string | null }>();
    expect(state.results?.find((r) => r.source.endsWith('.mangaswat'))?.last_error).toBe('HTTP 403');
    expect(state.results?.find((r) => r.source.endsWith('.mangalek'))?.last_error).toBeNull();
  });
});

describe('top chapters for duplicate detection', () => {
  it('serves each manga work and its highest chapter, skipping first chapters', async () => {
    const { env } = sqliteEnv({ VANTARA_SESSION_SECRET: 's'.repeat(40), VANTARA_IDENTITY_SECRET: 'i'.repeat(40), VANTARA_DEVICE_PEPPER: 'p'.repeat(40) } as never);
    const { handleUpdatesObserve, handleUpdatesTwins } = await import('./updates.ts');
    const works = [['City Of Sin', 37], ['City of Sins', 37], ['Tiny', 2]].map(([title, n]) => ({ work: `ext:${normalizeTitle(String(title))}`, section: 'manga', kind: 'chapter', title, units: [{ number: n }] }));
    await handleUpdatesObserve(new Request('https://x/v1/updates/observe', { method: 'POST', body: JSON.stringify({ works }) }), env, NOW);
    const body = await (await handleUpdatesTwins(env, NOW)).json() as { works: Array<[string, number]> };
    expect(body.works.sort()).toEqual([[normalizeTitle('City Of Sin'), 37], [normalizeTitle('City of Sins'), 37]].sort());
  });
});

describe('adult content never reaches the timeline from the server', () => {
  it('skips Madara cards with the 18+ badge and Iken/MangaSwat works tagged adult', () => {
    const card = (badge: string, title: string) => `<div class="page-item-detail manga"><div class="post-title"><h3>${badge}<a href="/manga/${title.toLowerCase().replace(/ /g, '-')}/">${title}</a></h3></div><div class="list-chapter"><span class="chapter"><a href="/manga/x/5/">5</a></span></div></div>`;
    const html = card('<span class="manga-title-badges custom adult badge-round"><span class="text">18+</span></span>', 'Hidden Work') + card('', 'Clean Work') + card('', 'Night [NSFW]');
    expect(madaraCards(html, 'https://s.test').map((c) => c.title)).toEqual(['Clean Work']);
    const iken = ikenWorks({ posts: [{ id: 1, slug: 'a', postTitle: 'A', genres: [{ name: 'Yaoi' }], chapters: [{ number: 9 }] }, { id: 2, slug: 'b', postTitle: 'B', genres: [{ name: 'Action' }], chapters: [{ number: 9 }] }] }, NOW);
    expect(iken.map((w) => w.title)).toEqual(['B']);
    const swat = swatWorks({ results: [{ serie_id: 1, title: 'S1', genres: [{ name: 'هنتاي' }], chapters: [{ chapter: '3' }] }, { serie_id: 2, title: 'S2', genres: [{ name: 'أكشن' }], chapters: [{ chapter: '3' }] }] }, NOW);
    expect(swat.map((w) => w.title)).toEqual(['S2']);
  });
});
