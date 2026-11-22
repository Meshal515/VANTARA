/**
 * الخطة ب على المسار كاملًا: القائمة ← فتح كل عمل (البحث في كل المصادر، والتحقق من صفحات التفاصيل، والربط في الهوية)
 * ← القائمة من جديد. على بيانات حقيقية مثبّتة (manga-identity-bench.json: 1911 عملًا من AniList وMangaDex، بتتماتها
 * وأجزائها الجانبية ونسخها البديلة). الحقيقة الأرضية معرّف AniList، ولا تُعطى للتطبيق.
 *
 * المصادر كما في مقياس الهوية (fixtures/manga-identity-sim.js)، ومعها ما لا تحاكيه القائمة وحدها:
 *  - **بحث** كبحث المواقع: كل نسخة يحوي عنوانها أو أسماؤها في صفحتها كلمات السؤال كلها، والأقرب أولًا.
 *  - **صفحة تفاصيل**: teamx أسماء AniList، وmangadex أسماؤه كلها، وmangatime (العربي) الاسم الإنجليزي والروماجي في
 *    ثلثي الأعمال فقط (كقوالب Madara)، وmanga3asq بلا أسماء.
 *
 * الشروط الثلاثة (قرار المالك 21 نوفمبر): دمج خاطئ 0، والتكرار ينزل ولا يصعد، وكل مصدر عنده العمل في صفحته.
 */
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({ works: new Map(), kv: new Map() }));
vi.mock('../lib/extension-engine.js', () => ({ default: { isAvailable: () => true, sources: vi.fn(), search: vi.fn(), chapters: vi.fn(), series: vi.fn(), catalogue: vi.fn(), latest: vi.fn(), prepare: vi.fn(), onSourcesChanged: () => () => {} } }));
vi.mock('../lib/chapter-store.js', () => ({
  readWork: vi.fn(async (id) => store.works.get(id) ?? null),
  writeWork: vi.fn(async (id, value) => { store.works.set(id, { ...value, at: Date.now() }); }),
  readKv: vi.fn(async (k) => store.kv.get(k) ?? null),
  writeKv: vi.fn(async (k, v) => { store.kv.set(k, { value: v }); }),
}));

import engine from '../lib/extension-engine.js';
import { normalizeTitle } from '../lib/catalog.js';
import { simulate, measure } from '../lib/fixtures/manga-identity-sim.js';
import { learnAliases, noteOfficialIds } from '../lib/manga-alias-store.js';
import { browse, browseLive, loadWork, resetSources, setSharedLatest } from './works.js';
import { createSourceLatest } from './source-latest.js';

const { works } = JSON.parse(readFileSync(new URL('../lib/fixtures/manga-identity-bench.json', import.meta.url), 'utf8'));
const byAl = new Map(works.map((w) => [w.al, w]));
const words = (t) => normalizeTitle(t).split(' ').filter(Boolean);

function sourcesModel() {
  const { entries, aliases, officialIds } = simulate(works, 'ids');
  const catalog = new Map();
  for (const e of entries) {
    const w = byAl.get(e.al);
    const [en, romaji, native] = w.t;
    const slug = e.label;
    // صفحة التفاصيل كما تقولها المصادر فعلًا
    let detail = [];
    if (slug === 'ar.teamx') detail = [romaji, native, ...(w.s ?? [])];
    if (slug === 'all.mangadex') detail = e.manga.altNames ?? [];
    if (slug === 'ar.mangatime' && w.al % 3 !== 0) detail = [en, romaji];
    const manga = { ...e.manga, al: e.al };
    const names = [e.manga.title, ...detail].filter((n) => typeof n === 'string' && n.trim());
    const list = catalog.get(e.sourceId) ?? catalog.set(e.sourceId, { all: [], byWord: new Map() }).get(e.sourceId);
    const item = { manga, detail: detail.filter(Boolean), keys: names.map((n) => new Set(words(n))) };
    list.all.push(item);
    for (const w of new Set(names.flatMap(words))) (list.byWord.get(w) ?? list.byWord.set(w, new Set()).get(w)).add(item);
  }
  return { catalog, aliases, officialIds };
}

const truthCard = (card) => ({ editions: card._work.editions.map((e) => ({ al: e.manga.al, manga: e.manga })) });

