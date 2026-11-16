/**
 * مقياس الفهرس الموحد (تجريبي، لا يُفعَّل في الواجهة) على بيانات حقيقية مثبّتة، بلا شبكة:
 *   - أنمي: AniList (الأشهر + شريحة مغمورة + أعضاء سلاسلها: مواسم، أفلام، OVA، إعادة إنتاج) مع ربط ani.zip.
 *   - سينما: Cinemeta (الأعلى أفلامًا ومسلسلات، الرسوم، بطاقات IMDb التي يربطها ani.zip، وأسماء متصادمة).
 *   - مانجا: fixtures/manga-identity-bench.json (1911 عملًا من AniList + MangaDex).
 * الحقيقة المرجعية بالمعرّفات الرسمية وحدها (AniList، IMDb، ani.zip)، لا بالعناوين:
 *   - عملان من قسمين هما عمل واحد فقط إن ربط ani.zip أنمي AniList بـIMDb لا يملكه غيره، والنوع متوافق.
 *   - كل ما عدا ذلك عملان: المانجا وأنميها، والموسم وسلسلته الأم، والفيلم والمسلسل بنفس الاسم.
 * المدخل يُكرَّر كما تكرره الرئيسيات فعلًا (الشائع + البحث + بطاقة MAL فقط + مرجع سينما بصيغتين).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { unifyFeed, unifyWorks } from './unified-identity.js';

const bench = JSON.parse(readFileSync(new URL('./fixtures/unified-identity-bench.json', import.meta.url), 'utf8'));
const { works: manga } = JSON.parse(readFileSync(new URL('./fixtures/manga-identity-bench.json', import.meta.url), 'utf8'));
const anime = bench.a.map(([al, mal, format, year, titles, synonyms, ar, imdb, seasons, rel]) => ({ al, mal, format, year, titles, synonyms, ar, imdb, seasons, rel }));
const cinema = bench.c.map(([t, imdb, name, year, seasons, animation]) => ({ type: t === 'S' ? 'series' : 'movie', imdb, name, year, seasons, animation }));

const SERIES = new Set(['TV', 'TV_SHORT', 'ONA']);
const groupOf = (format) => (format === 'MOVIE' ? 'movie' : SERIES.has(format) ? 'series' : null);
const ownersOf = new Map(); // كل الصيغ: لقياس السلاسل المقسّمة
const ownersBy = new Map(); // `${group}:${imdb}`
for (const a of anime) if (a.imdb) {
  ownersOf.set(a.imdb, (ownersOf.get(a.imdb) ?? 0) + 1);
  if (groupOf(a.format)) ownersBy.set(`${groupOf(a.format)}:${a.imdb}`, (ownersBy.get(`${groupOf(a.format)}:${a.imdb}`) ?? 0) + 1);
}
const zipOf = new Map(anime.map((a) => [a.al, a]));
const cineSeasons = new Map(cinema.filter((c) => c.type === 'series').map((c) => [c.imdb, c.seasons]));
export const options = {
  imdbOfAnilist: (al) => { const a = zipOf.get(al); return a?.imdb ? { imdb: a.imdb, seasons: a.seasons } : null; },
  seasonsOfImdb: (tt) => cineSeasons.get(tt) ?? null,
  animeOfImdb: (tt, group) => ownersBy.get(`${group}:${tt}`) ?? 0,
};

/** الحقيقة: مفتاح العمل لكل عنصر. */
function truthOf(it) {
  if (it.section === 'manga') return `manga:${it.ids.anilist}`;
  // MAL يقسمه AniList أحيانًا عملين (مثال حقيقي: MAL 24151 ← AniList 20837 و20900): بطاقة MAL وحدها عندئذ مجهولة
  if (it.section === 'anime') return it.ids.anilist ? `anime:${it.ids.anilist}` : malToAl.has(it.ids.mal) ? `anime:${malToAl.get(it.ids.mal)}` : `anime-mal:${it.ids.mal}`;
  const kind = it.kind;
  // الحقيقة: بطاقة السينما هي عمل AniList الوحيد بصيغتها تحت IMDb نفسه، والمسلسل يغطي كل مواسمه
  const a = anime.find((x) => x.imdb === it.ids.imdb && groupOf(x.format) === kind && ownersBy.get(`${kind}:${x.imdb}`) === 1);
  if (a && kind === 'movie') return `anime:${a.al}`;
  const total = cineSeasons.get(it.ids.imdb);
  if (a && kind === 'series' && total > 0 && a.seasons.includes(1) && a.seasons.length >= total) return `anime:${a.al}`;
  return `cinema:${kind}:${it.ids.imdb}`;
}
const malCount = new Map();
for (const a of anime) if (a.mal) malCount.set(a.mal, (malCount.get(a.mal) ?? 0) + 1);
const malToAl = new Map(anime.filter((a) => a.mal && malCount.get(a.mal) === 1).map((a) => [a.mal, a.al]));

