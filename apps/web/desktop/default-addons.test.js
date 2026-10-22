import { afterEach, expect, it, vi } from 'vitest';
import { createAddonRegistry } from '../addons/registry.js';
import { createDesktopStore } from './runtime.js';
import { startDesktopDefaultAddons } from './default-addons.js';

const TORRENTIO_URL = 'https://torrentio.strem.fun/manifest.json';
const CINEMETA_URL = 'https://v3-cinemeta.strem.io/manifest.json';
const manifests = {
  [TORRENTIO_URL]: { id: 'com.stremio.torrentio.addon', name: 'Torrentio', resources: ['stream'] },
  [CINEMETA_URL]: { id: 'com.linvo.cinemeta', name: 'Cinemeta', resources: ['catalog', 'meta'], catalogs: [{ id: 'top', type: 'movie' }] },
  'https://opensubtitles-v3.strem.io/manifest.json': { id: 'org.stremio.opensubtitlesv3', name: 'OpenSubtitles v3', resources: ['subtitles'] },
  'https://arabic-subtitle-stremio.lovable.app/api/public/manifest.json': { id: 'org.arabicsubs.combined', name: 'ترجمة عربية مجمعة', resources: ['subtitles'] },
};
const defaultUrls = Object.keys(manifests).filter(url => url !== TORRENTIO_URL);
const manifest = url => ({ version: '1.0.0', types: ['movie', 'series'], catalogs: [], ...manifests[url] });
const setup = (json = async url => manifest(url), store = createDesktopStore(null)) => {
  const requests = [];
  const registry = createAddonRegistry({ store, runtimeName: 'desktop', transport: { json: (...args) => { requests.push(args[0]); return json(...args); } } });
  return { runtime: { store, addons: { registry, ready: registry.ready } }, requests };
};
afterEach(() => vi.useRealTimers());

it('installs the three existing public defaults without requesting Torrentio or blocking startup', async () => {
  const { runtime, requests } = setup(), statuses = [];
  const task = startDesktopDefaultAddons({ runtime, onStatus: row => statuses.push(row) });
  expect(runtime.addons.registry.list()).toEqual([]);
  await task.done;
  expect(requests.sort()).toEqual(defaultUrls.sort());
  expect(runtime.addons.registry.list()).toHaveLength(3);
  expect(task.statuses().map(row => row.state)).toEqual(['setup', 'installed', 'installed', 'installed']);
  expect(task.statuses()[0].configureUrl).toBe('https://torrentio.strem.fun/configure');
  expect(statuses.filter(row => row.state === 'installed')).toHaveLength(3);
  expect(statuses.filter(row => row.id === 'torrentio').map(row => row.state)).toEqual(['setup']);
});

it.each([true, false])('preserves an existing configured Torrentio with enabled=%s without fetching its private URL', async enabled => {
  const custom = 'https://custom.test/private-config/manifest.json?key=private';
  const { runtime, requests } = setup(async url => manifest(url === custom ? TORRENTIO_URL : url));
  await runtime.addons.ready;
  const installed = await runtime.addons.registry.install(await runtime.addons.registry.inspect(custom));
  await runtime.addons.registry.enable(installed.key, enabled);
  await runtime.addons.registry.pin(installed.key, true);
  runtime.addons.registry.health.failure(installed.key, 'streams', 'desktop', 'TIMEOUT');
  const before = runtime.addons.registry.list().find(row => row.key === installed.key);
  requests.length = 0;
  const task = startDesktopDefaultAddons({ runtime }); await task.done;
  await task.retry('torrentio');
  expect(requests.sort()).toEqual(defaultUrls.sort());
  expect(runtime.addons.registry.list().find(row => row.key === installed.key)).toEqual(before);
  expect(task.statuses()[0].state).toBe('preserved');
  expect(JSON.stringify(task.statuses())).not.toContain('private');
  await runtime.addons.registry.enable(installed.key, true);
  expect(runtime.addons.registry.connection(installed.key).manifestUrl).toBe(custom);
});

it('does not reinstall a removed default or enable a disabled one after reopening storage', async () => {
  const { runtime } = setup(); await startDesktopDefaultAddons({ runtime }).done;
  const [one, two] = runtime.addons.registry.list();
  await runtime.addons.registry.remove(one.key); await runtime.addons.registry.enable(two.key, false);
  const again = setup(undefined, runtime.store); await startDesktopDefaultAddons({ runtime: again.runtime }).done;
  expect(again.requests).toEqual([]);
  expect(again.runtime.addons.registry.list()).toHaveLength(2);
  expect(again.runtime.addons.registry.list().find(row => row.key === two.key).enabled).toBe(false);
});

