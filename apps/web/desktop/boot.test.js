import { afterEach, expect, it, vi } from 'vitest';
import { parseHTML } from 'linkedom';
import { installDesktopBridges, renderInstallPreview } from './boot.js';
afterEach(() => vi.unstubAllGlobals());
it('يركب جسر AnimeEngine وAddonFabric قبل التطبيق دون اختلاق Capacitor', async () => {
  const callbacks = [];
  const g = { VantaraDesktop: { platform: 'windows', requestResource: async () => ({}), startPlayback: async () => ({ started: true }), onEvent: fn => { callbacks.push(fn); return () => {}; } } };
  const bridges = installDesktopBridges(g);
  expect(bridges.AnimeEngine).toBeTruthy();
  expect(bridges.AddonFabric.runtime).toBeTypeOf('function');
  expect(g.Capacitor).toBeUndefined();
  expect(g.VantaraWeb).toBeUndefined();
  expect(installDesktopBridges({})).toBeNull();
  expect(installDesktopBridges(g)).toBe(bridges);
});
it('يعرض preview من رابط التثبيت ولا يحفظ إلا بضغط المستخدم ولا يكشف الرابط المعد', async () => {
  const { document } = parseHTML('<html><body></body></html>');
  const saved = [];
  const preview = { manifest: { name: 'Torrentio', capabilities: ['streams'], contentTypes: ['movie'], compatibility: { desktop: true } } };
  const registry = { inspect: async () => preview, install: async item => { saved.push(item); return preview.manifest; } };
  const panel = await renderInstallPreview({ document, registry, url: 'stremio://torrentio.test/secret/manifest.json?key=hidden' });
  document.body.append(panel);
  expect(saved).toEqual([]);
  expect(panel.textContent).toContain('Torrentio');
  expect(panel.textContent).not.toContain('secret');
  expect(panel.innerHTML).not.toContain('hidden');
  [...panel.querySelectorAll('button')].find(b => b.textContent === 'تثبيت الإضافة').click();
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(saved).toEqual([preview]);
});
it('يعرض قياس السرب الحقيقي قبل ready ولا يخترع نسبة تحميل', () => {
  const { document } = parseHTML('<html><body></body></html>');
  const callbacks = [];
  const g = { document, VantaraDesktop: { platform: 'windows', requestResource: async () => ({}), startPlayback: async () => ({ started: true }), onEvent: fn => { callbacks.push(fn); return () => {}; } } };
  installDesktopBridges(g);
  const event = payload => callbacks.forEach(fn => fn(payload));
  event({ type: 'playback/preparing', session: 's' });
  event({ type: 'playback/progress', session: 's', downloadSpeed: 2097152, peers: 3, position: 0, duration: 0 });
  const status = document.querySelector('.desktop-playback-status');
  expect(status.hidden).toBe(false);
  expect(status.textContent).toContain('2.00');
  expect(status.textContent).toContain('3');
  expect(status.textContent).not.toContain('%');
  event({ type: 'playback/ready', session: 's' });
  event({ type: 'playback/progress', session: 's', position: 1000, duration: 10000 });
  expect(status.hidden).toBe(true);
});

it('جسر المانجا في ويندوز لا يعلن وظائف Mihon التي لا يملكها (كانت تظهر ثم تفشل بـ«وظيفة المصدر غير متاحة»)', () => {
  const g = { VantaraDesktop: { platform: 'windows', requestResource: async () => ({}), startPlayback: async () => ({}), onEvent: () => () => {} } };
  const { ExtensionEngine } = installDesktopBridges(g);
  for (const method of ['addRepo', 'repos', 'installExtension', 'uninstallExtension']) {
    expect(typeof ExtensionEngine[method]).toBe('undefined');
    expect(method in ExtensionEngine).toBe(false);
  }
  for (const method of ['sources', 'chapters', 'pages', 'image', 'cover', 'sites']) expect(typeof ExtensionEngine[method]).toBe('function');
});

