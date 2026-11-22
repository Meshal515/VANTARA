/**
 * مقياس البحث (بلاغ المالك 22 نوفمبر: «تكتب أي اسم بأي لغة أو فواصل وتطلع بطاقة وحدة»): ربع أعمال مقياس الهوية
 * (1911 عملًا حقيقيًا من AniList وMangaDex) يُبحث عن كل منها بكل أسمائه: الإنجليزي، الروماجي، الياباني، العربي،
 * اسم بديل، وبعلامات ومسافات مختلفة. المصادر محاكاة بحث نصي كما في المواقع، وMangaDex مختلط لا يُبحث فيه
 * (سياسة المصادر). AniList محاكى من البيانات نفسها: عمل واحد بالاسم بالضبط أو لا شيء.
 * قبل توسيع الاسم: الياباني 6.7% والبديل 10.8%.
 */
import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
const store = vi.hoisted(() => ({ works: new Map(), kv: new Map() }));
vi.mock('../lib/extension-engine.js', () => ({ default: { isAvailable: () => true, sources: vi.fn(), search: vi.fn(), chapters: vi.fn(), series: vi.fn(), catalogue: vi.fn(), latest: vi.fn(), prepare: vi.fn(), onSourcesChanged: () => () => {} } }));
vi.mock('../lib/chapter-store.js', () => ({ readWork: vi.fn(async (id) => store.works.get(id) ?? null), writeWork: vi.fn(async (id, v) => { store.works.set(id, v); }), readKv: vi.fn(async () => null), writeKv: vi.fn(async () => {}) }));
const AL = vi.hoisted(() => ({ owners: null }));
vi.mock('../lib/manga-meta.js', async (orig) => ({ ...(await orig()), fetchMangaMatches: vi.fn(async (titles) => {
  const { normalizeTitle } = await import('../lib/catalog.js');
  return new Map(titles.map((t) => { const hit = AL.owners.get(normalizeTitle(t)); return [t, hit && hit.size === 1 ? { identity: { id: [...hit][0].al, names: [...[...hit][0].t, ...([...hit][0].s ?? [])].filter(Boolean) }, verdict: 'clean' } : { identity: null, verdict: 'unknown' }]; }));
}) }));
import engine from '../lib/extension-engine.js';
import { normalizeTitle } from '../lib/catalog.js';
import { simulate } from '../lib/fixtures/manga-identity-sim.js';
import { browse, resetSources } from './works.js';
const { works } = JSON.parse(readFileSync(new URL('../lib/fixtures/manga-identity-bench.json', import.meta.url), 'utf8'));
const compact = (t) => normalizeTitle(t).replace(/ /g, '');
it('any name of a real work, in any script or punctuation, finds it first, as one card and never merged with another', async () => {
  vi.stubGlobal('fetch', async () => ({ ok: false, json: async () => ({}) }));
  AL.owners = new Map();
  for (const w of works) for (const n of new Set([...w.t, ...(w.s ?? [])].filter(Boolean).map(normalizeTitle))) (AL.owners.get(n) ?? AL.owners.set(n, new Set()).get(n)).add(w);
  const { entries } = simulate(works, 'anchor-full');
  const cat = new Map();
  for (const e of entries) (cat.get(e.sourceId) ?? cat.set(e.sourceId, []).get(e.sourceId)).push({ ...e.manga, al: e.al });
  engine.sources.mockResolvedValue([...cat.keys()].map((id) => ({ id, label: id.split('.').pop(), lang: 'ar', warning: id.includes('mangadex') ? 'MIXED' : 'SAFE' })));
  engine.search.mockImplementation(async (id, q) => {
    const c = compact(q); if (!c) return { mangas: [] };
    return { mangas: cat.get(id).filter((m) => [m.title, ...(m.altNames ?? [])].some((n) => compact(n).includes(c))).slice(0, 30), hasNextPage: false };
  });
  resetSources();
  const byAl = new Map(works.map((w) => [w.al, w]));
  const searchableTitles = new Map();
  for (const e of entries) if (!e.sourceId.includes('mangadex')) (searchableTitles.get(e.al) ?? searchableTitles.set(e.al, []).get(e.al)).push(e.manga.title);
  const stats = {}; const fails = {};
  const bump = (k, kind, ex) => { stats[kind] ??= { q: 0, found: 0, top1: 0, top3: 0, dupCards: 0, wrong: 0 }; stats[kind][k]++; if (ex && (fails[kind+k] ??= []).length < 6) fails[kind+k].push(ex); };
  const sample = works.filter((w, i) => i % 4 === 0);
  for (const w of sample) {
    const [en, romaji, native] = w.t;
    const ar = w.d?.a?.ar?.[0];
    const qs = [['en', en], ['romaji', romaji], ['native', native], ['arabic', ar], ['en-punct', en && en.replace(/ /g, '  ').replace(/'/g, '’') + '!'], ['en-lower-nospace', en && en.toLowerCase().replace(/[^a-z0-9]/g, '')], ['synonym', w.s?.[0]]];
    for (const [kind, q] of qs) {
      if (!q) continue;
      bump('q', kind);
      const { items } = await browse({ query: q });
      const cardsWith = items.map((c, i) => ({ i, als: new Set(c._work.editions.map((e) => e.manga.al ?? -1)) })).filter((c) => c.als.has(w.al));
      if (!cardsWith.length) { bump('found', kind); stats[kind].found--; bump('miss', kind, `${q} | ${w.t[0]}`); stats[kind].miss = (stats[kind].miss ?? 0); continue; }
      stats[kind].found++;
      if (cardsWith[0].i === 0) stats[kind].top1++; else if (fails[kind+'notTop'] === undefined || fails[kind+'notTop'].length < 6) (fails[kind+'notTop'] ??= []).push(`${q} -> top: ${items[0]?.title?.english ?? items[0]?.title} (rank ${cardsWith[0].i})`);
      if (cardsWith[0].i < 3) stats[kind].top3++;
      if (cardsWith.length > 1) bump('dupCards', kind, `${q} x${cardsWith.length}`);
      // دمج خاطئ: البطاقة التي فيها العمل تحمل عملًا آخر لا يشاركه أي اسم
      const namesOf = (al) => new Set([...(byAl.get(al)?.t ?? []), ...(byAl.get(al)?.s ?? [])].filter(Boolean).map(normalizeTitle));
      const own = namesOf(w.al);
      for (const c of cardsWith) for (const other of c.als) if (other !== w.al && ![...namesOf(other)].some((n) => own.has(n))) bump('wrong', kind, `${q} + ${byAl.get(other)?.t?.[0]}`);
    }
  }
  console.log('[search-bench]', JSON.stringify(stats));
  // الحدود = القياس عند التثبيت (22 نوفمبر). تحسين يرفعها؛ تراجع يكسر الاختبار
  const FLOOR = { en: 294, romaji: 477, native: 453, 'en-punct': 294, 'en-lower-nospace': 291, synonym: 367, arabic: 30 };
  for (const [kind, min] of Object.entries(FLOOR)) expect(stats[kind].top1, kind).toBeGreaterThanOrEqual(min);
  for (const kind of Object.keys(FLOOR)) expect(stats[kind].wrong ?? 0, kind).toBe(0);
  expect(Object.values(stats).reduce((n, x) => n + (x.dupCards ?? 0), 0)).toBeLessThanOrEqual(42);
}, 600000);
