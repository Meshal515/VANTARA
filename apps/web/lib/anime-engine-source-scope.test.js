/**
 * نطاق المصدر المحدد في جلسة التجهيز: الدخول من مصدر (AnimeRift أو Anime4Up أو أي إضافة) يعني أن نسخه هي
 * الجلسة كلها. الهوية الرسمية (AniList/Kitsu/IMDb) تبقى للترجمات والمشغّل، ولا تجلب Torrentio أو غيره.
 * والبحث العام (بلا pinned) يبقى يجمع كل المصادر كما كان.
 */
import { afterEach, expect, it, vi } from 'vitest';
const fixtures = vi.hoisted(() => ({ runtime: null }));
vi.mock('../pwa/platform.js', async original => ({ ...await original(), isNative: () => globalThis.Capacitor?.isNativePlatform?.() === true, webPlugin: () => null }));
vi.mock('../addons/runtime.js', () => ({ getAddonRuntime: async () => fixtures.runtime }));
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.resetModules(); });
const flush = () => new Promise(r => setTimeout(r, 0));

async function setup() {
  const calls = [];
  const torrentio = { key: 'torrentio', name: 'Torrentio', enabled: true, protocol: 'stremio', capabilities: ['streams'], resources: [{ name: 'stream', types: ['series', 'movie'], idPrefixes: ['tt', 'kitsu:'] }], types: ['series', 'movie'], bundled: false, compatibility: { apk: true, pwa: true } };
  const streams = vi.fn(async () => [{ infoHash: 'a'.repeat(40), name: 'Torrentio 1080p' }]);
  const enrich = vi.fn(async identity => ({ ...identity, externalIds: { ...identity.externalIds, kitsu: '7442' } }));
  fixtures.runtime = { ready: Promise.resolve(), runtimeName: 'apk', nativeCapabilities: () => ({ addonStreams: true, torrentSupported: true }), enrichAnimeIdentity: enrich, registry: { list: () => [torrentio], connection: () => ({ manifestUrl: 'https://torrentio.test/manifest.json' }) }, adapter: () => ({ streams }), sources: { source: () => null } };
  const plugin = {
    configure: async () => ({ ok: true }),
    prepare: async args => { calls.push(['prepare', args]); return { session: args.session, routes: [], done: false }; },
    appendAddonStreams: async args => { calls.push(['append', args]); return { added: 1 }; },
    closeSession: async () => calls.push(['close']),
    extend: async args => { calls.push(['extend', args]); return { added: args.copies.length }; },
    extendAddonSources: async args => { calls.push(['reserve', args]); return { added: args.sourceIds.length }; },
  };
  vi.stubGlobal('Capacitor', { getPlatform: () => 'android', isNativePlatform: () => true, Plugins: { AnimeEngine: plugin, AddonEngine: {} } });
  vi.stubGlobal('fetch', async () => ({ json: async () => ({ sources: [] }) }));
  return { api: await import('./anime-engine.js'), calls, streams, enrich };
}

const anime = { canonicalId: 'anime:21', kind: 'anime', format: 'TV', externalIds: { anilist: '21', kitsu: '12' }, episode: 3 };
const rift = { sourceId: 'addon|cs3|cs3_animerift', url: 'https://rift.example/work/1', title: 'One Piece', type: 'anime' };
const anime4up = { sourceId: 'anime4up', url: 'https://anime4up.example/anime/one-piece/', title: 'One Piece', type: 'anime' };

for (const [name, copy] of [['AnimeRift (CloudStream)', rift], ['Anime4Up (Aniyomi)', anime4up]]) {
  it(`${name}: a pinned session prepares only that source and never asks Torrentio`, async () => {
    const { api, calls, streams, enrich } = await setup();
    const out = await api.prepare({ copies: [copy], identity: anime, pinned: true, episode: 3, session: `pin-${copy.sourceId}` });
    await flush(); await flush();
    expect(out.copies.map(c => c.sourceId)).toEqual([copy.sourceId]);
    const prepared = calls.find(c => c[0] === 'prepare')[1];
    expect(prepared.copies.map(c => c.sourceId)).toEqual([copy.sourceId]);
    expect(prepared.addonSources).toEqual([]);
    expect(prepared.addonProviders).toEqual([]);
    // لا اكتشاف إضافات في الخلفية ولا انتظار له
    expect(enrich).not.toHaveBeenCalled();
    expect(streams).not.toHaveBeenCalled();
    expect(calls.some(c => c[0] === 'append' || c[0] === 'reserve')).toBe(false);
  });
}

it('a pinned session rejects late copies of other sources (late search results, addon discovery)', async () => {
  const { api, calls } = await setup();
  await api.prepare({ copies: [rift], identity: anime, pinned: true, episode: 3, session: 'pin-late' });
  const torrent = await api.withAddonCopies([], anime);
  expect(torrent.map(c => c.sourceId)).toEqual(['addon|torrentio']);
  expect(await api.extend('pin-late', [...torrent, anime4up])).toBe(0);
  expect(calls.some(c => c[0] === 'extend' || c[0] === 'reserve')).toBe(false);
  // نسخة المصدر نفسه (رابط حلقة تحدّث) مقبولة، بلا تكرار المصدر
  expect(await api.extend('pin-late', [{ ...rift, url: 'https://rift.example/work/1?v=2' }])).toBe(1);
  expect(calls.filter(c => c[0] === 'extend').flatMap(c => c[1].copies.map(x => x.sourceId))).toEqual([rift.sourceId]);
});

it('the general sheet (not pinned) still gathers Torrentio next to direct sources', async () => {
  const { api, calls } = await setup();
  const out = await api.prepare({ copies: [anime4up], identity: anime, episode: 3, session: 'general' });
  await flush(); await flush();
  expect(out.copies.map(c => c.sourceId)).toEqual(['anime4up', 'addon|torrentio']);
  expect(calls.find(c => c[0] === 'prepare')[1].addonSources).toEqual(['addon|torrentio']);
  expect(calls.some(c => c[0] === 'append' && c[1].sourceId === 'addon|torrentio')).toBe(true);
});

it('a pinned session does not wait for addon discovery before the source starts', async () => {
  const { api, calls } = await setup();
  let release;
  fixtures.runtime.enrichAnimeIdentity = () => new Promise(r => { release = r; });
  const noKitsu = { ...anime, externalIds: { anilist: '21' } };
  vi.useFakeTimers();
  const preparing = api.prepare({ copies: [rift], identity: noKitsu, pinned: true, episode: 3, session: 'pin-fast' });
  await vi.advanceTimersByTimeAsync(0);
  // بدأ المصدر قبل أي مهلة (ADDON_QUICK_MS) وبلا انتظار ربط الهوية
  expect(calls.some(c => c[0] === 'prepare')).toBe(true);
  await preparing;
  expect(release).toBeUndefined();
});