function feed() {
  const items = [];
  for (const w of manga) items.push({ section: 'manga', id: `ext:${(w.t[0] ?? w.t[1]).toLowerCase()}`, ids: { anilist: w.al } });
  for (const a of anime) items.push({ section: 'anime', id: `anime:${a.al}`, kind: a.format, ids: { anilist: a.al, mal: a.mal ?? undefined } });
  for (const c of cinema) items.push({ section: 'cinema', id: c.imdb, kind: c.type, ids: { imdb: c.imdb } });
  // التكرار كما يصل فعلًا: الشائع ثم البحث، وبطاقة بمعرّف MAL وحده، ومرجع سينما بصيغة «cinema:tt»
  for (const a of anime.filter((_, i) => i % 3 === 0)) items.push({ section: 'anime', id: `anime:${a.al}`, kind: a.format });
  for (const a of anime.filter((a, i) => i % 5 === 1 && a.mal)) items.push({ section: 'anime', id: `mal:${a.mal}`, kind: a.format, ids: { mal: a.mal } });
  for (const c of cinema.filter((_, i) => i % 4 === 0)) items.push({ section: 'cinema', id: `cinema:${c.imdb}`, kind: c.type });
  for (const w of manga.filter((_, i) => i % 4 === 0)) items.push({ section: 'manga', id: `ext:${(w.t[0] ?? w.t[1]).toLowerCase()}`, ids: { anilist: w.al } });
  return items;
}
const withTruth = (it) => ({ ...it, ids: { ...it.ids, ...(it.section === 'cinema' ? { imdb: it.ids?.imdb ?? it.id.replace(/^cinema:/, '') } : {}), ...(it.section === 'anime' && !it.ids?.anilist && !it.ids?.mal ? { anilist: Number(it.id.replace(/^anime:/, '')) } : {}) } });

export function measure(groups) {
  const groupsOf = new Map();
  const m = { groups: groups.length, works: 0, duplicates: 0, wrong: [], mixed: [], correctCross: 0, expectedCross: 0, missedCross: [], badLabel: [] };
  groups.forEach((g, gi) => {
    const truths = new Set(g.sources.map((s) => truthOf(withTruth(s.item))));
    const sections = new Set(g.sources.map((s) => s.section));
    if (truths.size > 1) m.wrong.push(g.sources.map((s) => `${s.section}:${s.id}:${s.kind}`));
    if (sections.has('manga') && sections.size > 1) m.mixed.push(g.sources.map((s) => s.id));
    const kinds = new Set(g.sources.map((s) => (s.section === 'cinema' ? s.kind : s.section === 'anime' ? (s.kind === 'MOVIE' ? 'movie' : SERIES.has(s.kind) ? 'series' : s.kind) : 'manga')));
    if (kinds.size > 1) m.mixed.push(g.sources.map((s) => `${s.id}:${s.kind}`));
    if (sections.has('anime') && g.section !== 'anime') m.badLabel.push(g.id);
    for (const t of truths) (groupsOf.get(t) ?? groupsOf.set(t, new Set()).get(t)).add(gi);
    if (sections.has('anime') && sections.has('cinema') && truths.size === 1) m.correctCross++;
  });
  m.works = groupsOf.size;
  for (const set of groupsOf.values()) if (set.size > 1) m.duplicates++;
  // الدمج العابر المتوقع: بطاقة سينما حقيقتها عمل أنمي
  for (const c of cinema) {
    const t = truthOf({ section: 'cinema', kind: c.type, ids: { imdb: c.imdb } });
    if (!t.startsWith('anime:')) continue;
    m.expectedCross++;
    if ((groupsOf.get(t)?.size ?? 0) > 1) m.missedCross.push(`${c.imdb}→${t}`);
  }
  return m;
}

