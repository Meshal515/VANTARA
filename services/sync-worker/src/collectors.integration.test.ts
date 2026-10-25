import { describe, expect, it, vi } from 'vitest';
import { collectTimelines, teamxCards, teamxChapters } from './collectors.ts';
import { sqliteEnv } from './test-d1.ts';
import { handleUpdatesList, handleUpdatesObserve } from './updates.ts';

const NOW = Date.UTC(2026, 9, 1, 22);
const H = 3_600_000;
const setup = () => sqliteEnv({ VANTARA_SESSION_SECRET: 's'.repeat(40), VANTARA_IDENTITY_SECRET: 'i'.repeat(40), VANTARA_DEVICE_PEPPER: 'p'.repeat(40) } as never);
const reply = (data: unknown) => Response.json(data);

describe('server collectors', () => {
  it('preserves a matching source-less historical event that TeamX never contributed',async()=>{
    const {env}=setup();
    await handleUpdatesObserve(new Request('https://x/v1/updates/observe',{method:'POST',body:JSON.stringify({works:[{work:'ext:work',section:'manga',kind:'chapter',title:'Work',source:null,units:[{number:251,publishedAt:NOW-H}]}]})}),env,NOW);
    await collectTimelines(env,{now:NOW,scheduled:true,fetchImpl:(async input=>String(input).includes('/series/')?new Response(chapter(251,true)+chapter(218)):String(input).includes('olympus')?new Response('<div class="last-chapter"><div class="box"><a href="/series/LWW"><h3>Work</h3></a></div></div>'):Response.json({data:[]}))as typeof fetch});
    expect(await env.DB.prepare('SELECT number,sources FROM update_events WHERE work=? AND number=251').bind('ext:work').first()).toMatchObject({number:251,sources:'[]'});
  });
  const chapter = (number: number, locked = false, series = 'LWW') => `<div class="chapter-card" data-number="${number}" data-date="${(NOW-H)/1000}"><a class="chapter-link" href="${locked?'#':`/series/${series}/${number}`}" ${locked?'data-bs-toggle="modal" data-bs-target="#buyModel"':''}><div><span class="${locked?'locked':'unread'}"></span></div></a></div>`;
  it('reports only a real chapter link, excluding purchase modals even without the old lock badge', () => {
    const html=chapter(251,true)+chapter(250,true).replace('class="locked"','class="unread"')+chapter(218)+chapter(217).replace('/series/LWW/217','https://other.test/series/LWW/217');
    expect(teamxChapters(html,NOW).map(c=>c.number)).toEqual([218]);
  });
  it('repairs old blocked-only events but preserves the same chapter from another Arabic source and its dates', async () => {
    const {env}=setup();const sid='eu.kanade.tachiyomi.extension.ar.teamx';
    const report=(title:string,s:string,number:number)=>({work:`ext:${title.toLowerCase()}`,section:'manga',kind:'chapter',title,source:{s,u:'/series/LWW'},units:[{number,publishedAt:NOW-H}]});
    await handleUpdatesObserve(new Request('https://x/v1/updates/observe',{method:'POST',body:JSON.stringify({works:[report('The Long Way Of The Warrior',sid,251),report('The Long Way Of The Warrior','ar.other',251),report('Rise Of The Northern Shadow',sid,34),{...report('The Long Way Of The Warrior',sid,200),source:null}]})}),env,NOW);
    await handleUpdatesObserve(new Request('https://x/v1/updates/observe',{method:'POST',body:JSON.stringify({works:[{...report('The Long Way Of The Warrior',sid,251),units:[{number:251}]}]})}),env,NOW);
    const fetcher=(async(input:RequestInfo|URL)=>{
      const url=String(input);
      if(url.endsWith('/series/LWW'))return new Response(chapter(251,true)+chapter(218));
      if(url.endsWith('/series/rise'))return new Response(chapter(34,true,'rise')+chapter(31,false,'rise'));
      if(url==='https://olympustaff.com')return new Response('<div class="last-chapter"><div class="box"><a href="/series/LWW"><h3>The Long Way Of The Warrior</h3></a></div><div class="box"><a href="/series/rise"><h3>Rise Of The Northern Shadow</h3></a></div></div>');
      return Response.json({data:[]});
    })as typeof fetch;
    await collectTimelines(env,{now:NOW,fetchImpl:fetcher,scheduled:true});
    const body=await(await handleUpdatesList(new URL('https://x/v1/updates?section=manga'),env)).json()as{events:Array<{number:number;sources:Array<{s:string}>;at:number;firstSeenAt:number}>};
    expect(body.events.some(e=>e.number===34)).toBe(false);
    expect(body.events.find(e=>e.number===251)).toMatchObject({sources:[{s:'ar.other'}],at:NOW-H,firstSeenAt:NOW});
    expect(body.events.map(e=>e.number)).toEqual(expect.arrayContaining([218,31,200]));
    expect(await env.DB.prepare('SELECT max_number FROM update_watermarks WHERE work=?').bind('ext:rise of the northern shadow').first()).toMatchObject({max_number:31});
    expect(await env.DB.prepare('SELECT max_number FROM update_watermarks WHERE work=?').bind('ext:the long way of the warrior').first()).toMatchObject({max_number:251});
    expect(await env.DB.prepare('SELECT max_number FROM update_source_watermarks WHERE work=? AND source_id=?').bind('ext:the long way of the warrior',sid).first()).toMatchObject({max_number:218});
  });
  it('never withdraws a chapter merely because the provider request failed',async()=>{
    const {env}=setup();const sid='eu.kanade.tachiyomi.extension.ar.teamx';
    await handleUpdatesObserve(new Request('https://x/v1/updates/observe',{method:'POST',body:JSON.stringify({works:[{work:'ext:work',section:'manga',kind:'chapter',title:'Work',source:{s:sid},units:[{number:251,publishedAt:NOW-H}]}]})}),env,NOW);
    const log=vi.spyOn(console,'error').mockImplementation(()=>{});
    try{await collectTimelines(env,{now:NOW,scheduled:true,fetchImpl:(async()=>new Response('offline',{status:503}))as typeof fetch});}finally{log.mockRestore();}
    const body=await(await handleUpdatesList(new URL('https://x/v1/updates?section=manga'),env)).json()as{events:Array<{number:number}>};
    expect(body.events[0]?.number).toBe(251);
  });
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
  it('decodes every HTML entity in Team-X titles so the work key matches the app', () => {
    const html = '<div class="last-chapter"><div class="box"><a href="https://olympustaff.com/series/dont-breathe"><img src="https://olympustaff.com/images/manga/thumbnail_a.jpg"></a><h3>Don&#039;t Breathe &amp; Run</h3></div>';
    const [card] = teamxCards(html);
    expect(card).toMatchObject({ title: "Don't Breathe & Run", cover: 'https://olympustaff.com/images/manga/a.jpg' });
  });
  it('identifies the server-side MangaDex collector with a User-Agent required by its API', async () => {
    const { env } = setup();
    const now = NOW - (Math.floor(NOW / 60_000) % 4) * 60_000;
    const requests: Headers[] = [];
    await collectTimelines(env, { now, scheduled: true, fetchImpl: (async (input, init) => {
      if (String(input).includes('api.mangadex.org')) {
        const headers = new Headers(init?.headers); requests.push(headers);
        if (!headers.get('User-Agent')?.includes('VANTARA/')) return new Response('You must set an appropriate User-Agent header', { status: 400 });
        // غلاف كل عمل في طلب واحد بعد الفصول
        if (String(input).includes('/manga?')) return reply({ data: [{ id: 'm1', relationships: [{ type: 'cover_art', attributes: { fileName: 'c0ver.jpg' } }] }] });
        return reply({ data: [{ attributes: { chapter: '627', publishAt: new Date(now - H).toISOString() }, relationships: [{ id: 'm1', type: 'manga', attributes: { title: { en: 'Lookism' } } }] }] });
      }
      return new Response('');
    }) as typeof fetch });
    expect(requests).toHaveLength(2);
    expect(requests.every((h) => h.get('User-Agent')?.includes('https://github.com/Meshal515/VANTARA'))).toBe(true);
    const status = await env.DB.prepare('SELECT last_success_at,last_error FROM collector_state WHERE source=?').bind('mangadex-ar').first<{ last_success_at: number; last_error: string | null }>();
    expect(status).toEqual({ last_success_at: now, last_error: null });
    const response = await handleUpdatesList(new URL('https://x/v1/updates?section=manga'), env);
    expect((await response.json() as { events: unknown[] }).events).toEqual([expect.objectContaining({ work: 'ext:lookism', number: 627, at: now-H, cover: 'https://uploads.mangadex.org/covers/m1/c0ver.jpg.512.jpg' })]);
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
    const now = NOW + ((2 - Math.floor(NOW / 60_000) % 4 + 4) % 4) * 60_000;
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
    const now = NOW - (Math.floor(NOW / 60_000) % 4) * 60_000;
    await collectTimelines(env, { now, scheduled: true, fetchImpl: (async input => {
      const url = String(input);
      if (url.includes('/series/work0')) return new Response('broken', { status: 503 });
      if (url.includes('olympustaff.com/series/')) return new Response(`<div class="chapter-card" data-date="${(now-H)/1000}" data-number="1"><a href="/series/work/1"></a></div>`);
      if (url.includes('olympus')) return new Response('<div class="last-chapter">' + Array.from({ length: 16 }, (_, i) => `<div class="box"><a href="/series/work${i}"><h3>Work${i}</h3></a></div>`).join(''));
      return reply({ data: [] });
    }) as typeof fetch });
    const status = await env.DB.prepare('SELECT cursor,last_error FROM collector_state WHERE source=?').bind('teamx').first<{ cursor: number; last_error: string }>();
    expect(status?.cursor).toBe(4);
    expect(status?.last_error).toContain('1 chapter pages failed');
    errors.mockRestore();
  });
  it('keeps scheduled ingestion under the 50-query D1 Free limit during a full catch-up', async () => {
    for (let slot = 0; slot < 4; slot++) {
      const { env } = setup();
      let queries = 0;
      const prepare = env.DB.prepare.bind(env.DB);
      env.DB.prepare = (sql: string) => {
        queries++;const statement=prepare(sql),bind=statement.bind.bind(statement);
        statement.bind=(...values:unknown[])=>{expect(values.length).toBeLessThanOrEqual(100);return bind(...values);};
        return statement;
      };
      const now = NOW + ((slot - Math.floor(NOW / 60_000) % 4 + 4) % 4) * 60_000;
      await collectTimelines(env, { now, scheduled: true, fetchImpl: (async input => {
        const url = String(input);
        // مواقع المانجا العربية بقوائم كاملة (20 عملًا لكل موقع)
        if (url.includes('admin-ajax') || url.includes('m_orderby')) return new Response(Array.from({ length: 20 }, (_, i) => `<div class="page-item-detail manga"><img src="https://c/${i}.jpg"><div class="post-title"><h3><a href="/manga/m${i}/">Madara${i}</a></h3></div><div class="list-chapter"><span class="chapter"><a href="/manga/m${i}/9/">9</a></span><span class="chapter"><a href="/manga/m${i}/8/">8</a></span></div></div>`).join(''));
        if (url.includes('api.azorafly')) return reply({ posts: Array.from({ length: 24 }, (_, i) => ({ id: i, slug: `a${i}`, postTitle: `Iken${i}`, chapters: [{ number: 5, createdAt: new Date(now - H).toISOString() }, { number: 4, createdAt: new Date(now - 2 * H).toISOString() }] })) });
        if (url.includes('meshmanga')) return reply({ results: Array.from({ length: 20 }, (_, i) => ({ serie_id: i + 1, title: `Swat${i}`, chapters: [{ chapter: '7', created_at: new Date(now - H).toISOString() }] })) });
        if (url.includes('olympustaff.com/series/')) return new Response(Array.from({ length: 40 }, (_, i) => `<div class="chapter-card" data-date="${(now - (i+1)*60_000)/1000}" data-number="${400-i}"><a href="${i<33?'#':`/series/work/${400-i}`}" ${i<33?'data-bs-target="#buyModel"':''}></a></div>`).join(''));
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
