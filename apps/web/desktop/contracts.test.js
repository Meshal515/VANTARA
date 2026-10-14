import { describe, expect, it } from 'vitest';
import { isDesktop, isNative, isWeb, desktopPlugin, webPlugin } from '../pwa/platform.js';
import { installWebBridges } from '../pwa/boot.js';
import { currentPlatform, supports } from '../lib/capabilities.js';
import { normalizeStreams } from '../addons/streams.js';
import { createAddonRuntime } from '../addons/runtime.js';

const bridge = { platform: 'windows', requestResource: async () => ({}), startPlayback: async () => ({ started: true }), onEvent: () => () => {} };
describe('عقود منصة ويندوز', () => {
  it('تعزل جسر desktop عن Android وPWA', () => {
    const g = { VantaraDesktop: bridge, VantaraDesktopBridges: { AnimeEngine: {} } };
    expect(isDesktop(g)).toBe(true);
    expect(isNative(g)).toBe(false);
    expect(isWeb(g)).toBe(false);
    expect(installWebBridges(g)).toBeNull();
    expect(webPlugin('AnimeEngine', g)).toBeNull();
    expect(desktopPlugin('AnimeEngine', g)).toBe(g.VantaraDesktopBridges.AnimeEngine);
    expect(currentPlatform(g)).toBe('desktop');
    expect(supports('nativePlayer', { platform: 'desktop' })).toBe(true);
    for (const capability of ['nativeSources', 'manga', 'rafiq', 'webSources', 'webInstall'])
      expect(supports(capability, { platform: 'desktop' })).toBe(false);
  });
  it('يقبل تورنت desktop فقط مع القدرة ويحفظ fileIdx صفر دون تخفيف PWA', () => {
    const raw = [{ infoHash: 'a'.repeat(40), fileIdx: 0, name: '1080p', sources: ['tracker:udp://tracker.test:80'] }];
    expect(normalizeStreams(raw, { runtimeName: 'desktop', torrentSupported: true })[0]).toMatchObject({ status: 'RESOLVED', type: 'torrent', fileIdx: 0, infoHash: 'a'.repeat(40) });
    expect(normalizeStreams(raw, { runtimeName: 'desktop' })[0].status).toBe('UNSUPPORTED');
    expect(normalizeStreams(raw, { runtimeName: 'pwa', torrentSupported: true })[0].status).toBe('UNSUPPORTED');
  });
  it('يمرر runtime desktop للتقييم والadapter وتصل نتيجة تورنت حقيقية', async () => {
    const memory = new Map();
    const store = { get: async (ns, key) => memory.get(`${ns}/${key}`), set: async (ns, key, value) => { memory.set(`${ns}/${key}`, { value }); return true; } };
    const runtime = { runtimeName: 'desktop', torrentSupported: true, store, ready: Promise.resolve(), registry: { list: () => [], def: () => null } };
    const addons = createAddonRuntime({ runtime, transport: { json: async url => url.endsWith('manifest.json') ? { id: 'org.torrentio', name: 'Torrentio', version: '1.0.0', resources: ['stream'], types: ['movie'], catalogs: [] } : { streams: [{ infoHash: 'b'.repeat(40), fileIdx: 0 }] } } });
    await addons.ready;
    const preview = await addons.registry.inspect('https://torrentio.test/config/manifest.json');
    await addons.registry.install(preview);
    const key = addons.registry.list()[0].key;
    expect(addons.runtimeName).toBe('desktop');
    expect(await addons.adapter(key).streams({ type: 'movie', videoId: 'tt123' })).toMatchObject([{ status: 'RESOLVED', infoHash: 'b'.repeat(40), fileIdx: 0 }]);
  });
});