describe('unified identity benchmark (AniList + ani.zip + Cinemeta + MangaDex, pinned)', () => {
  const items = feed();

  it('the fixture is diverse and large per section', () => {
    expect(anime.length).toBeGreaterThan(2000);
    expect(cinema.length).toBeGreaterThan(2000);
    expect(manga.length).toBeGreaterThan(1500);
    const formats = new Set(anime.map((a) => a.format));
    for (const f of ['TV', 'MOVIE', 'OVA', 'ONA', 'SPECIAL']) expect(formats.has(f)).toBe(true);
    expect([...ownersOf.values()].filter((n) => n > 1).length).toBeGreaterThan(50); // سلاسل مواسمها تحت IMDb واحد
    expect(cinema.filter((c) => c.type === 'series').length).toBeGreaterThan(500);
  });

  it('zero wrong merges, zero forbidden mixing, zero duplicates, anime keeps the label', () => {
    const t0 = performance.now();
    const groups = unifyWorks(items, options);
    const ms = performance.now() - t0;
    const m = measure(groups);
    console.log(`[unified-bench] items=${items.length} groups=${m.groups} works=${m.works} duplicates=${m.duplicates} cross ${m.correctCross} (expected ${m.expectedCross}, missed ${m.missedCross.length}) wrong=${m.wrong.length} mixed=${m.mixed.length} ${Math.round(ms)}ms`);
    expect(m.wrong.slice(0, 5)).toEqual([]);
    expect(m.mixed.slice(0, 5)).toEqual([]);
    expect(m.badLabel).toEqual([]);
    expect(m.duplicates).toBe(0);
    expect(m.missedCross).toEqual([]);
    expect(m.correctCross).toBeGreaterThan(100);
    expect(ms).toBeLessThan(1500);
    // انحدار حقيقي: MAL المشترك بين عملين في AniList كان يجمعهما في بطاقة واحدة
    expect([...malCount.values()].some((n) => n > 1)).toBe(true);
  });

  it('a season never merges with its parent series card, and manga never with its anime', () => {
    const groups = unifyWorks(items, options);
    const multi = new Set(anime.filter((a) => groupOf(a.format) === 'series' && ownersBy.get(`series:${a.imdb}`) > 1).map((a) => `anime:${a.al}`));
    for (const g of groups) {
      if (g.sources.some((s) => multi.has(s.id))) expect(g.sources.every((s) => s.section === 'anime')).toBe(true);
    }
    const adapted = new Set(anime.flatMap((a) => a.rel.filter(([, r, t]) => t === 'M' && (r === 'SOURCE' || r === 'ADAPTATION')).map(([id]) => id)));
    const overlap = manga.filter((w) => adapted.has(w.al)).length;
    expect(overlap).toBeGreaterThan(100);
    for (const g of groups) if (g.sources.some((s) => s.section === 'manga')) expect(new Set(g.sources.map((s) => s.section))).toEqual(new Set(['manga']));
  });

  it('hard sample (300+ pairs): look-alikes stay apart unless the official ids link them', () => {
    const groups = unifyWorks(items, options);
    const where = new Map();
    groups.forEach((g, i) => { for (const s of g.sources) where.set(`${s.section}|${String(s.id).replace(/^cinema:/, '')}|${s.section === 'cinema' ? s.kind : ''}`, i); });
    const at = (section, id, kind = '') => where.get(`${section}|${id}|${kind}`);
    const norm = (t) => String(t ?? '').toLowerCase().replace(/&quot;|[^a-z0-9]+/g, ' ').trim();
    const pairs = { cinemaNamesakes: 0, splitSeasons: 0, mangaVsAnime: 0, animeVsLiveAction: 0 };
    const bad = [];
    const apart = (kind, a, b, label) => { pairs[kind]++; if (a === undefined || b === undefined || a === b) bad.push(label); };
    // 1. السينما: فيلم ومسلسل بالاسم نفسه، وإعادة إنتاج بسنة أخرى (Dune 1984 / 2021 / 2000، Psycho ×3)
    const byName = new Map();
    for (const c of cinema) (byName.get(norm(c.name)) ?? byName.set(norm(c.name), []).get(norm(c.name))).push(c);
    for (const list of byName.values()) for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const [x, y] = [list[i], list[j]];
      const tx = truthOf({ section: 'cinema', kind: x.type, ids: { imdb: x.imdb } });
      const ty = truthOf({ section: 'cinema', kind: y.type, ids: { imdb: y.imdb } });
      if (tx !== ty) apart('cinemaNamesakes', at('cinema', x.imdb, x.type), at('cinema', y.imdb, y.type), `${x.name} ${x.year} / ${y.year}`);
    }
    // 2. مواسم AniList المنفصلة تحت IMDb واحد (Shingeki no Kyojin ×7، Gintama ×4): كل موسم عمل
    const bySeriesImdb = new Map();
    for (const a of anime) if (a.imdb && ownersBy.get(`series:${a.imdb}`) > 1 && groupOf(a.format) === 'series') (bySeriesImdb.get(a.imdb) ?? bySeriesImdb.set(a.imdb, []).get(a.imdb)).push(a);
    for (const list of bySeriesImdb.values()) for (let i = 1; i < list.length; i++) apart('splitSeasons', at('anime', `anime:${list[0].al}`), at('anime', `anime:${list[i].al}`), `${list[0].titles[1]} / ${list[i].titles[1]}`);
    // 3. المانجا وأنميها (مصدر/اقتباس رسمي في AniList)
    const mangaIds = new Map(manga.map((w) => [w.al, `ext:${(w.t[0] ?? w.t[1]).toLowerCase()}`]));
    for (const a of anime) for (const [id, rel, type] of a.rel) if (type === 'M' && (rel === 'SOURCE' || rel === 'ADAPTATION') && mangaIds.has(id)) apart('mangaVsAnime', at('manga', mangaIds.get(id)), at('anime', `anime:${a.al}`), `${a.titles[1]}`);
    // 4. أنمي وعمل سينمائي بالاسم نفسه بلا ربط IMDb (فيلم حي، إعادة إنتاج غربية)
    for (const a of anime) for (const t of new Set([norm(a.titles[0]), norm(a.titles[1])])) for (const c of byName.get(t) ?? []) {
      if (truthOf({ section: 'cinema', kind: c.type, ids: { imdb: c.imdb } }) !== `anime:${a.al}`) apart('animeVsLiveAction', at('anime', `anime:${a.al}`), at('cinema', c.imdb, c.type), `${a.titles[1]} / ${c.name} ${c.year} ${c.type}`);
    }
    const total = Object.values(pairs).reduce((x, y) => x + y, 0);
    console.log(`[unified-bench] hard pairs=${total} ${JSON.stringify(pairs)} merged=${bad.length}`);
    expect(total).toBeGreaterThan(300);
    expect(bad.slice(0, 10)).toEqual([]);
  });

  it('linear: doubling the input roughly doubles the time, and the result is independent of order', () => {
    const big = [...items, ...items.map((it) => ({ ...it }))];
    const t1 = performance.now(); unifyWorks(items, options); const a = performance.now() - t1;
    const t2 = performance.now(); unifyWorks(big, options); const b = performance.now() - t2;
    expect(b).toBeLessThan(a * 4 + 50);
    const rev = unifyWorks([...items].reverse(), options);
    expect(rev.length).toBe(unifyWorks(items, options).length);
  });

  it('unifyFeed is the documented entry point', () => {
    expect(unifyFeed(items, options).length).toBe(unifyWorks(items, options).length);
    expect(unifyFeed([])).toEqual([]);
  });
});