it('ويندوز بمحرك Suwayomi: وظائف المستودعات تُعلن وتذهب للمحرك، ومصادر pkg#id تُوجَّه إليه، ومصادر الويب تبقى', async () => {
  const calls = [];
  const mangaEngine = async ({ method, args }) => {
    calls.push([method, args]);
    if (method === 'sources') return { sources: [{ id: 'eu.kanade.tachiyomi.extension.ar.teamx#7154', label: 'Team X', user: true }], stateRecovered: false };
    if (method === 'popular') return { mangas: [{ url: '/s', title: 'س' }], hasNextPage: false, page: 1 };
    return { ok: method };
  };
  const g = { VantaraDesktop: { platform: 'windows', mangaEngine, requestResource: async () => ({}), startPlayback: async () => ({}), onEvent: () => () => {} } };
  const { ExtensionEngine } = installDesktopBridges(g);
  for (const method of ['addRepo', 'repos', 'repoIndex', 'installExtension', 'uninstallExtension', 'rollbackExtension', 'updateState']) expect(method in ExtensionEngine).toBe(true);
  expect(await ExtensionEngine.addRepo({ url: 'https://repo.example' })).toEqual({ ok: 'addRepo' });
  expect(calls.at(-1)).toEqual(['addRepo', { url: 'https://repo.example' }]);
  expect((await ExtensionEngine.popular({ sourceId: 'eu.kanade.tachiyomi.extension.ar.teamx#7154', page: 1 })).mangas[0].title).toBe('س');
  // صورة من بروتوكول المحرك لا تمر عبر جلب الويب؛ وغلافه يعود كما هو
  await ExtensionEngine.image({ sourceId: 'x', page: { imageUrl: 'vantara-engine://suwayomi/manga/1/chapter/1/page/0' } });
  expect(calls.at(-1)[0]).toBe('image');
  expect(await ExtensionEngine.cover({ sourceId: 'x', url: 'vantara-engine://suwayomi/manga/1/thumbnail' })).toEqual({ path: 'vantara-engine://suwayomi/manga/1/thumbnail' });
  // مصادر الويب تفشل في بيئة الاختبار (لا runtime): مصادر المحرك تبقى ظاهرة
  const listed = await ExtensionEngine.sources();
  expect(listed.sources.map((s) => s.id)).toContain('eu.kanade.tachiyomi.extension.ar.teamx#7154');
});

it('التحقق في ويندوز بشكل إضافة الـAPK: المضيف المحجوب يُعلن، وbegin يفتح الصفحة الظاهرة ثم يزيله', async () => {
  const { createDesktopVerification } = await import('./boot.js');
  const { desktopChallenges } = await import('./source-fetcher.js');
  const calls = [];
  const plugin = createDesktopVerification({ verifySource: async (args) => { calls.push(args); return { host: args.host, state: 'verified' }; } });
  const required = [];
  const states = [];
  await plugin.addListener('required', (item) => required.push(item));
  await plugin.addListener('state', (item) => states.push(item));
  desktopChallenges.report('MangaLek.com');
  expect(required).toEqual([{ host: 'mangalek.com', state: 'required', kind: 'manga' }]);
  expect((await plugin.pending()).pending.map((x) => x.host)).toContain('mangalek.com');
  expect(await plugin.begin({ host: 'mangalek.com' })).toEqual({ host: 'mangalek.com', state: 'verified' });
  expect(calls).toEqual([{ host: 'mangalek.com' }]);
  expect(states.at(-1).state).toBe('verified');
  expect((await plugin.pending()).pending.map((x) => x.host)).not.toContain('mangalek.com');
  // بلا جسر نافذة (نسخة ويندوز قديمة): سبب واضح لا استثناء
  expect((await createDesktopVerification({}).begin({ host: 'x.com' })).reason).toBe('webview_unavailable');
});

it('صفحة تحقق بقيت بعد المتصفح المخفي تُسجَّل للمضيف وتقول سببها', async () => {
  const { createDesktopFetcher, desktopChallenges } = await import('./source-fetcher.js');
  const fetcher = createDesktopFetcher({ requestResource: async () => ({ status: 403, url: 'https://hizomanga.net/m/1', text: '<title>Just a moment...</title>' }) });
  await expect(fetcher.text('https://hizomanga.net/m/1')).rejects.toMatchObject({ code: 'challenge', host: 'hizomanga.net' });
  expect(desktopChallenges.pending().map((x) => x.host)).toContain('hizomanga.net');
});
it('إضافة Mihon طلب موقعها تحققًا (جسر Cloudflare في المحرك): تظهر في «تحتاج تحقق» بلا نافذة تُفتح وحدها', async () => {
  const callbacks = [];
  const verifySource = vi.fn();
  const g = { VantaraDesktop: { platform: 'windows', verifySource, requestResource: async () => ({}), startPlayback: async () => ({}), onEvent: fn => { callbacks.push(fn); return () => {}; } } };
  installDesktopBridges(g);
  const { desktopChallenges } = await import('./source-fetcher.js');
  for (const fn of callbacks) fn({ type: 'source-verification/required', host: 'Olympustaff.com' });
  for (const fn of callbacks) fn({ type: 'source-verification/required', host: 42 });
  expect(desktopChallenges.pending().map((x) => x.host)).toContain('olympustaff.com');
  expect(verifySource).not.toHaveBeenCalled();
  desktopChallenges.clear('olympustaff.com');
});