it('keeps failed default fetches uninstalled and never fabricates a Torrentio fallback', async () => {
  let offline = true;
  const { runtime, requests } = setup(async url => { if (offline) throw new Error('https://custom.test/private-token'); return manifest(url); });
  const task = startDesktopDefaultAddons({ runtime }); await task.done;
  expect(runtime.addons.registry.list()).toEqual([]);
  expect(task.statuses().map(row => row.state)).toEqual(['setup', 'failed', 'failed', 'failed']);
  expect(JSON.stringify(task.statuses())).not.toContain('private-token');
  offline = false; await task.retry();
  expect(runtime.addons.registry.list()).toHaveLength(3);
  expect(requests).not.toContain(TORRENTIO_URL);
});

it('times out a stalled default and ignores a manifest arriving after its timeout', async () => {
  vi.useFakeTimers(); let late;
  const { runtime } = setup(url => url === CINEMETA_URL ? new Promise(resolve => { late = resolve; }) : manifest(url));
  const task = startDesktopDefaultAddons({ runtime, timeoutMs: 25 });
  await vi.advanceTimersByTimeAsync(30); await task.done;
  expect(task.statuses()[1].state).toBe('timeout');
  expect(runtime.addons.registry.list()).toHaveLength(2);
  late(manifest(CINEMETA_URL)); await vi.advanceTimersByTimeAsync(1);
  expect(runtime.addons.registry.list()).toHaveLength(2);
  expect(runtime.addons.registry.list().some(row => row.id === manifests[TORRENTIO_URL].id)).toBe(false);
});

it('does not install another default whose live manifest requires configuration', async () => {
  const { runtime } = setup(async url => ({ ...manifest(url), ...(url === CINEMETA_URL ? { behaviorHints: { configurable: true, configurationRequired: true } } : {}) }));
  const task = startDesktopDefaultAddons({ runtime }); await task.done;
  expect(task.statuses()[1].state).toBe('setup');
  expect(runtime.addons.registry.list()).toHaveLength(2);
});

it('does not install defaults when the marker protecting user removals cannot be saved', async () => {
  const store = createDesktopStore(null), set = store.set;
  store.set = async (ns, key, ...args) => key === 'desktop.defaultAddons.v1' ? false : set(ns, key, ...args);
  const { runtime } = setup(undefined, store); const task = startDesktopDefaultAddons({ runtime }); await task.done;
  expect(runtime.addons.registry.list()).toEqual([]);
  expect(task.statuses().map(row => row.state)).toEqual(['setup', 'failed', 'failed', 'failed']);
});

it('retains successful defaults when one rejects a request and safely reports HTTP status', async () => {
  const { runtime } = setup(async url => { if (url === CINEMETA_URL) throw Object.assign(new Error('403'), { status: 403 }); return manifest(url); });
  const task = startDesktopDefaultAddons({ runtime, onStatus: () => { throw new Error('broken renderer'); } }); await task.done;
  expect(runtime.addons.registry.list()).toHaveLength(2);
  expect(task.statuses()[1]).toMatchObject({ state: 'failed', httpStatus: 403 });
});

it('retries a failed default on the next startup without refetching successful providers', async () => {
  const first = setup(async url => { if (url === CINEMETA_URL) throw new Error('offline'); return manifest(url); });
  await startDesktopDefaultAddons({ runtime: first.runtime }).done;
  const again = setup(undefined, first.runtime.store); await startDesktopDefaultAddons({ runtime: again.runtime }).done;
  expect(again.requests).toEqual([CINEMETA_URL]);
  expect(again.runtime.addons.registry.list()).toHaveLength(3);
});

it('cancels stalled default requests without late installations', async () => {
  let started; const requestStarted = new Promise(resolve => { started = resolve; });
  const { runtime } = setup(() => { started(); return new Promise(() => {}); });
  const task = startDesktopDefaultAddons({ runtime }); await requestStarted; task.cancel(); await task.done;
  expect(task.statuses().map(row => row.state)).toEqual(['setup', 'cancelled', 'cancelled', 'cancelled']);
  expect(runtime.addons.registry.list()).toEqual([]);
});

it('allows a default installation rejected by storage to retry at the next startup', async () => {
  const store = createDesktopStore(null), set = store.set;
  store.set = async (ns, key, ...args) => key === 'addons.v1' ? false : set(ns, key, ...args);
  const first = setup(undefined, store); await startDesktopDefaultAddons({ runtime: first.runtime }).done;
  expect(first.runtime.addons.registry.list()).toEqual([]);
  store.set = set;
  const again = setup(undefined, store); await startDesktopDefaultAddons({ runtime: again.runtime }).done;
  expect(again.runtime.addons.registry.list()).toHaveLength(3);
});

