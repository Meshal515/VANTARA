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
    // شارة «18+» قبل العنوان ترتبط بحساب على X: لا تصير هي العمل
    expect(cards[0]).toMatchObject({ title: 'Kimi wa Yotsuba no Clover', url: '/manga/kimi-wa-yotsuba-no-clover/', units: [{ number: 106 }, { number: 105 }] });
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
