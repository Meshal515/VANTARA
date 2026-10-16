import { beforeEach, expect, it, vi } from 'vitest';

vi.mock('../lib/extension-engine.js', () => ({
  default: { sources: vi.fn(), search: vi.fn(), popular: vi.fn(), catalogue: vi.fn(), chapters: vi.fn(), isAvailable: () => true },
}));
import engine from '../lib/extension-engine.js';
import { browseLive, resetSources } from './works.js';

const P = 'eu.kanade.tachiyomi.extension';
beforeEach(() => {
  resetSources();
  engine.sources.mockResolvedValue([
    { id: `${P}.ar.mangalek`, label: 'Mangalek', lang: 'ar' },
    { id: `${P}.all.mangafire@en`, label: 'MangaFire', lang: 'en', filler: true },
    { id: `${P}.en.mangahere@en`, label: 'Mangahere', lang: 'en', filler: true },
  ]);
  engine.search.mockImplementation(async (id) => ({
    mangas: id.includes('mangalek') ? [{ title: 'Kariel the Hero', url: '/k' }]
      : [{ title: 'Karigal', url: `/karigal-${id}` }, { title: 'Karin to.', url: `/karin-${id}` }],
    hasNextPage: false,
  }));
  vi.stubGlobal('fetch', async () => ({ ok: false, json: async () => ({}) }));
});

it('بحث: عمل كل نسخه من مصادر التكملة الإنجليزية لا يظهر', async () => {
  const { items } = await browseLive({ query: 'Kariel' });
  expect(items.map((w) => w.title?.english ?? w.title)).toEqual(['Kariel the Hero']);
});

it('بحث: إضافة مستودع إنجليزية (pkg#id) لا تعرض أعمالها كأنها عربية حتى بلا علامة filler', async () => {
  resetSources();
  engine.sources.mockResolvedValue([
    { id: `${P}.ar.mangalek`, label: 'Mangalek', lang: 'ar' },
    { id: `${P}.en.mangahere#2`, label: 'Mangahere', lang: 'en', filler: true, user: true, warning: 'SAFE' },
  ]);
  const { items } = await browseLive({ query: 'Kariel' });
  expect(items.map((w) => w.title?.english ?? w.title)).toEqual(['Kariel the Hero']);
});
