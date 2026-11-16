/**
 * مصدر مانجا محدد (طلب المالك 14 نوفمبر 2026): العمل المفتوح من داخل مصدر يعرض فصول ذلك المصدر وحده، ولا
 * يسأل بقية المصادر. والفتح العام (من البحث أو المكتبة) يبقى يكتشف النسخ ويجمعها كما كان — بلا تغيير.
 */
import { beforeEach, expect, it, vi } from 'vitest';

const fx = vi.hoisted(() => ({ store: new Map(), search: vi.fn(), chapters: vi.fn(), series: vi.fn() }));
vi.mock('../lib/extension-engine.js', () => {
  const api = {
    isAvailable: () => true,
    sources: async () => [{ id: 'teamx', name: 'Team X', lang: 'ar' }, { id: 'mangalek', name: 'Mangalek', lang: 'ar' }, { id: 'azora', name: 'Azora', lang: 'ar' }],
    search: (...a) => fx.search(...a),
    chapters: (...a) => fx.chapters(...a),
    series: (...a) => fx.series(...a),
    onChapters: () => () => {},
  };
  return { default: api, ...api };
});
vi.mock('../lib/chapter-store.js', () => ({
  readWork: async id => fx.store.get(id) ?? null,
  writeWork: async (id, value) => { fx.store.set(id, value); },
  readKv: async () => null, writeKv: async () => {},
}));
vi.stubGlobal('localStorage', { getItem: () => null, setItem() {}, removeItem() {} });

const { loadWork, toV35Work } = await import('./works.js');
const { sourceWorkModel } = await import('../addons/work-view.js');

const chapter = (n, src) => ({ url: `/${src}/${n}`, name: `الفصل ${n}`, chapterNumber: n });
beforeEach(() => {
  fx.store.clear();
  for (const f of [fx.search, fx.chapters, fx.series]) f.mockReset();
  fx.series.mockImplementation(async (sourceId, manga) => ({ manga: { ...manga, description: 'نبذة' }, chapters: [chapter(1, sourceId), chapter(2, sourceId)] }));
  fx.chapters.mockImplementation(async sourceId => [chapter(1, sourceId), chapter(2, sourceId), chapter(3, sourceId)]);
  fx.search.mockImplementation(async sourceId => ({ mangas: [{ title: 'Solo Leveling', url: `/${sourceId}/solo` }] }));
});

const addon = { key: 'core|mangalek', sourceId: 'mangalek', name: 'Mangalek', contentTypes: ['manga'], bundled: false, protocol: 'native' };

it('a work opened inside one manga source loads that source alone and never searches the others', async () => {
  const work = sourceWorkModel({ title: 'Solo Leveling', url: '/mangalek/solo', externalIds: { anilist: '105398' } }, { addon });
  expect(work._pinnedSource).toBe('mangalek');
  const full = await loadWork(work, { pinnedSource: work._pinnedSource });
  expect(fx.search).not.toHaveBeenCalled();
  expect(full._editions.map(e => e.sourceId)).toEqual(['mangalek']);
  expect(new Set(full._chapters.flatMap(c => (c.sources ?? [c]).map(x => x.s ?? x.sourceId)).filter(Boolean))).not.toContain('teamx');
});

it('a pinned open does not show cached editions of other sources, and keeps them stored', async () => {
  const work = sourceWorkModel({ title: 'Solo Leveling', url: '/mangalek/solo', externalIds: { anilist: '105398' } }, { addon });
  fx.store.set(String(work.id), { editions: [{ sourceId: 'teamx', manga: { title: 'Solo Leveling', url: '/teamx/solo' }, chapters: [chapter(1, 'teamx')] }], discoveredAt: Date.now(), discoveredSources: ['teamx', 'mangalek', 'azora'] });
  const full = await loadWork(work, { pinnedSource: 'mangalek' });
  expect(full._editions.map(e => e.sourceId)).toEqual(['mangalek']);
  // المكتبة تعرف العمل من مصادر أخرى: لا يُمحى ما عرفناه
  expect(fx.store.get(String(work.id)).editions.map(e => e.sourceId).sort()).toEqual(['mangalek', 'teamx']);
});

it('the general open (search/library) still discovers and merges other sources as before', async () => {
  const work = toV35Work({ key: 'solo-leveling', title: 'Solo Leveling', thumbnailUrl: null, editions: [{ sourceId: 'mangalek', manga: { title: 'Solo Leveling', url: '/mangalek/solo' } }], aliases: [] });
  const full = await loadWork(work, {});
  expect(fx.search).toHaveBeenCalled();
  expect(full._editions.map(e => e.sourceId).sort()).toEqual(['azora', 'mangalek', 'teamx']);
});
