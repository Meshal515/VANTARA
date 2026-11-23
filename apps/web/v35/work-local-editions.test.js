import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { compactEditions } from './work-ref.js';

vi.mock('../lib/extension-engine.js', () => ({
  default: { isAvailable: () => true, sources: vi.fn(), search: vi.fn(), chapters: vi.fn(), series: vi.fn() },
}));

const installedId = 'eu.kanade.tachiyomi.extension.all.mangamillion#8929911308540155494';
const teamId = 'eu.kanade.tachiyomi.extension.ar.teamx';
const installed = { id: installedId, label: 'Manga Million', lang: 'ar', user: true, warning: 'SAFE' };
const team = { id: teamId, label: 'Team X', lang: 'ar' };
const addon = { key: 'native|mangamillion', sourceId: installedId, contentTypes: ['manga'] };
const chapter = (n) => ({ url: `/chapters/${n}`, chapterNumber: n, name: `Chapter ${n}` });

let engine;
let loadWork;
let resetSources;
let sourceWorkModel;
let toV35Work;

beforeEach(async () => {
  vi.resetModules();
  vi.stubGlobal('indexedDB', new IDBFactory());
  vi.stubGlobal('localStorage', undefined);
  ({ default: engine } = await import('../lib/extension-engine.js'));
  ({ loadWork, resetSources, toV35Work } = await import('./works.js'));
  ({ sourceWorkModel } = await import('../addons/work-view.js'));
  engine.sources.mockReset().mockResolvedValue([team, installed]);
  engine.search.mockReset().mockResolvedValue({ mangas: [], hasNextPage: false });
  engine.chapters.mockReset().mockResolvedValue([chapter(9)]);
  engine.series.mockReset().mockImplementation(async (sourceId, manga) => ({
    manga,
    chapters: [chapter(sourceId === installedId ? 10 : 9)],
  }));
});

afterEach(() => vi.unstubAllGlobals());

const generalWork = () => ({
  ...toV35Work({ key: 'solo leveling', title: 'Solo Leveling', editions: [
    { sourceId: teamId, label: team.label, manga: { title: 'Solo Leveling', url: '/team/solo' } },
  ] }),
  _metaId: 105398,
});

function openFromAddon({ url = '/million/solo', externalIds } = {}) {
  const work = sourceWorkModel({ title: 'Solo Leveling', url, externalIds }, { addon });
  return loadWork(work, { pinnedSource: work._pinnedSource });
}

it('uses the edition already opened in a device addon when opening the general card', async () => {
  await openFromAddon();
  engine.chapters.mockRejectedValue(new Error('offline'));
  engine.series.mockRejectedValue(new Error('offline'));
  const { _sources } = await loadWork(generalWork(), { discover: false });
  expect(_sources).toContainEqual(expect.objectContaining({ sourceId: installedId, count: 1 }));
});

it('hides cached repository editions when the addon is removed and reuses them if reinstalled', async () => {
  await openFromAddon();
  const openCard = () => loadWork(generalWork(), { discover: false });
  expect((await openCard())._sources.map((source) => source.sourceId)).toContain(installedId);

  engine.sources.mockResolvedValue([team]);
  resetSources();
  expect((await openCard())._sources.map((source) => source.sourceId)).not.toContain(installedId);

  engine.sources.mockResolvedValue([team, installed]);
  resetSources();
  expect((await openCard())._sources.map((source) => source.sourceId)).toContain(installedId);
});

it('excludes a saved edition with a conflicting official id', async () => {
  await openFromAddon({ externalIds: { anilist: '9999' } });
  const { _sources } = await loadWork(generalWork(), { discover: false });
  expect(_sources.map((source) => source.sourceId)).toEqual([teamId]);
});

it('leaves two same-title works with distinct links in one addon unassigned', async () => {
  await openFromAddon({ url: '/million/solo-1' });
  await openFromAddon({ url: '/million/solo-2' });
  const { _sources } = await loadWork(generalWork(), { discover: false });
  expect(_sources.map((source) => source.sourceId)).toEqual([teamId]);
});

it('keeps local edition URLs out of shared work descriptions', async () => {
  await openFromAddon();
  const general = await loadWork(generalWork(), { discover: false });
  expect(compactEditions(general._editions).map((edition) => edition.sourceId)).toEqual([teamId]);
  const pinned = await openFromAddon();
  expect(compactEditions(pinned._editions)).toEqual([]);
});

it('requires details from a mixed source before borrowing its local edition', async () => {
  engine.sources.mockResolvedValue([team, { ...installed, warning: 'MIXED' }]);
  const { writeWork } = await import('../lib/chapter-store.js');
  await writeWork('ext:manga|provider:native:solo|s|p', {
    editions: [{ sourceId: installedId, manga: { title: 'Solo Leveling', url: '/million/solo' }, chapters: [chapter(10)] }],
  });
  const openCard = () => loadWork(generalWork(), { discover: false });
  expect((await openCard())._sources.map((source) => source.sourceId)).toEqual([teamId]);
  await openFromAddon();
  expect((await openCard())._sources.map((source) => source.sourceId)).toContain(installedId);
});
