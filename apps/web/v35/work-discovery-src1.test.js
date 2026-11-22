import { describe, expect, it, vi, beforeEach } from 'vitest';
vi.mock('../lib/extension-engine.js', () => ({ default: { sources: vi.fn(), popular: vi.fn(), catalogue: vi.fn(), chapters: vi.fn(), search: vi.fn(), series: vi.fn(), isAvailable: () => true } }));
import engine from '../lib/extension-engine.js';
import { discoverEditions, resetSources, toV35Work } from './works.js';
const P='eu.kanade.tachiyomi.extension';
const work = (sourceId, title, url, extra={}) => toV35Work({ key: title.toLowerCase(), title, editions: [{ sourceId, manga: { title, url, ...extra } }] });
beforeEach(() => { resetSources(); vi.stubGlobal('fetch', async () => ({ ok: false, json: async () => ({}) })); });
describe('SRC1 (audit §13): installed sources join the work sheet', () => {
  it('A exact single', async () => {
    engine.sources.mockResolvedValue([{ id: `${P}.ar.a` }, { id: `${P}.ar.user` , user: true, warning: 'SAFE' }]);
    engine.search.mockImplementation(async (id) => ({ mangas: id.endsWith('user') ? [{ title: 'Solo Leveling', url: '/u/solo' }] : [] }));
    expect((await discoverEditions(work(`${P}.ar.a`, 'Solo Leveling', '/a/solo'))).map((e) => e.sourceId)).toEqual([`${P}.ar.user`]);
  });
  it('B exact + unrelated other result', async () => {
    engine.sources.mockResolvedValue([{ id: `${P}.ar.a` }, { id: `${P}.ar.user` , user: true, warning: 'SAFE' }]);
    engine.search.mockImplementation(async (id) => ({ mangas: id.endsWith('user') ? [{ title: 'Solo Leveling', url: '/u/solo' }, { title: 'Solo Leveling: Ragnarok', url: '/u/rag' }, {title:'Solo Leveling Side Story', url:'/u/side'}] : [] }));
    expect((await discoverEditions(work(`${P}.ar.a`, 'Solo Leveling', '/a/solo'))).map((e) => e.sourceId)).toEqual([`${P}.ar.user`]);
  });
  it('C exact title, different slug', async () => {
    engine.sources.mockResolvedValue([{ id: `${P}.ar.a` }, { id: `${P}.ar.user` , user: true, warning: 'SAFE' }]);
    engine.search.mockImplementation(async (id) => ({ mangas: id.endsWith('user') ? [{ title: 'Omniscient Reader', url: '/series/orv-123' }] : [] }));
    expect((await discoverEditions(work(`${P}.ar.a`, 'Omniscient Reader', '/manga/omniscient-reader'))).map((e) => e.sourceId)).toEqual([`${P}.ar.user`]);
  });
  it('D arabic-known work, user source english exact', async () => {
    engine.sources.mockResolvedValue([{ id: `${P}.ar.a` }, { id: `${P}.en.user@en` , user: true, filler:true, warning: 'SAFE' }]);
    engine.search.mockImplementation(async (id) => ({ mangas: id.includes('user') ? [{ title: 'Solo Leveling', url: '/u/solo' }] : [] }));
    const w = toV35Work({ key: 'سولو ليفلينج', title: 'سولو ليفلينج', aliases:['Solo Leveling','Na Honjaman Level Up'], editions: [{ sourceId: `${P}.ar.a`, manga: { title: 'سولو ليفلينج', url: '/a/solo' } }] });
    expect((await discoverEditions(w)).map((e) => e.sourceId)).toEqual([`${P}.en.user@en`]);
  });
});
describe('المصدر المختلط يُثري فقط بعد تأكيد التفاصيل ونظافتها (قرار المالك، 22 نوفمبر)', () => {
  const MIXED = `${P}.all.mangadex@en`;
  beforeEach(() => {
    engine.sources.mockResolvedValue([{ id: `${P}.ar.a` }, { id: MIXED, user: true, filler: true, warning: 'MIXED' }]);
    engine.search.mockImplementation(async (id) => ({ mangas: id === MIXED ? [{ title: 'Solo Leveling', url: '/m/solo' }] : [] }));
  });
  it('an exact title in a mixed source is not enough: its details page must confirm the work', async () => {
    engine.series.mockResolvedValue({ manga: { title: 'Solo Leveling', genre: 'Action, Fantasy' }, chapters: [] });
    expect((await discoverEditions(work(`${P}.ar.a`, 'Solo Leveling', '/a/solo'))).map((e) => e.sourceId)).toEqual([MIXED]);
    expect(engine.series).toHaveBeenCalled();
  });
  it('a mixed copy whose details are adult is refused and never joins the card', async () => {
    engine.series.mockResolvedValue({ manga: { title: 'Solo Leveling', genre: 'Ecchi, Harem' }, chapters: [] });
    expect(await discoverEditions(work(`${P}.ar.a`, 'Solo Leveling', '/a/solo'), { refresh: true })).toEqual([]);
  });
  it('details that do not answer leave the mixed copy out', async () => {
    engine.series.mockRejectedValue(new Error('timeout'));
    expect(await discoverEditions(work(`${P}.ar.a`, 'Solo Leveling', '/a/solo'), { refresh: true })).toEqual([]);
  });
});
