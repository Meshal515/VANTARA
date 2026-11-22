/**
 * بلاغ المالك (22 نوفمبر، MangaMillion و«Spy x Family»): تقارير الأجهزة تقول إن MangaMillion ردّ «فارغ» على كل أسئلة
 * الاكتشاف (39 مرة) وبحثه العادي يعمل. السبب: «SPY×FAMILY» يُطبَّع «spy family» والموقع يكتبه «Spy x Family»، فلا السؤال
 * يجده ولا الاسم يطابقه. الصيغة بحرف x اسم بديل في السؤال وفي الهوية (titleForms)، بلا تغيير مفاتيح المكتبة.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../lib/extension-engine.js', () => ({ default: { sources: vi.fn(), popular: vi.fn(), catalogue: vi.fn(), chapters: vi.fn(), search: vi.fn(), series: vi.fn(), isAvailable: () => true } }));
import engine from '../lib/extension-engine.js';
import { canonicalIndex, titleForms } from '../lib/catalog.js';
import { discoverEditions, resetSources, searchVariants, toV35Work } from './works.js';

const P = 'eu.kanade.tachiyomi.extension';
const MILLION = `${P}.all.mangamillion#8929911308540155494`;
beforeEach(() => { resetSources(); vi.stubGlobal('fetch', async () => ({ ok: false, json: async () => ({}) })); });

describe('SPY×FAMILY', () => {
  it('the multiplication sign has an x form, and nothing else changes', () => {
    expect(titleForms('SPY×FAMILY')).toEqual(['SPY×FAMILY', 'SPY x FAMILY']);
    expect(titleForms('Hunter × Hunter')).toEqual(['Hunter × Hunter', 'Hunter x Hunter']);
    expect(titleForms('Solo Leveling')).toEqual(['Solo Leveling']);
    expect(searchVariants('SPY×FAMILY')).toContain('SPY x FAMILY');
  });

  it('the card asks the installed source with the x form and joins its copy', async () => {
    engine.sources.mockResolvedValue([{ id: `${P}.ar.teamx`, lang: 'ar' }, { id: MILLION, lang: 'ar', user: true, warning: 'SAFE' }]);
    const asked = [];
    engine.search.mockImplementation(async (id, q) => {
      asked.push([id, q]);
      return { mangas: id === MILLION && /spy x family/i.test(q) ? [{ title: 'Spy x Family', url: '/manga/spy-x-family' }] : [] };
    });
    const work = toV35Work({ key: 'spy family', title: 'SPY×FAMILY', editions: [{ sourceId: `${P}.ar.teamx`, manga: { title: 'SPY×FAMILY', url: '/series/spy-family' } }] });
    const found = await discoverEditions(work);
    expect(found.map((e) => e.sourceId)).toEqual([MILLION]);
    expect(asked.some(([id, q]) => id === MILLION && q === 'SPY x FAMILY')).toBe(true);
  });

  it('two sources writing it both ways are one card in a listing', () => {
    const index = canonicalIndex();
    index.add({ sourceId: `${P}.ar.teamx`, manga: { title: 'SPY×FAMILY', url: '/a' } });
    index.add({ sourceId: `${P}.ar.mangalek`, manga: { title: 'Spy x Family', url: '/b' } });
    expect(index.list()).toHaveLength(1);
  });
});

describe('الاسم العربي من MangaDex في الاكتشاف', () => {
  it('an Arabic source is asked by the Arabic name MangaDex gives for the same AniList number, and its copy joins', async () => {
    const { noteOfficialIds } = await import('../lib/manga-alias-store.js');
    noteOfficialIds([['the regressor of the fallen family', 1001]]);
    const AR = `${P}.ar.arabicsite#77`;
    engine.sources.mockResolvedValue([{ id: `${P}.ar.teamx`, lang: 'ar' }, { id: AR, lang: 'ar', user: true, warning: 'SAFE' }]);
    vi.stubGlobal('fetch', async (url) => String(url).startsWith('https://api.mangadex.org/manga?')
      ? { ok: true, json: async () => ({ data: [
        { attributes: { title: { en: 'The Regressor of the Fallen Family' }, altTitles: [{ ar: 'العائد من العائلة الساقطة' }], links: { al: '1001' }, tags: [] } },
        { attributes: { title: { en: 'Fallen Family Side Story' }, altTitles: [{ ar: 'قصة جانبية' }], links: { al: '2002' }, tags: [] } },
      ] }) }
      : { ok: false, json: async () => ({}) });
    engine.search.mockImplementation(async (id, q) => ({ mangas: id === AR && q === 'العائد من العائلة الساقطة' ? [{ title: 'العائد من العائلة الساقطة', url: '/s/1' }] : [] }));
    const work = toV35Work({ key: 'the regressor of the fallen family', title: 'The Regressor of the Fallen Family', editions: [{ sourceId: `${P}.ar.teamx`, manga: { title: 'The Regressor of the Fallen Family', url: '/series/r' } }] });
    const found = await discoverEditions(work);
    expect(found.map((e) => [e.sourceId, e.evidence])).toEqual([[AR, 'exact']]);
  });
});
