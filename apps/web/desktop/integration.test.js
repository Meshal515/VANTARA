import { afterEach, expect, it, vi } from 'vitest';
import { installDesktopBridges } from './boot.js';
import { getAddonRuntime } from '../addons/runtime.js';
import * as anime from '../lib/anime-engine.js';
afterEach(() => vi.unstubAllGlobals());
it.each([
  { label: 'Torrentio hash', torrent: { infoHash: 'c'.repeat(40), fileIdx: 0 }, hash: 'c'.repeat(40) },
  { label: 'Base32 magnet URL', torrent: { url: 'magnet:?xt=urn:btih:AERUKZ4JVPG66AJDIVTYTK6N54ASGRLH&tr=udp%3A%2F%2Ftracker.example.com%3A80', fileIdx: 3 }, hash: '0123456789abcdef0123456789abcdef01234567' },
  { label: 'native magnet field', torrent: { magnet: `magnet:?xt=urn:btih:${'d'.repeat(40)}`, fileIdx: 7 }, hash: 'd'.repeat(40) },
])('يوصل هوية IMDb الدقيقة عبر registry وStremio وAnimeEngine إلى native بعد الاختيار فقط: $label', async ({torrent, hash}) => {
  const requests = [], starts = [], storage = new Map();
  const bridge = {
    platform: 'windows', version: '0.1.0-preview.1',
    requestResource: async args => {
      requests.push(args);
      const body = args.url.includes('/stream/') ? { streams: [{ ...torrent, name: 'Torrentio 2160p HDR', title: 'release.mkv', sources: ['tracker:udp://tracker.test:80'], subtitles: [{id:'ar',lang:'ar',url:'https://cdn.test/ar.vtt'}] }] }
        : { id: 'org.torrentio', name: 'Torrentio', version: '1.0.0', types: ['movie', 'series'], resources: ['stream'], catalogs: [] };
      return { text: JSON.stringify(body), status: 200 };
    },
    startPlayback: async args => { starts.push(args); return { started: true }; },
    stopPlayback: async () => {}, playbackCommand: async () => {}, onEvent: () => () => {},
  };
  vi.stubGlobal('VantaraDesktop', bridge);
  vi.stubGlobal('VantaraDesktopBridges', undefined);
  vi.stubGlobal('localStorage', { getItem: key => storage.get(key) ?? null, setItem: (key,val) => storage.set(key,val) });
  vi.stubGlobal('fetch', async () => ({ json: async () => ({ sources: [] }) }));
  installDesktopBridges();
  const addons = await getAddonRuntime(); await addons.ready;
  await addons.registry.install(await addons.registry.inspect('stremio://torrentio.test/config/manifest.json?token=keep'));
  await anime.configure({ force: true });
  const done = new Promise(resolve => anime.on('prepared', resolve));
  const prepared = await anime.prepare({ session: 'integration', copies: [], episode: 1, identity: { canonicalId: 'cinema:tt0137523', kind: 'movie', externalIds: { imdb: 'tt0137523' } } });
  await done;
  const snapshot = await anime.routes(prepared.session);
  expect(snapshot.routes[0].reason ?? null).toBeNull();
  expect(snapshot.routes).toMatchObject([{ state: 'READY', runtimeReady: true, quality: 2160, label: 'release.mkv' }]);
  expect(requests.some(args => args.url === 'https://torrentio.test/config/stream/movie/tt0137523.json?token=keep')).toBe(true);
  expect(starts).toEqual([]);
  const candidate = await anime.pick(prepared.session, snapshot.routes[0].id);
  await anime.open({ session: prepared.session, candidate, title: 'Fight Club', animeId: 'tt0137523', episode: 1, position: 42000 });
  expect(starts).toMatchObject([{ position: 42000, candidate: { infoHash: hash, type: 'torrent', fileIdx: torrent.fileIdx, quality: 2160, hdr: true, addonKey: 'https://torrentio.test|org.torrentio', sources: ['tracker:udp://tracker.test:80'], subtitles: [{lang:'ar',url:'https://cdn.test/ar.vtt'}] } }]);
  if (torrent.url || torrent.magnet) {
    expect(new URL(starts[0].candidate.magnet).searchParams.get('xt')).toBe(`urn:btih:${hash}`);
    expect(starts[0].candidate.url).toBeUndefined();
  }
  await anime.closeSession(prepared.session);
});