describe('البطاقة العامة مع مصادر مثبّتة من مستودع', () => {
  const mangalek = 'eu.kanade.tachiyomi.extension.ar.mangalek';
  const million = 'eu.kanade.tachiyomi.extension.all.mangamillion#8929911308540155494';
  const hizo = 'eu.kanade.tachiyomi.extension.ar.hizomanga#4177563748162518441';
  const workTitle = 'Spy x Family';
  const listing = (sourceId) => ({ mangas: [{ title: workTitle, url: { [mangalek]: '/manga/spy-x-family', [million]: '/title/8173', [hizo]: '/series/42' }[sourceId] }], hasNextPage: false, page: 1 });
  const chapters = (manga) => [{ url: `${manga.url}/1`, chapterNumber: 1, name: '1' }];

  function device({ coldMs = 21_000, snapshot = [mangalek] } = {}) {
    resetSources();
    store.works.clear();
    engine.sources.mockResolvedValue([
      { id: mangalek, lang: 'ar', label: 'مانجا ليك', ready: true },
      { id: million, lang: 'all', label: 'Manga Million', ready: false, user: true, filler: true, warning: 'SAFE' },
      { id: hizo, lang: 'ar', label: 'Hizo Manga', ready: true, user: true, warning: 'SAFE' },
    ]);
    // محرك أندرويد ينتظر فك الحزمة في أول طلب، أيًا كانت العملية التي طلبتها.
    const ready = new Promise((resolve) => setTimeout(resolve, coldMs));
    const cold = async (id) => { if (id === million) await ready; };
    engine.prepare.mockImplementation(cold);
    engine.latest.mockImplementation(async (id) => { await cold(id); return listing(id); });
    engine.search.mockImplementation(async (id) => { await cold(id); return listing(id); });
    engine.series.mockImplementation(async (id, manga) => { await cold(id); return { manga, chapters: chapters(manga) }; });
    engine.chapters.mockImplementation(async (id, manga) => { await cold(id); return chapters(manga); });
    setSharedLatest(createSourceLatest({
      latestSnapshots: async () => ({ sources: snapshot.map((sourceId) => ({ sourceId, value: listing(sourceId), fetchedAt: Date.now() })) }),
      claimLatest: async () => { throw new Error('http_400'); },
    }));
  }

  async function runOnColdDevice(test, options) {
    vi.useFakeTimers();
    try {
      device(options);
      await test();
    } finally {
      setSharedLatest(null);
      resetSources();
      store.works.clear();
      vi.useRealTimers();
    }
  }

  it('يضم الإضافة الباردة إلى بطاقة آخر التحديثات نفسها حتى حين يرفض خادم اللقطة معرّفها', async () => {
    await runOnColdDevice(async () => {
      const latest = browseLive({ kind: 'latestListing' }, () => {}, { concurrency: 3 });
      await vi.advanceTimersByTimeAsync(50_000);
      const { items } = await latest;
      expect(items.map((card) => card.title.english)).toEqual([workTitle]);
      // قرار المالك (22 نوفمبر): الإضافة الأجنبية لا تبني «آخر التحديثات»، وتنضم للبطاقة العامة حين تُفتح
      expect(items[0]._work.editions.map((edition) => edition.sourceId)).toEqual([mangalek, hizo]);
      const opened = loadWork(items[0]);
      await vi.advanceTimersByTimeAsync(50_000);
      expect((await opened)._sources.map((source) => source.sourceId)).toEqual([mangalek, hizo, million]);
    });
  });

  it('تبحث البطاقة العامة عن الإضافة غير المدرجة في آخر التحديثات وتضم فصولها', async () => {
    await runOnColdDevice(async () => {
      const work = loadWork({ id: 'ext:spy x family', title: { english: workTitle }, _work: { key: 'spy x family', title: workTitle, editions: [{ sourceId: mangalek, label: 'مانجا ليك', manga: listing(mangalek).mangas[0] }] } });
      await vi.advanceTimersByTimeAsync(50_000);
      const full = await work;
      expect(full._sources.map((source) => [source.sourceId, source.count])).toEqual([[mangalek, 1], [hizo, 1], [million, 1]]);
    });
  });

  it('يقرأ فصول الإضافة التي جاءت نسختها من اللقطة قبل اكتمال تحميلها على الجهاز', async () => {
    await runOnColdDevice(async () => {
      const { items } = await browseLive({ kind: 'latestListing' });
      // لقطة الإضافة الأجنبية لا تبني القائمة (قرار المالك، 22 نوفمبر)، وفصولها تصل حين تُفتح البطاقة
      expect(items[0]._work.editions.map((edition) => edition.sourceId)).not.toContain(million);
      const work = loadWork(items[0]);
      await vi.advanceTimersByTimeAsync(50_000);
      expect((await work)._sources.map((source) => [source.sourceId, source.count])).toEqual([[mangalek, 1], [hizo, 1], [million, 1]]);
    }, { coldMs: 35_000, snapshot: [mangalek, million, hizo] });
  });
});

