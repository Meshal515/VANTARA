import { describe, expect, it, vi } from 'vitest';
import { animeProviders, mangaProviders, pickLatestSection } from './latest-providers.js';

describe('قسم «الأحدث» كما يعلنه المصدر نفسه (بلا أسماء مواقع)', () => {
  it('latest المعلن أولًا، ثم اسم يقول إنه الأحدث، ثم أول قسم رئيسي', () => {
    expect(pickLatestSection([{ key: 'popular', name: 'الرائج' }, { key: 'latest', name: 'آخر التحديثات' }])).toBe('latest');
    expect(pickLatestSection([{ key: 'section:0', name: 'أفلام' }, { key: 'section:1', name: 'آخر الحلقات المضافة' }])).toBe('section:1');
    expect(pickLatestSection([{ key: 'section:0', name: 'Trending' }, { key: 'section:1', name: 'Recently Updated' }])).toBe('section:1');
    expect(pickLatestSection([{ key: 'section:0', name: 'الرئيسية' }])).toBe('section:0');
    expect(pickLatestSection([{ key: 'popular', name: 'الرائج' }])).toBeNull();
    expect(pickLatestSection([])).toBeNull();
  });
});

describe('محوّل Mihon', () => {
  it('latest طلب واحد للصفحة، وunits من فصول العمل فقط عند الطلب', async () => {
    const engine = {
      latest: vi.fn(async () => ({ mangas: [{ url: '/m/1', title: 'ون بيس', thumbnailUrl: 'https://c/1.jpg' }, { url: '', title: 'ناقص' }], hasNextPage: true })),
      chapters: vi.fn(async () => [{ chapterNumber: 1120, dateUpload: 1700 }, { name: 'الفصل 1119' }, { name: 'إعلان' }]),
    };
    const [p] = mangaProviders({ engine, sources: [{ id: 'pkg#1', name: 'مصدر', lang: 'ar', domain: 'site.example' }, { id: 'f', filler: true }] });
    expect(p).toMatchObject({ key: 'pkg#1', family: 'manga', section: 'manga', host: 'site.example' });
    expect(engine.latest).not.toHaveBeenCalled();
    const page = await p.latest(1);
    expect(engine.latest).toHaveBeenCalledTimes(1);
    expect(page).toEqual({ items: [{ ref: { url: '/m/1', title: 'ون بيس', thumbnailUrl: 'https://c/1.jpg' }, title: 'ون بيس', cover: 'https://c/1.jpg', url: '/m/1' }], hasNext: true });
    expect(engine.chapters).not.toHaveBeenCalled();
    expect(await p.units(page.items[0].ref)).toEqual([{ number: 1120, season: null, publishedAt: 1700 }, { number: 1119, season: null }]);
    expect(engine.chapters).toHaveBeenCalledWith('pkg#1', page.items[0].ref, { fresh: true });
  });
});

describe('محوّلات Aniyomi وCloudStream عبر محرك الأنمي', () => {
  const plugin = {
    sources: async () => ({ sources: [
      { id: 'ani.src', name: 'أنمي', lang: 'ar', enabled: true, content: 'anime', domain: 'https://anime.example/' },
      { id: 'addon|cs3|cs3_Akwam', name: 'Akwam', lang: 'ar', enabled: true, content: 'cinema' },
      { id: 'off', enabled: false }, { id: 'broken', enabled: true, loadError: 'x' }, { id: 'nolatest', enabled: true },
    ] }),
    sections: async ({ sourceId }) => ({ sections: sourceId === 'ani.src' ? [{ key: 'popular', name: 'الرائج' }, { key: 'latest', name: 'آخر التحديثات' }] : sourceId === 'nolatest' ? [{ key: 'popular', name: 'الرائج' }] : [{ key: 'section:0', name: 'أفلام' }, { key: 'section:1', name: 'آخر الإضافات' }] }),
    page: vi.fn(async ({ listing }) => ({ page: { items: [{ url: '/a', title: 'عمل', thumbnail: 'https://t' }], hasNext: listing === 'latest' } })),
    episodes: vi.fn(async () => ({ episodes: [{ number: 12, date: 99 }, { number: 13, filler: true }, { number: 11 }] })),
  };
  it('يتخطى المعطّل والمعطوب وما لا «أحدث» له، ويختار القسم الصحيح لكل محرك', async () => {
    const list = await animeProviders({ plugin });
    expect(list.map((p) => [p.key, p.family, p.section, p.listing])).toEqual([['ani.src', 'aniyomi', 'anime', 'latest'], ['addon|cs3|cs3_Akwam', 'cloudstream', 'cinema', 'section:1']]);
    expect(list[0].host).toBe('anime.example');
    await list[1].latest(1);
    expect(plugin.page).toHaveBeenLastCalledWith({ sourceId: 'addon|cs3|cs3_Akwam', listing: 'section:1', page: 1 });
    expect(await list[0].units({ url: '/a' })).toEqual([{ number: 12, season: null, publishedAt: 99 }, { number: 11, season: null }]);
  });
  it('بلا محرك أنمي (ويندوز أو الويب): لا محوّلات بلا خطأ', async () => {
    expect(await animeProviders({ plugin: null })).toEqual([]);
  });
});
