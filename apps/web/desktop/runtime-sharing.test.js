import { afterEach, expect, it, vi } from 'vitest';
import { parseHTML } from 'linkedom';
import { getRuntime } from './runtime.js';
import { installDesktopBridges } from './boot.js';
import { createDesktopApp } from './app.js';
afterEach(() => vi.unstubAllGlobals());

function context() {
  const { window, document } = parseHTML('<html><body><div id="root"></div></body></html>');
  const memory = new Map(), callbacks = [], starts = [];
  const g = { window, document, localStorage: { getItem: key => memory.get(key) ?? null, setItem: (key, val) => memory.set(key,val) }, VantaraDesktop: {
    platform: 'windows',
    requestResource: async ({ url }) => ({ status: 200, text: JSON.stringify(url.includes('/stream/') ? { streams: [{ infoHash: 'd'.repeat(40), fileIdx: 0, name: 'Torrentio 1080p' }] } : { id: 'org.torrentio', name: 'Torrentio', version: '1.0.0', types: ['movie'], resources: ['stream'], catalogs: [] }) }),
    startPlayback: async args => { starts.push(args); return { started: true }; }, stopPlayback: async () => {},
    onEvent: fn => { callbacks.push(fn); return () => {}; },
  } };
  return { g, starts, emit: event => callbacks.forEach(fn => fn(event)) };
}
const until = async predicate => { for (let n=0; n<50 && !predicate(); n++) await new Promise(resolve => setTimeout(resolve, 0)); expect(predicate()).toBeTruthy(); };

it('يشارك UI وconfigured-install وplayback سجلًا واحدًا حتى لو بدأ UI أولًا', async () => {
  const { g, starts, emit } = context();
  vi.stubGlobal('document', g.document); vi.stubGlobal('window', g.window); vi.stubGlobal('localStorage', g.localStorage); vi.stubGlobal('VantaraDesktop', g.VantaraDesktop);
  const uiRuntime = getRuntime(g);
  const app = await createDesktopApp({ root: g.document.getElementById('root'), runtime: uiRuntime });
  const bridges = installDesktopBridges(g);
  emit({ type: 'addon/install', url: 'stremio://torrentio.test/config/manifest.json?token=secret' });
  await until(() => [...g.document.querySelectorAll('.desktop-install button')].some(b => b.textContent === 'تثبيت الإضافة'));
  [...g.document.querySelectorAll('.desktop-install button')].find(b => b.textContent === 'تثبيت الإضافة').click();
  await until(() => g.document.querySelector('.desktop-install')?.textContent.includes('حُفظت الإضافة'));
  expect(uiRuntime.addons.registry.list()).toMatchObject([{ name: 'Torrentio' }]);
  expect((await bridges.AddonFabric.runtime()).getRuntime()).toBe(uiRuntime);
  await app.openAddons();
  // V7 initially shows repositories; installed additions live on their own tab.
  const addonView = g.document.querySelector('.v7-addon');
  expect(addonView).toBeTruthy();
  const installedTab = addonView.querySelectorAll('.v7-tab')[1];
  expect(installedTab.textContent).toContain('المثبتة');
  installedTab.click();
  expect(addonView.textContent).toContain('Torrentio');
  const key = uiRuntime.addons.registry.list()[0].key;
  const done = new Promise(resolve => bridges.AnimeEngine.addListener('prepared', resolve));
  await bridges.AnimeEngine.prepare({ session: 'shared', episode: 1, copies: [{ sourceId: `addon|${key}`, id: 'tt0137523', url: 'tt0137523', type: 'movie' }] });
  await done;
  const { candidate } = await bridges.AnimeEngine.best({ session: 'shared' });
  await bridges.AnimeEngine.play({ session: 'shared', candidate, title: 'Fight Club' });
  expect(starts).toMatchObject([{ candidate: { type: 'torrent', fileIdx: 0, infoHash: 'd'.repeat(40) } }]);
  await bridges.AnimeEngine.closeSession({ session: 'shared' }); app.close();
});
it('يعزل runtime حسب سياق الجسر ولا يسرّب إضافات سياق سابق إلى اختبار آخر', async () => {
  const one = context(), two = context();
  const first = getRuntime(one.g), second = getRuntime(two.g);
  expect(first).not.toBe(second);
  expect(getRuntime(one.g)).toBe(first);
  await first.addons.registry.install(await first.addons.registry.inspect('https://torrentio.test/manifest.json'));
  await second.addons.ready;
  expect(second.addons.registry.list()).toEqual([]);
});
it('يرفض سياقًا بلا جسر بدل استعمال runtime سابق', () => {
  expect(() => getRuntime({})).toThrow('جسر شبكة ويندوز غير متاح');
});