describe('plan B, end to end on 1911 real works', () => {
  let model;
  let first;
  let second;
  let detailCalls = 0;
  const pages = [];
  beforeAll(async () => {
    // بلا شبكة حقيقية في المقياس: أسئلة MangaDex (الأسماء العربية) تردّ «لا شيء» فورًا
    vi.stubGlobal('fetch', async () => ({ ok: false, json: async () => ({}) }));
    model = sourcesModel();
    const ids = [...model.catalog.keys()];
    // المحاكاة تعامل كل مصادرها (ومنها MangaDex) مصادر عربية آمنة: المقياس للهوية وحدها، لا لسياسة المصادر
    engine.sources.mockResolvedValue(ids.map((id) => ({ id, label: id.split('.').pop(), lang: 'ar', warning: 'SAFE' })));
    engine.catalogue.mockImplementation(async (id, page) => ({ mangas: page === 1 ? model.catalog.get(id).all.map((x) => x.manga) : [], hasNextPage: false }));
    engine.search.mockImplementation(async (id, query) => {
      const src = model.catalog.get(id);
      const q = words(query);
      if (!q.length) return { mangas: [] };
      let hits = null;
      for (const w of q) {
        const set = src.byWord.get(w) ?? new Set();
        hits = hits ? new Set([...hits].filter((x) => set.has(x))) : new Set(set);
      }
      const qs = q.join(' ');
      const ranked = [...hits].sort((a, b) => Number(normalizeTitle(b.manga.title) === qs) - Number(normalizeTitle(a.manga.title) === qs) || a.manga.title.length - b.manga.title.length);
      return { mangas: ranked.slice(0, 10).map((x) => x.manga), hasNextPage: false };
    });
    const find = (id, manga) => model.catalog.get(id).all.find((x) => x.manga.url === manga.url);
    engine.series.mockImplementation(async (id, manga) => {
      const item = find(id, manga);
      return { manga: { title: item?.manga.title ?? manga.title, altNames: item?.detail ?? [] }, chapters: [{ url: `${manga.url}/1`, chapterNumber: 1, name: '1' }] };
    });
    engine.chapters.mockImplementation(async (_id, manga) => [{ url: `${manga.url}/1`, chapterNumber: 1, name: '1' }]);
    // ما يعرفه الجهاز كما في مقياس «ids»: أسماء صفحات teamx، والمعرّفات الرسمية المؤكدة
    for (const [key, names] of model.aliases) learnAliases(key, names);
    noteOfficialIds([...model.officialIds]);
    resetSources();

    first = (await browse({ kind: 'catalogue' })).items;
    for (const card of first) {
      const full = await loadWork(card);
      pages.push({ card, full });
    }
    resetSources();
    detailCalls = engine.series.mock.calls.length;
    second = (await browse({ kind: 'catalogue' })).items;
  }, 300_000);

  it('zero wrong merges in the listing, before and after every work was opened', () => {
    const a = measure(first.map(truthCard), works);
    const b = measure(second.map(truthCard), works);
    console.log(`[pipeline] listing before: cards=${a.cards} duplicates=${a.duplicates} wrong=${a.wrongPairs.filter((p) => !p.homonym).length} homonyms=${a.homonymPairs}`);
    console.log(`[pipeline] listing after:  cards=${b.cards} duplicates=${b.duplicates} wrong=${b.wrongPairs.filter((p) => !p.homonym).length} homonyms=${b.homonymPairs}`);
    expect(a.wrongPairs.filter((p) => !p.homonym)).toEqual([]);
    expect(b.wrongPairs.filter((p) => !p.homonym)).toEqual([]);
    expect(b.homonymPairs).toBeLessThanOrEqual(a.homonymPairs);
    // التكرار: الهوية تتذكر ما رُبط في صفحات الأعمال، فينزل ولا يصعد. الحد = القياس عند تثبيت الخطة ب (21 نوفمبر):
    // 99 ← 40، منها 36 «متجانسات» (عمل آخر بالاسم نفسه حرفيًا، غالبًا فصل تجريبي باسم السلسلة الروماجي) و3 تقسيم
    // MangaDex غير تقسيم AniList (مجموعة قصص لمجلدين). تحسين يخفضها؛ تراجع يكسر الاختبار
    expect(b.duplicates).toBeLessThan(a.duplicates);
    expect(b.duplicates).toBeLessThanOrEqual(40);
    expect(b.cards).toBeLessThan(a.cards);
    // والمكرر الذي سببه نقص الأدلة (لا اسم مشترك مع عمل آخر) لا يزيد على الثلاث
    const titlesByAl = new Map();
    for (const src of model.catalog.values()) for (const x of src.all) (titlesByAl.get(x.manga.al) ?? titlesByAl.set(x.manga.al, new Set()).get(x.manga.al)).add(normalizeTitle(x.manga.title));
    const owners = new Map();
    for (const [al, set] of titlesByAl) for (const t of set) (owners.get(t) ?? owners.set(t, new Set()).get(t)).add(al);
    const byEvidence = b.missedWorks.filter((mw) => ![...titlesByAl.get(mw.al)].some((t) => owners.get(t).size > 1));
    console.log(`[pipeline] remaining duplicate works=${b.missedWorks.length}: same-name with another work=${b.missedWorks.length - byEvidence.length}, missing evidence=${byEvidence.length}`);
    expect(byEvidence.length).toBeLessThanOrEqual(3);
  });

  it('zero wrong editions in any work page, and every source that has the work is found', () => {
    let wrong = 0;
    let homonyms = 0;
    let expected = 0;
    let found = 0;
    const misses = new Map();
    const wrongs = [];
    for (const { card, full } of pages) {
      const als = card._work.editions.map((e) => e.manga.al);
      const main = als.sort((x, y) => als.filter((v) => v === y).length - als.filter((v) => v === x).length)[0];
      // «متجانسات» كما في مقياس الهوية: عملان باسم واحد بعد التطبيع (عنوان أو روماجي أو أصلي) لا يفرّقهما الاسم أصلًا،
      // فيُعدّان وحدهما ولا يُسمح بزيادتهما
      const namesOf = (al) => new Set([...(byAl.get(al)?.t ?? []), ...[...model.catalog.values()].flatMap((src) => src.all.filter((x) => x.manga.al === al).map((x) => x.manga.title))].filter(Boolean).map(normalizeTitle));
      const keys = namesOf(main);
      for (const e of full._editions ?? []) {
        if (e.manga.al !== main && [...namesOf(e.manga.al)].some((n) => keys.has(n))) { homonyms++; continue; }
        if (e.manga.al !== main && !keys.has(normalizeTitle(e.manga.title))) { wrong++; wrongs.push({ work: byAl.get(main)?.t, got: `${e.sourceId.split('.').pop()}:${e.manga.title}`, evidence: e.evidence }); }
      }
      const has = new Set((full._editions ?? []).filter((e) => e.manga.al === main).map((e) => e.sourceId));
      for (const [sid, src] of model.catalog) {
        if (!src.all.some((x) => x.manga.al === main)) continue;
        expected++;
        if (has.has(sid)) found++;
        else misses.set(sid.split('.').pop(), (misses.get(sid.split('.').pop()) ?? 0) + 1);
      }
    }
    console.log(`[pipeline] work pages=${pages.length} wrong editions=${wrong} homonym editions=${homonyms} sources found ${found}/${expected} (${((found / expected) * 100).toFixed(1)}%) missed by source: ${JSON.stringify(Object.fromEntries(misses))}`);
    if (wrongs.length) console.log('[pipeline] wrong editions:', JSON.stringify(wrongs));
    expect(wrong).toBe(0);
    // المتجانسات (اسم واحد لعملين) لا تفرّقها الأسماء: تُعدّ ولا يُسمح بزيادتها
    expect(homonyms).toBeLessThanOrEqual(68);
    // نسبة لا عدد: دمج المكرر (رقم MangaDex للنسخة، 22 نوفمبر) يقلّل صفحات الأعمال فيقلّ المقام. كانت 3608/3733 (96.7%)
    expect(found / expected).toBeGreaterThanOrEqual(0.967);
    expect(found).toBeGreaterThanOrEqual(3550);
  });

  it('verification costs little: about one detail request per opened work, not one per source', () => {
    // صفحة التفاصيل: واحدة لنبذة العمل في كل فتحة، والتحقق فوقها لما يحتاجه فقط (عنوان بأبجدية أخرى أو اسم محفوظ)
    console.log(`[pipeline] detail requests=${detailCalls} for ${pages.length} opened works (${(detailCalls / pages.length).toFixed(2)} per work)`);
    expect(detailCalls / pages.length).toBeLessThan(1.3);
  });

  it('verification costs little: about one detail request per opened work, not one per source', () => {
    // صفحة التفاصيل: واحدة لنبذة العمل في كل فتحة، والتحقق فوقها لما يحتاجه فقط (عنوان بأبجدية أخرى أو اسم محفوظ)
    console.log(`[pipeline] detail requests=${detailCalls} for ${pages.length} opened works (${(detailCalls / pages.length).toFixed(2)} per work)`);
    expect(detailCalls / pages.length).toBeLessThan(1.3);
  });

  it('the identity graph never joined two works with different AniList ids', async () => {
    const { identityGraph } = await import('../lib/manga-alias-store.js');
    const g = identityGraph();
    const official = new Map(model.officialIds);
    const seen = new Set();
    let joinedWrong = 0;
    for (const e of g.edges()) {
      if (e.cut) continue;
      for (const ref of [e.a, e.b]) {
        if (seen.has(ref)) continue;
        const cls = g.classOf(ref);
        for (const r of cls) seen.add(r);
        const ids = new Set(cls.map((r) => official.get(r.replace(/^ext:/, ''))).filter(Number.isSafeInteger));
        if (ids.size > 1) joinedWrong++;
      }
    }
    expect(joinedWrong).toBe(0);
  });
});
