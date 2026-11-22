import { beforeEach, expect, it, vi } from 'vitest';

vi.mock('../lib/extension-engine.js', () => ({
  default: { sources: vi.fn(), search: vi.fn(), popular: vi.fn(), catalogue: vi.fn(), chapters: vi.fn(), isAvailable: () => true },
}));
// حكم AniList: الأجنبي يظهر في البحث بعد التحقق من نظافته (قرار المالك، 22 نوفمبر)
vi.mock('../lib/manga-meta.js', async (original) => ({
  ...(await original()),
  fetchMangaMatches: vi.fn(async (titles) => new Map(titles.map((t) => [t, { verdict: 'clean' }]))),
}));
import engine from '../lib/extension-engine.js';
import { browseLive, resetSources } from './works.js';

const P = 'eu.kanade.tachiyomi.extension';
beforeEach(() => {
  resetSources();
  engine.sources.mockResolvedValue([
    { id: `${P}.ar.mangalek`, label: 'Mangalek', lang: 'ar' },
    { id: `${P}.all.mangafire@en`, label: 'MangaFire', lang: 'en', filler: true, warning: 'SAFE' },
    { id: `${P}.en.mangahere@en`, label: 'Mangahere', lang: 'en', filler: true, warning: 'SAFE' },
  ]);
  engine.search.mockImplementation(async (id) => ({
    mangas: id.includes('mangalek') ? [{ title: 'Kariel the Hero', url: '/k' }]
      : [{ title: 'Karigal', url: `/karigal-${id}` }, { title: 'Karin to.', url: `/karin-${id}` }],
    hasNextPage: false,
  }));
  vi.stubGlobal('fetch', async () => ({ ok: false, json: async () => ({}) }));
});

// قرار المالك (22 نوفمبر): عمل نسخه كلها إنجليزية من مصدر آمن يظهر في البحث المقصود بعد حكم AniList بنظافته، بوسم «إنجليزي»
it('بحث: عمل كل نسخه إنجليزية يظهر بوسم «إنجليزي»، والعربي بلا وسم', async () => {
  const { items } = await browseLive({ query: 'Kariel' });
  const byTitle = new Map(items.map((w) => [w.title?.english ?? w.title, w]));
  expect(byTitle.get('Kariel the Hero').foreignLang).toBeNull();
  expect(byTitle.get('Karigal').foreignLang).toBe('إنجليزي');
});

it('بحث: إضافة مستودع إنجليزية (pkg#id) تُعرض أعمالها بوسم «إنجليزي» لا كأنها عربية', async () => {
  resetSources();
  engine.sources.mockResolvedValue([
    { id: `${P}.ar.mangalek`, label: 'Mangalek', lang: 'ar' },
    { id: `${P}.en.mangahere#2`, label: 'Mangahere', lang: 'en', filler: true, user: true, warning: 'SAFE' },
  ]);
  const { items } = await browseLive({ query: 'Kariel' });
  const byTitle = new Map(items.map((w) => [w.title?.english ?? w.title, w]));
  // لا تُعرض كأنها عربية: وسم لغتها من حزمتها (extension.en.)
  expect(byTitle.get('Kariel the Hero').foreignLang).toBeNull();
  expect(byTitle.get('Karigal').foreignLang).toBe('إنجليزي');
});