it('preserves a user-configured provider installed while a default marker write is pending', async () => {
  const store = createDesktopStore(null), set = store.set, custom = 'https://v3-cinemeta.strem.io/private-config/manifest.json';
  const { runtime } = setup(async url => manifest(url === custom ? CINEMETA_URL : url), store);
  let intervened = false;
  store.set = async (ns, key, value, ...args) => {
    if (key === 'desktop.defaultAddons.v1' && value.providers.cinemeta && !intervened) {
      intervened = true; await runtime.addons.registry.install(await runtime.addons.registry.inspect(custom));
    }
    return set(ns, key, value, ...args);
  };
  await startDesktopDefaultAddons({ runtime }).done;
  const installed = runtime.addons.registry.list().find(row => row.id === manifests[CINEMETA_URL].id);
  expect(runtime.addons.registry.connection(installed.key).manifestUrl).toBe(custom);
});

it.each([false, true])('ignores old Torrentio fallback markers without inventing a removed install (marked=%s)', async marked => {
  const store = createDesktopStore(null);
  await store.set('state', 'desktop.defaultAddons.v1', { version: 2, providers: { torrentio: marked }, bundled: { torrentio: { key: `https://torrentio.strem.fun|${manifests[TORRENTIO_URL].id}`, epoch: 'old', connectionState: 'failed', httpStatus: 403 } } });
  const { runtime, requests } = setup(undefined, store); const task = startDesktopDefaultAddons({ runtime }); await task.done; await task.retry('torrentio');
  expect(requests).not.toContain(TORRENTIO_URL);
  expect(task.statuses()[0].state).toBe('setup');
  expect(runtime.addons.registry.list()).toHaveLength(3);
});

it('preserves an already installed old fallback unchanged and never silently upgrades it', async () => {
  const { runtime, requests } = setup(); await runtime.addons.ready;
  const installed = await runtime.addons.registry.install(await runtime.addons.registry.inspect(TORRENTIO_URL));
  await runtime.store.set('state', 'desktop.defaultAddons.v1', { version: 2, providers: { torrentio: true }, bundled: { torrentio: { key: installed.key, epoch: installed.cacheEpoch, connectionState: 'failed', httpStatus: 403 } } });
  const before = runtime.addons.registry.list().find(row => row.key === installed.key); requests.length = 0;
  const task = startDesktopDefaultAddons({ runtime }); await task.done; await task.retry('torrentio');
  expect(requests).not.toContain(TORRENTIO_URL);
  expect(task.statuses()[0].state).toBe('preserved');
  expect(runtime.addons.registry.list().find(row => row.key === installed.key)).toEqual(before);
  await runtime.addons.registry.remove(installed.key); await task.retry('torrentio');
  expect(task.statuses()[0].state).toBe('setup');
  expect(runtime.addons.registry.list()).toHaveLength(3);
});

it('recognizes a user installation after Explore configuration without a Torrentio startup refetch', async () => {
  const custom = 'https://torrentio.strem.fun/private-config/manifest.json?key=private';
  const { runtime, requests } = setup(async url => manifest(url === custom ? TORRENTIO_URL : url));
  const task = startDesktopDefaultAddons({ runtime }); await task.done;
  const installed = await runtime.addons.registry.install(await runtime.addons.registry.inspect(custom));
  requests.length = 0; await task.retry('torrentio');
  expect(requests).toEqual([]); expect(task.statuses()[0].state).toBe('preserved');
  expect(runtime.addons.registry.connection(installed.key).manifestUrl).toBe(custom);
});

it('does not treat an unrelated addon on the same host as an installed Torrentio', async () => {
  const unrelated = 'https://torrentio.strem.fun/other/manifest.json';
  const { runtime, requests } = setup(async url => url === unrelated ? { ...manifest(TORRENTIO_URL), id: 'org.other.streams', name: 'Other' } : manifest(url));
  await runtime.addons.ready; const installed = await runtime.addons.registry.install(await runtime.addons.registry.inspect(unrelated));
  requests.length = 0; const task = startDesktopDefaultAddons({ runtime }); await task.done;
  expect(requests).not.toContain(TORRENTIO_URL);
  expect(runtime.addons.registry.list()).toHaveLength(4);
  expect(runtime.addons.registry.connection(installed.key).manifestUrl).toBe(unrelated);
  expect(task.statuses()[0].state).toBe('setup');
});

it('rejects a default manifest with another provider ID instead of installing it', async () => {
  const { runtime } = setup(async url => ({ ...manifest(url), ...(url.includes('opensubtitles') ? { id: 'org.other.subtitles' } : {}) }));
  const task = startDesktopDefaultAddons({ runtime }); await task.done;
  expect(task.statuses()[2].state).toBe('failed');
  expect(runtime.addons.registry.list().some(row => row.id === 'org.other.subtitles')).toBe(false);
});
