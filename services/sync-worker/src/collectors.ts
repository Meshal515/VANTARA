/** Server-side release collectors. Publication dates come from providers, never the scan clock. */
import { decodeEntities, normalizeTitle } from '../../../apps/web/lib/catalog.js';
import { handleUpdatesObserve } from './updates.ts';
import { MANGA_SITES, readSite, siteReport } from './manga-sites.ts';
import { adultGenre } from '../../../apps/web/lib/adult-filter.js';
import { teamxChapterLink } from '../../../apps/web/lib/chapter-access.js';
import type { Env } from './types.ts';

const TEAMX = 'https://olympustaff.com';
const TEAMX_SOURCE = 'eu.kanade.tachiyomi.extension.ar.teamx';
const CINEMETA = 'https://v3-cinemeta.strem.io';
const DAY = 86_400_000;
type Observation = { work: string; section: string; kind: string; title: string; cover?: string | null; source: { s: string; u?: string; lockedMax?:number|null }; units: Array<{ number?: number; season?: number; publishedAt?: number }> };
type Fetcher = typeof fetch;
class PartialScan extends Error {
  readonly cursor: number;
  constructor(message: string, cursor: number) { super(message); this.cursor = cursor; }
}
// كل الكيانات لا بعضها: «Don&#039;t» كانت تبقى كما هي فيصير مفتاح العمل غير مفتاحه
const text = (value: string) => decodeEntities(value.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const attr = (tag: string, name: string) => new RegExp(`\\b${name}=["']([^"']+)["']`, 'i').exec(tag)?.[1] ?? '';

async function request(url: string, fetchImpl: Fetcher, init: RequestInit = {}): Promise<Response> {
  const response = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response;
}

/** Latest Team-X cards point to dated chapter lists; no inferred “published now”. */
export function teamxCards(html: string) {
  const start = html.indexOf('class="last-chapter"');
  const area = start < 0 ? html : html.slice(start);
  return area.split(/<div\b[^>]*class=["']box["'][^>]*>/i).slice(1).map((block) => {
    const title = text(/<h3\b[^>]*>([\s\S]*?)<\/h3>/i.exec(block)?.[1] ?? '');
    const href = /<a\b[^>]*href=["']([^"']*\/series\/[^"']+)["']/i.exec(block)?.[1];
    const src = /<img\b[^>]*src=["']([^"']+)["']/i.exec(block)?.[1];
    if (!title || !href) return null;
    const url = new URL(href, TEAMX);
    if (url.origin !== TEAMX || !/^\/series\/[^/]+\/?$/.test(url.pathname)) return null;
    return { title, url: url.href, cover: src ? new URL(src.replace('thumbnail_', ''), TEAMX).href : null };
  }).filter((row): row is NonNullable<typeof row> => row !== null);
}

function teamxRows(html: string, now: number) {
  const cards=[...html.matchAll(/<div\b[^>]*class=["'][^"']*\bchapter-card\b[^"']*["'][^>]*>/gi)];
  return cards.map((card,i)=>{
    const tag=card[0],raw=attr(tag,'data-number'),number=Number(raw),publishedAt=Number(attr(tag,'data-date'))*1000;
    const block=html.slice(card.index!+tag.length,cards[i+1]?.index??html.length);
    const link=/<a\b[^>]*href=["'][^"']*["'][^>]*>/i.exec(block)?.[0]??'';
    const locked=[...block.matchAll(/<span\b[^>]*>/gi)].some(([span])=>attr(span,'class').split(/\s+/).includes('locked'))
      || attr(link,'data-bs-target')==='#buyModel';
    return {number,publishedAt,valid:raw!==''&&Number.isFinite(number)&&number>=0&&number<=100_000&&publishedAt>0&&publishedAt<=now,
      locked,readable:teamxChapterLink(attr(link,'href'),TEAMX,locked)};
  }).filter(row=>row.valid);
}
export function teamxChapters(html: string, now: number) {
  return readableTeamxUnits(teamxRows(html,now));
}
function readableTeamxUnits(rows: ReturnType<typeof teamxRows>) {
  return rows.filter(row=>row.readable).map(({number,publishedAt})=>({number,publishedAt}))
    .sort((a,b)=>b.publishedAt-a.publishedAt).slice(0,40);
}

/** Correct only explicit locked observations; preserve other providers and event dates. */
type TeamxCorrection = {work:string;locked:number[];highestReadable:number|null};
function correctionGroups(rows: TeamxCorrection[]) {
  const groups: TeamxCorrection[][]=[];
  let group: TeamxCorrection[]=[],parameters=0;
  for(const row of rows){
    // A CASE pair plus this work and its chapter numbers; leave headroom under
    // D1's 100-bound-parameter ceiling, independently of its query budget.
    const cost=row.locked.length+3;
    if(group.length&&parameters+cost>90){groups.push(group);group=[];parameters=0;}
    group.push(row);parameters+=cost;
  }
  if(group.length)groups.push(group);
  return groups;
}
async function repairTeamxEvents(env: Env, corrections: TeamxCorrection[]) {
  if(!corrections.length)return;
  // Delete only proven TeamX-only rows before stripping that provider from
  // mixed rows. A pre-existing source-less/unknown observation stays intact.
  const writes=correctionGroups(corrections).map(group=>env.DB.prepare(`DELETE FROM update_events WHERE section='manga' AND kind='chapter'
    AND (${group.map(c=>`(work=? AND number IN (${c.locked.map(()=>'?').join(',')}))`).join(' OR ')})
    AND EXISTS(SELECT 1 FROM json_each(sources) WHERE json_extract(value,'$.s')=?)
    AND NOT EXISTS(SELECT 1 FROM json_each(sources) WHERE COALESCE(json_extract(value,'$.s'),'')<>?)`)
    .bind(...group.flatMap(c=>[c.work,...c.locked]),TEAMX_SOURCE,TEAMX_SOURCE));
  for(const group of correctionGroups(corrections))writes.push(env.DB.prepare(`UPDATE update_events SET sources=(
    SELECT json_group_array(json(value)) FROM json_each(update_events.sources) WHERE COALESCE(json_extract(value,'$.s'),'')<>?
    ) WHERE section='manga' AND kind='chapter' AND (${group.map(c=>`(work=? AND number IN (${c.locked.map(()=>'?').join(',')}))`).join(' OR ')})
    AND EXISTS(SELECT 1 FROM json_each(sources) WHERE json_extract(value,'$.s')=?)`)
    .bind(TEAMX_SOURCE,...group.flatMap(c=>[c.work,...c.locked]),TEAMX_SOURCE));
  const baselines=correctionGroups(corrections.filter(c=>c.highestReadable!==null));
  const predicate=(group:TeamxCorrection[])=>group.map(c=>`(work=? AND max_number IN (${c.locked.map(()=>'?').join(',')}))`).join(' OR ');
  for(const group of baselines)writes.push(env.DB.prepare(`UPDATE update_source_watermarks
    SET max_number=CASE work ${group.map(()=> 'WHEN ? THEN ?').join(' ')} ELSE max_number END
    WHERE source_id=? AND (${predicate(group)})`)
    .bind(...group.flatMap(c=>[c.work,c.highestReadable]),TEAMX_SOURCE,...group.flatMap(c=>[c.work,...c.locked])));
  // Repair a poisoned maximum only when that maximum is explicitly locked.
  // Other providers' dated history and undated source baselines remain evidence.
  for(const group of baselines)writes.push(env.DB.prepare(`UPDATE update_watermarks SET max_number=MAX(
    COALESCE((SELECT MAX(number) FROM update_events e WHERE e.work=update_watermarks.work AND e.kind='chapter'),0),
    COALESCE((SELECT MAX(max_number) FROM update_source_watermarks s WHERE s.work=update_watermarks.work),0),
    CASE work ${group.map(()=> 'WHEN ? THEN ?').join(' ')} ELSE max_number END)
    WHERE section='manga' AND (${predicate(group)})`)
    .bind(...group.flatMap(c=>[c.work,c.highestReadable]),...group.flatMap(c=>[c.work,...c.locked])));
  await env.DB.batch(writes);
}

async function observe(env: Env, works: Observation[], now: number, budget = 80) {
  if (!works.length) return;
  // Keep one invocation below D1 Free's query budget. Recent history wins;
  // retain a fair share of every work instead of one long history consuming it.
  let remaining = budget;
  const bounded = works.map(w => ({ ...w, units: [] as Observation['units'] }));
  for (let i = 0; remaining > 0 && works.some(w => i < w.units.length); i++) {
    for (let j = 0; j < works.length && remaining > 0; j++) {
      const u = works[j]!.units[i]; if (u) { bounded[j]!.units.push(u); remaining--; }
    }
  }
  const response = await handleUpdatesObserve(new Request('https://internal/v1/updates/observe', { method: 'POST', body: JSON.stringify({ works: bounded.filter(w => w.units.length) }) }), env, now);
  if (!response.ok) throw new Error(`ingestion_${response.status}`);
}

async function teamx(env: Env, now: number, fetchImpl: Fetcher, cursor: number) {
  const cards = teamxCards(await (await request(TEAMX, fetchImpl)).text()).slice(0, 24);
  const rotated = cards.slice(4);
  const selected = [...cards.slice(0, 4), ...Array.from({ length: Math.min(4, rotated.length) }, (_, i) => rotated[(cursor + i) % rotated.length]!)];
  const reports: Observation[] = [];
  const corrections: TeamxCorrection[] = [];
  let failures = 0;
  // Two fetches at a time leave headroom for all other collectors.
  for (let i = 0; i < selected.length; i += 2) await Promise.all(selected.slice(i, i + 2).map(async (card) => {
    try {
      const html=await (await request(card.url, fetchImpl)).text();
      const rows=teamxRows(html,now),units=readableTeamxUnits(rows),work=`ext:${normalizeTitle(card.title)}`;
      const locked=rows.filter(row=>row.locked).map(row=>row.number).slice(0,60);
      if(locked.length)corrections.push({work,locked,highestReadable:units.length?Math.max(...units.map(u=>u.number)):null});
      if (units.length) reports.push({ work, section: 'manga', kind: 'chapter', title: card.title, cover: card.cover, source: { s: TEAMX_SOURCE, u: new URL(card.url).pathname, lockedMax:locked.length?Math.max(...locked):null }, units });
    } catch { failures++; }
  }));
  await repairTeamxEvents(env,corrections);
  await observe(env, reports, now);
  if (failures) throw new PartialScan(`${failures} chapter pages failed`, rotated.length ? (cursor + 4) % rotated.length : 0);
  return rotated.length ? (cursor + 4) % rotated.length : 0;
}

async function mangaDex(env: Env, now: number, fetchImpl: Fetcher) {
  // بلا محتوى للكبار: MangaDex يضمّ erotica افتراضيًا ما لم تُحدَّد الفئات
  const query = 'limit=50&translatedLanguage%5B%5D=ar&includes%5B%5D=manga&order%5BpublishAt%5D=desc&contentRating%5B%5D=safe&contentRating%5B%5D=suggestive';
  const body = await (await request(`https://api.mangadex.org/chapter?${query}`, fetchImpl, {
    headers: { 'User-Agent': 'VANTARA/1.0 (release timeline collector; https://github.com/Meshal515/VANTARA)' },
  })).json() as { data?: Array<{ attributes?: { chapter?: string; publishAt?: string }; relationships?: Array<{ id: string; type: string; attributes?: { title?: Record<string, string> } }> }> };
  if (!Array.isArray(body.data)) throw new Error('invalid MangaDex feed');
  const works = new Map<string, Observation>();
  for (const chapter of body.data) {
    const manga = chapter.relationships?.find((r) => r.type === 'manga');
    const titles = manga?.attributes?.title;
    const title = titles?.en ?? titles?.['ja-ro'] ?? Object.values(titles ?? {})[0];
    const number = Number(chapter.attributes?.chapter);
    const publishedAt = Date.parse(chapter.attributes?.publishAt ?? '');
    if (!manga || !title || chapter.attributes?.chapter == null || !Number.isFinite(number) || !Number.isFinite(publishedAt) || publishedAt > now) continue;
    const work = `ext:${normalizeTitle(title)}`;
    const report = works.get(work) ?? { work, section: 'manga', kind: 'chapter', title, source: { s: 'eu.kanade.tachiyomi.extension.all.mangadex@ar', u: `/manga/${manga.id}` }, units: [] };
    report.units.push({ number, publishedAt });
    works.set(work, report);
  }
  // The chapter feed carries no art: one batched lookup of each manga's main cover,
  // so timeline cards show the work instead of its initial. Optional — a failure keeps the chapters.
  const ids = [...new Set([...works.values()].map((w) => w.source.u!.slice('/manga/'.length)))];
  if (ids.length) {
    try {
      const q = ids.map((id) => `ids%5B%5D=${id}`).join('&');
      const covers = await (await request(`https://api.mangadex.org/manga?limit=100&includes%5B%5D=cover_art&contentRating%5B%5D=safe&contentRating%5B%5D=suggestive&contentRating%5B%5D=erotica&${q}`, fetchImpl, {
        headers: { 'User-Agent': 'VANTARA/1.0 (release timeline collector; https://github.com/Meshal515/VANTARA)' },
      })).json() as { data?: Array<{ id: string; attributes?: { tags?: Array<{ attributes?: { name?: { en?: string } } }> }; relationships?: Array<{ type: string; attributes?: { fileName?: string } }> }> };
      const art = new Map((covers.data ?? []).map((m) => [m.id, m.relationships?.find((r) => r.type === 'cover_art')?.attributes?.fileName]));
      // وسوم العمل نفسه: Boys' Love وGirls' Love وأمثالها لا تدخل الخط الزمني
      const adult = new Set((covers.data ?? []).filter((m) => adultGenre((m.attributes?.tags ?? []).map((t) => t.attributes?.name?.en ?? ''))).map((m) => m.id));
      for (const [key, w] of [...works]) {
        const id = w.source.u!.slice('/manga/'.length);
        if (adult.has(id)) { works.delete(key); continue; }
        const file = art.get(id);
        if (file && /^[\w.-]+$/.test(file)) w.cover = `https://uploads.mangadex.org/covers/${id}/${file}.512.jpg`;
      }
    } catch { /* covers are optional */ }
  }
  await observe(env, [...works.values()], now);
  return 0;
}

/** An independently fetched airing catalog and exact ID mappings keep collection running during AniList outages. */
async function animeFallback(env: Env, now: number, fetchImpl: Fetcher, cursor: number) {
  const body = await (await request('https://kitsu.io/api/edge/anime?filter[status]=current&sort=-userCount&page[limit]=20&include=mappings', fetchImpl)).json() as {
    data?: Array<{ id: string; attributes: { canonicalTitle: string; ageRating?: string; posterImage?: { original?: string } }; relationships?: { mappings?: { data?: Array<{ id: string }> } } }>;
    included?: Array<{ id: string; type: string; attributes?: { externalSite?: string; externalId?: string } }>;
  };
  if (!Array.isArray(body.data)) throw new Error('invalid fallback airing catalog');
  const mappings = new Map((body.included ?? []).filter(m => m.type === 'mappings').map(m => [m.id, m.attributes]));
  const all = body.data.filter(m => !['R18', 'R18+'].includes(m.attributes.ageRating ?? ''));
  const rest = all.slice(2);
  const selected = [...all.slice(0, 2), ...Array.from({ length: Math.min(2, rest.length) }, (_, i) => rest[(cursor + i) % rest.length]!)];
  const reports: Observation[] = [];
  let failures = 0;
  for (const m of selected) {
    const mapping = m.relationships?.mappings?.data?.map(x => mappings.get(x.id)).find(x => x?.externalSite === 'anilist/anime');
    if (!mapping?.externalId || !/^\d+$/.test(mapping.externalId)) continue;
    try {
    const data = await (await request(`https://api.ani.zip/mappings?anilist_id=${mapping.externalId}`, fetchImpl)).json() as {
      mappings?: { anilist_id?: number }; episodes?: Record<string, { episodeNumber?: number; absoluteEpisodeNumber?: number; episode?: string; airDateUtc?: string; aired?: string }>;
    };
    if (String(data.mappings?.anilist_id) !== mapping.externalId) throw new Error('fallback ID mismatch');
    const units = Object.values(data.episodes ?? {}).map(e => ({ number: e.absoluteEpisodeNumber ?? (Number(e.episode) || e.episodeNumber), publishedAt: Date.parse(e.airDateUtc ?? e.aired ?? '') }))
      .filter((e): e is { number: number; publishedAt: number } => Number.isFinite(e.number) && e.number! > 0 && e.publishedAt <= now && e.publishedAt >= now - 7 * DAY);
    if (units.length) reports.push({ work: `anime:${mapping.externalId}`, section: 'anime', kind: 'episode', title: m.attributes.canonicalTitle,
      cover: m.attributes.posterImage?.original ?? null, source: { s: 'anizip' }, units });
    } catch { failures++; }
  }
  await observe(env, reports, now);
  if (failures) throw new PartialScan(`${failures} anime episode pages failed`, rest.length ? (cursor + 2) % rest.length : 0);
  return rest.length ? (cursor + 2) % rest.length : 0;
}

async function anime(env: Env, now: number, fetchImpl: Fetcher, cursor: number) {
  try {
  const body = await (await request('https://graphql.anilist.co', fetchImpl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
    query: `query ($from: Int, $to: Int) { Page(perPage: 50) { airingSchedules(airingAt_greater: $from, airingAt_lesser: $to, sort: TIME_DESC) { episode airingAt media { id title { english romaji } isAdult genres coverImage { large } } } } }`,
    variables: { from: Math.floor((now - 7 * DAY) / 1000), to: Math.floor(now / 1000) },
  }) })).json() as { data?: { Page?: { airingSchedules?: Array<{ episode: number; airingAt: number; media?: { id: number; title?: { english?: string; romaji?: string }; isAdult?: boolean; genres?: string[]; coverImage?: { large?: string } } }> } } };
  const schedules = body.data?.Page?.airingSchedules;
  if (!Array.isArray(schedules)) throw new Error('invalid AniList schedule');
  const reports: Observation[] = schedules.filter((s) => s.media && !s.media.isAdult && !adultGenre(s.media.genres) && s.airingAt * 1000 <= now).map((s) => ({
    work: `anime:${s.media!.id}`, section: 'anime', kind: 'episode', title: s.media!.title?.english || s.media!.title?.romaji || String(s.media!.id), cover: s.media!.coverImage?.large ?? null,
    source: { s: 'anilist' }, units: [{ number: s.episode, publishedAt: s.airingAt * 1000 }],
  }));
  await observe(env, reports, now);
  return cursor;
  } catch { return animeFallback(env, now, fetchImpl, cursor); }
}

async function cinema(env: Env, now: number, fetchImpl: Fetcher, cursor: number) {
  const body = await (await request(`${CINEMETA}/catalog/series/lastVideos.json`, fetchImpl)).json() as { metas?: Array<{ id?: string; imdb_id?: string }> };
  if (!Array.isArray(body.metas)) throw new Error('invalid Cinemeta catalog');
  const all = body.metas.map((m) => m.id ?? m.imdb_id).filter((id): id is string => !!id && /^tt\d+$/.test(id));
  const rotated = all.slice(4);
  const ids = [...new Set([...all.slice(0, 4), ...Array.from({ length: Math.min(4, rotated.length) }, (_, i) => rotated[(cursor + i) % rotated.length]!)])];
  const reports: Observation[] = [];
  let failures = 0;
  for (let i = 0; i < ids.length; i += 3) await Promise.all(ids.slice(i, i + 3).map(async (id) => {
    try {
      const data = await (await request(`${CINEMETA}/meta/series/${id}.json`, fetchImpl)).json() as { meta?: { name?: string; poster?: string; videos?: Array<{ season: number; episode: number; released?: string }> } };
      if (!data.meta?.videos) throw new Error('invalid series');
      const units = data.meta.videos.map((v) => ({ season: v.season, number: v.episode, publishedAt: Date.parse(v.released ?? '') }))
        .filter((v) => v.season > 0 && v.number > 0 && v.publishedAt <= now && v.publishedAt >= now - 7 * DAY).sort((a,b) => b.publishedAt - a.publishedAt).slice(0, 40);
      if (units.length) reports.push({ work: `cinema:${id}`, section: 'cinema', kind: 'episode', title: data.meta.name ?? id, cover: data.meta.poster ?? null, source: { s: 'cinemeta' }, units });
    } catch { failures++; }
  }));
  await observe(env, reports, now);
  if (failures) throw new PartialScan(`${failures} series failed`, rotated.length ? (cursor + 4) % rotated.length : 0);
  return rotated.length ? (cursor + 4) % rotated.length : 0;
}

async function movies(env: Env, now: number, fetchImpl: Fetcher) {
  const body = await (await request(`${CINEMETA}/catalog/movie/lastVideos.json`, fetchImpl)).json() as {
    metas?: Array<{ id?: string; name?: string; poster?: string; released?: string }>;
  };
  if (!Array.isArray(body.metas)) throw new Error('invalid movie release catalog');
  const reports = body.metas.filter(m => /^tt\d+$/.test(m.id ?? '') && m.name && m.released && Date.parse(m.released) <= now)
    .sort((a,b) => Date.parse(b.released!) - Date.parse(a.released!)).slice(0, 40)
    .map(m => ({ work: `cinema:${m.id}`, section: 'cinema', kind: 'movie', title: m.name!, cover: m.poster ?? null,
      source: { s: 'cinemeta' }, units: [{ publishedAt: Date.parse(m.released!) }] }));
  await observe(env, reports, now);
  return 0;
}

/** مواقع المانجا العربية بالتناوب: خمسة في دقيقتها (كل دقيقتين)، فيُقرأ كل موقع كل أربع دقائق تقريبًا. */
const SITES_PER_RUN = 5;
async function mangaSites(env: Env, now: number, fetchImpl: Fetcher, cursor: number) {
  const picked = Array.from({ length: Math.min(SITES_PER_RUN, MANGA_SITES.length) }, (_, i) => MANGA_SITES[(cursor + i) % MANGA_SITES.length]!);
  const results = await Promise.allSettled(picked.map((site) => readSite(site, fetchImpl, now)));
  const reports: Observation[] = [];
  const health: unknown[][] = [];
  results.forEach((r, i) => {
    const site = picked[i]!;
    if (r.status === 'fulfilled') {
      for (const w of r.value) { const rep = siteReport(site, w); if (rep) reports.push(rep as Observation); }
      health.push([`site:${site.id}`, now, now, null]);
    } else {
      health.push([`site:${site.id}`, now, 0, String(r.reason instanceof Error ? r.reason.message : r.reason).slice(0, 200)]);
    }
  });
  // دقيقته له وحده: 100 عمل (حدّ التقرير الواحد) بفصلين لكل عمل
  await observe(env, reports, now, 200);
  // حالة كل موقع على حدة: أيها يحجب الخادم ظاهر في collector_state بلا سجلات
  await env.DB.prepare(`INSERT INTO collector_state (source, lease_until, last_attempt_at, last_success_at, last_error) VALUES ${health.map(() => '(?, 0, ?, ?, ?)').join(',')}
    ON CONFLICT(source) DO UPDATE SET last_attempt_at = excluded.last_attempt_at, last_success_at = CASE WHEN excluded.last_success_at > 0 THEN excluded.last_success_at ELSE collector_state.last_success_at END, last_error = excluded.last_error`)
    .bind(...health.flat()).run();
  return (cursor + picked.length) % MANGA_SITES.length;
}

export async function collectTimelines(env: Env, { now = Date.now(), fetchImpl = fetch, scheduled = false }: { now?: number; fetchImpl?: Fetcher; scheduled?: boolean } = {}) {
  const jobs = [['teamx', teamx], ['mangadex-ar', mangaDex], ['manga-sites', mangaSites], ['anilist', anime], ['cinemeta-series', cinema], ['cinemeta-movies', movies]] as const;
  // دقائق متناوبة تحت حدّ D1 المجاني (50 استعلامًا للتشغيل): مواقع المانجا وحدها دقيقةً بعد دقيقة
  const slots = [['teamx', 'mangadex-ar'], ['manga-sites'], ['anilist', 'cinemeta-series', 'cinemeta-movies'], ['manga-sites']];
  const selected = scheduled ? jobs.filter(([source]) => slots[Math.floor(now / 60_000) % slots.length]!.includes(source)) : jobs;
  await Promise.all(selected.map(async ([source, run]) => {
    const claim = await env.DB.prepare(`INSERT INTO collector_state (source, lease_until, last_attempt_at) VALUES (?, ?, ?)
      ON CONFLICT(source) DO UPDATE SET lease_until = excluded.lease_until, last_attempt_at = excluded.last_attempt_at
      WHERE collector_state.lease_until < ?`).bind(source, now + 90_000, now, now).run();
    if (!claim.meta.changes) return;
    const row = await env.DB.prepare('SELECT cursor FROM collector_state WHERE source = ?').bind(source).first<{ cursor: number }>();
    try {
      const cursor = await run(env, now, fetchImpl, row?.cursor ?? 0);
      await env.DB.prepare('UPDATE collector_state SET lease_until = 0, last_success_at = ?, last_error = NULL, cursor = ? WHERE source = ?').bind(now, cursor, source).run();
    } catch (error) {
      const message = String(error instanceof Error ? error.message : error).slice(0, 200);
      await env.DB.prepare('UPDATE collector_state SET lease_until = 0, last_error = ?, cursor = ? WHERE source = ?').bind(message, error instanceof PartialScan ? error.cursor : row?.cursor ?? 0, source).run();
      console.error('timeline collector', source, message);
    }
  }));
}
