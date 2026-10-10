/**
 * انحدار من شاشة المالك (2026-10): نفس المانهوا أربع بطاقات في قسم المانجا على
 * الـAPK. القائمة تمرّ هنا كما يمرّ بها التطبيق: المحرك (مُحاكى) ← أسماء MangaDex
 * من واجهته ← canonicalIndex ← الترتيب ← بطاقات v35.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/extension-engine.js', () => ({
  default: { sources: vi.fn(), popular: vi.fn(), catalogue: vi.fn(), chapters: vi.fn(), isAvailable: () => true },
}));

import engine from '../lib/extension-engine.js';
import { _reset, noteEditionChapters } from '../lib/manga-evidence.js';
import { browse, resetSources } from './works.js';

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
