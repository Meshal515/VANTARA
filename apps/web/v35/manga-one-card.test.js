/**
 * انحدار من شاشة المالك (2026-10): نفس المانهوا أربع بطاقات في قسم المانجا على
 * الـAPK. القائمة تمرّ هنا كما يمرّ بها التطبيق: المحرك (مُحاكى) ← أسماء MangaDex
 * من واجهته ← canonicalIndex ← الترتيب ← بطاقات v35.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/extension-engine.js', () => ({
  default: { sources: vi.fn(), popular: vi.fn(), catalogue: vi.fn(), chapters: vi.fn(), search: vi.fn(), series: vi.fn(), isAvailable: () => true },
}));

import engine from '../lib/extension-engine.js';
import { _reset, noteEditionChapters } from '../lib/manga-evidence.js';
import { _reset as resetAliases, refsOf } from '../lib/manga-alias-store.js';
import { browse, describe as describeWork, discoverEditions, mergeWorkPages, resetSources, toV35Work } from './works.js';

const P = 'eu.kanade.tachiyomi.extension';
const DEX = '53f1ec5e-058b-4d18-a23b-2a7dbca5669f';
const LONELY = '9ecd208c-c592-4462-9f57-4d7d4a9f956f';
const PAGES = {
  [`${P}.ar.mangalek`]: [{ title: 'The Regressed Mercenary’s Machinations', url: '130829', thumbnailUrl: 'https://mangalik/cover.jpg' }],
  [`${P}.ar.mangaswat`]: [{ title: "The Regressed Mercenary's Machinations", url: '1702288' }],
  [`${P}.ar.teamx`]: [{ title: "The Regressed Mercenary's Machination", url: '/series/the-regressed-mercenarys-mach' }],
  [`${P}.ar.mangatime`]: [{ title: 'المرتزق العائد لديه خطة', url: '/manhwa/the-regressed-mercenarys-machinations#6aaea1e97ecb87d76e4bf76b' }],
  // إضافة الـAPK لا تمرّر الأسماء البديلة في القوائم
  [`${P}.all.mangadex`]: [
    { title: 'Hoegwihan Yongbyeong-eun Da Gyehoek-i Itda', url: `/manga/${DEX}` },
    { title: 'Iphak Yongbyeong', url: `/manga/${LONELY}` },
  ],
};
const DEX_API = {
  data: [
    {
      id: DEX,
      attributes: {
        title: { 'ko-ro': 'Hoegwihan Yongbyeong eun Da Gyehoek i Itda' },
        altTitles: [{ ko: '회귀한 용병은 다 계획이 있다' }, { en: 'The Regressed Mercenary Has a Plan' }, { en: "The Regressed Mercenary's Machinations" }],
      },
    },
    { id: LONELY, attributes: { title: { 'ko-ro': 'Iphak Yongbyeong' }, altTitles: [{ ko: '입학용병' }, { en: 'Teenage Mercenary' }] } },
  ],
};

let dexCalls = 0;
beforeEach(() => {
  _reset();
  resetAliases();
  resetSources();
  dexCalls = 0;
  engine.sources.mockResolvedValue(Object.keys(PAGES).map((id) => ({ id, label: id.split('.').pop() })));
  engine.popular.mockImplementation(async (id) => ({ mangas: PAGES[id].map((m) => ({ ...m })), hasNextPage: false }));
  vi.stubGlobal('fetch', async (url) => {
    if (String(url).startsWith('https://api.mangadex.org/manga?')) {
      dexCalls++;
      return { ok: true, json: async () => DEX_API };
    }
    return { ok: false, json: async () => ({}) };
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('manga listing: one work = one card', () => {
  const card = (sourceId, title, url, extra = {}) => toV35Work({
    key: title.toLowerCase(), title, editions: [{ sourceId, label: sourceId, manga: { title, url, ...extra } }],
  });

  it('keeps late alias evidence from the same source edition instead of discarding its second appearance', () => {
    const first = card('ar.a', 'Magic Emperor', '/magic');
    const other = card('ar.b', 'Demonic Emperor', '/demonic');
    const enriched = card('ar.a', 'Magic Emperor', '/magic', { altNames: ['Demonic Emperor'], thumbnailUrl: '/cover.jpg' });
    const merged = mergeWorkPages([first, other, enriched]);
    expect(merged).toHaveLength(1);
    expect(merged[0]._work.editions).toHaveLength(2);
    expect(merged[0].coverImage.large).toBe('/cover.jpg');
  });

  it('a thinner refreshed edition does not erase the already loaded cover', () => {
    const known = card('ar.a', 'Magic Emperor', '/magic', { thumbnailUrl: '/known-cover.jpg' });
    const fresh = card('ar.a', 'Magic Emperor', '/magic', { thumbnailUrl: null });
    const [merged] = mergeWorkPages([known, fresh]);
    expect(merged.coverImage.large).toBe('/known-cover.jpg');
  });

  it('merged saved library cards retain every former reference and their first position', () => {
    const saved = card('ar.a', 'Magic Emperor', '/magic', { altNames: ['Demonic Emperor'] });
    saved.id = 'ext:former canonical name';
    const unrelated = { id: 'anime:12', title: { english: 'Other content' } };
    const other = card('ar.b', 'Demonic Emperor', '/demonic');
    const merged = mergeWorkPages([saved, unrelated, other]);
    expect(merged.map((w) => w.id)).toEqual(['ext:demonic emperor', 'anime:12']);
    expect(refsOf(merged[0].id)).toEqual(expect.arrayContaining(['ext:former canonical name', 'ext:magic emperor', 'ext:demonic emperor']));
    expect(merged[0]._work.editions).toHaveLength(2);
  });

  it('merges a thousand works with five sources without writing the full reference graph per edition', () => {
    const data = new Map();
    let writes = 0;
    vi.stubGlobal('localStorage', { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => { writes++; data.set(key, value); } });
    resetAliases();
    const cards = Array.from({ length: 1000 }, (_, i) => Array.from({ length: 5 }, (_, s) =>
      card(`source.${s}`, s === 0 ? `Saga Hero ${i}` : `قصة بطل ${i}`, `/work/${i}`, s === 0 ? { altNames: [`قصة بطل ${i}`] } : {})
    )).flat();
    const merged = mergeWorkPages(cards);
    expect(merged).toHaveLength(1000);
    expect(merged.every((w) => w._work.editions.length === 5)).toBe(true);
    const persisted = JSON.parse(data.get('vantara.manga.refAliases.v1'));
    expect(Object.values(persisted).flat()).toHaveLength(2000);
    expect(writes).toBeLessThanOrEqual(2);
  });

  it('preserves chapter editions and detail facts when a saved work merges with a later page', () => {
    const first = card('ar.a', 'Magic Emperor', '/magic', { altNames: ['Demonic Emperor'] });
    const chapters = [{ name: 'Chapter 1', chapterNumber: 1, url: '/c/1' }];
    Object.assign(first, { chapters: 1, description: 'Story', _editions: [{ ...first._work.editions[0], chapters }] });
    const [merged] = mergeWorkPages([first, card('ar.b', 'Demonic Emperor', '/demonic')]);
    expect(merged.description).toBe('Story');
    expect(merged.chapters).toBe(1);
    expect(merged._editions[0].chapters).toEqual(chapters);
  });

  it('preserves chapters from repeated detailed appearances of the same source edition', () => {
    const first = card('ar.a', 'Magic Emperor', '/magic');
    const next = card('ar.a', 'Magic Emperor', '/magic');
    const chapters = (numbers) => numbers.map((n) => ({ name: `Chapter ${n}`, chapterNumber: n, url: `/c/${n}` }));
    first._editions = [{ ...first._work.editions[0], chapters: chapters([1, 2]) }];
    next._editions = [{ ...next._work.editions[0], chapters: chapters([2, 3]) }];
    const [merged] = mergeWorkPages([first, next]);
    expect(merged._editions).toHaveLength(1);
    expect(merged._editions[0].chapters.map((c) => c.chapterNumber).sort()).toEqual([1, 2, 3]);
    expect(merged.chapters).toBe(3);
  });

  it('does not substitute a related spinoff when looking up a saved work description', async () => {
    const work = { id: 'ext:the return of legendary sword master', title: { english: 'The Return Of Legendary Sword Master' } };
    engine.sources.mockResolvedValue([{ id: 'ar.a' }]);
    engine.search.mockResolvedValue({ mangas: [{ title: 'The Return Of Legendary Sword Master Reborn', url: '/spinoff' }] });
    engine.series.mockResolvedValue({ manga: { description: 'A different story' }, chapters: [] });
    expect(await describeWork(work)).toBe(work);
  });

  it('recovers a saved English title from an Arabic source with explicit URL slug evidence', async () => {
    const work = { id: 'ext:the regressed mercenary s machinations', title: { english: 'The Regressed Mercenary’s Machinations' } };
    engine.sources.mockResolvedValue([{ id: 'ar.a' }]);
    engine.search.mockResolvedValue({ mangas: [{ title: 'المرتزق العائد لديه خطة', url: '/manhwa/the-regressed-mercenarys-machinations' }] });
    engine.series.mockResolvedValue({ manga: { description: 'The correct story' }, chapters: [] });
    expect((await describeWork(work)).description).toBe('The correct story');
  });

  it('does not discover a spinoff by an eighty-percent name overlap', async () => {
    const first = card('ar.a', 'The Return Of The Legendary Sword Master', '/main');
    engine.sources.mockResolvedValue([{ id: 'ar.a' }, { id: 'ar.b' }]);
    engine.search.mockResolvedValue({ mangas: [{ title: 'The Return Of The Legendary Sword Master Reborn', url: '/spinoff' }] });
    expect(await discoverEditions(first)).toEqual([]);
  });

  it('rejects ambiguous source search results instead of adopting the first matching alternate title', async () => {
    const first = card('ar.a', 'Iron Blooded Hunter Returns', '/main', { altNames: ['Iron Blooded Hunter Return'] });
    engine.sources.mockResolvedValue([{ id: 'ar.a' }, { id: 'ar.b' }]);
    engine.search.mockResolvedValue({ mangas: [
      { title: 'Iron Blooded Hunter Returns', url: '/one' },
      { title: 'Iron Blooded Hunter Return', url: '/two' },
    ] });
    expect(await discoverEditions(first)).toEqual([]);
  });
  it('the four cards of The Regressed Mercenary are one card with every source', async () => {
    const { items } = await browse({ kind: 'popular' });
    const mercenary = items.filter((w) => w._work.editions.some((e) => /mercenary|المرتزق|hoegwihan/i.test(e.manga.title)));
    expect(mercenary).toHaveLength(1);
    const [card] = mercenary;
    // العنوان من أوثق نسخة (Mangalek)، والمفتاح الاسم الذي تحمله المصادر
    expect(card.title.english).toBe('The Regressed Mercenary’s Machinations');
    expect(card.id).toBe('ext:the regressed mercenary s machinations');
    expect(card._work.editions.map((e) => e.sourceId.split('.').pop()).sort()).toEqual(['mangadex', 'mangalek', 'mangaswat', 'mangatime', 'teamx']);
    // طلب واحد لواجهة MangaDex لصفحة القائمة كلها
    expect(dexCalls).toBe(1);
  });

  it('a work whose only edition answered with no chapters is not shown', async () => {
    // Iphak Yongbyeong: فصوله العربية محجوبة كلها عند MangaDex، ولا بطاقة عربية تطابقه
    const before = await browse({ kind: 'popular' });
    expect(before.items.some((w) => w.title.english === 'Iphak Yongbyeong')).toBe(true);
    noteEditionChapters(`${P}.all.mangadex`, `/manga/${LONELY}`, 0);
    // ونسخة MangaDex الفارغة داخل عملٍ له فصول لا تخفيه
    noteEditionChapters(`${P}.all.mangadex`, `/manga/${DEX}`, 0);
    const after = await browse({ kind: 'popular' });
    expect(after.items.some((w) => w.title.english === 'Iphak Yongbyeong')).toBe(false);
    expect(after.items.some((w) => w.title.english === 'The Regressed Mercenary’s Machinations')).toBe(true);
    // ردّ بفصول لاحقًا: يعود
    noteEditionChapters(`${P}.all.mangadex`, `/manga/${LONELY}`, 3);
    const back = await browse({ kind: 'popular' });
    expect(back.items.some((w) => w.title.english === 'Iphak Yongbyeong')).toBe(true);
  });


  it('merges differently named editions on the first page, even while shipped aliases are still loading', async () => {
    engine.popular.mockImplementation(async (id) => ({
      mangas: id.endsWith('.mangalek')
        ? [{ title: 'Demonic Emperor', url: '/demonic-emperor' }]
        : id.endsWith('.mangaswat')
          ? [{ title: 'Magic Emperor', url: '/magic-emperor' }]
          : [],
      hasNextPage: false,
    }));
    let aliasLoads = 0;
    vi.stubGlobal('fetch', async (url) => {
      if (String(url).includes('/data/manga-aliases.json')) {
        aliasLoads++;
        await new Promise((resolve) => setTimeout(resolve, 2));
        return { ok: true, json: async () => ({ aliases: { 'demonic emperor': ['Magic Emperor'] } }) };
      }
      return { ok: false, json: async () => ({}) };
    });
    const { items } = await browse({ kind: 'popular' });
    expect(aliasLoads).toBe(1);
    expect(items).toHaveLength(1);
    expect(items[0]._work.editions.map((edition) => edition.sourceId.split('.').pop()).sort()).toEqual(['mangalek', 'mangaswat']);
  });


  it('deduplicates the same manga across separate source pages without losing either edition', async () => {
    engine.popular.mockImplementation(async (sourceId, page) => ({
      mangas: page === 1 && sourceId.endsWith('.mangalek')
        ? [{ title: 'Demonic Emperor', url: '/demonic', altNames: ['Magic Emperor'] }]
        : page === 2 && sourceId.endsWith('.mangaswat')
          ? [{ title: 'Magic Emperor', url: '/magic' }]
          : [],
      hasNextPage: page === 1,
    }));
    const first = await browse({ kind: 'popular', page: 1 });
    const second = await browse({ kind: 'popular', page: 2 });
    expect(first.items).toHaveLength(1);
    expect(second.items).toHaveLength(1);
    expect(first.items[0].id).not.toBe(second.items[0].id);
    const merged = mergeWorkPages([...first.items, ...second.items]);
    expect(merged).toHaveLength(1);
    expect(merged[0]._work.editions.map((e) => e.sourceId.split('.').pop()).sort()).toEqual(['mangalek', 'mangaswat']);
    expect(mergeWorkPages(merged)).toHaveLength(1);
  });

  it('MangaDex unreachable: the listing still renders, never merges by guessing', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new Error('offline');
    });
    const { items } = await browse({ kind: 'popular' });
    const titles = items.map((w) => w.title.english);
    // الثلاث بطاقات العربية/الإنجليزية واحدة بالأدلة المتاحة، وMangaDex بلا دليل يبقى وحده
    expect(titles.filter((t) => /Regressed Mercenary/.test(t))).toHaveLength(1);
    expect(titles).toContain('Hoegwihan Yongbyeong-eun Da Gyehoek-i Itda');
  });
});
