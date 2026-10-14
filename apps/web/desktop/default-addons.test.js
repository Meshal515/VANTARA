import { afterEach, expect, it, vi } from 'vitest';
import { createAddonRegistry } from '../addons/registry.js';
import { createDesktopStore } from './runtime.js';
import { startDesktopDefaultAddons } from './default-addons.js';

const manifests = {
  'https://torrentio.strem.fun/manifest.json': { id: 'com.stremio.torrentio.addon', name: 'Torrentio', resources: ['stream'] },
  'https://v3-cinemeta.strem.io/manifest.json': { id: 'com.linvo.cinemeta', name: 'Cinemeta', resources: ['catalog', 'meta'], catalogs: [{ id: 'top', type: 'movie' }] },
  'https://opensubtitles-v3.strem.io/manifest.json': { id: 'org.stremio.opensubtitlesv3', name: 'OpenSubtitles v3', resources: ['subtitles'] },
  'https://arabic-subtitle-stremio.lovable.app/api/public/manifest.json': { id: 'org.arabicsubs.combined', name: 'ترجمة عربية مجمعة', resources: ['subtitles'] },
};
const manifest = url => ({ version: '1.0.0', types: ['movie', 'series'], catalogs: [], ...manifests[url] });
const setup = (json = async url => manifest(url), store = createDesktopStore(null)) => {
  const requests = [];
  const registry = createAddonRegistry({ store, runtimeName: 'desktop', transport: { json: (...args) => { requests.push(args[0]); return json(...args); } } });
  return { runtime: { store, addons: { registry, ready: registry.ready } }, requests };
};
afterEach(() => vi.useRealTimers());

it('يثبت أربعة manifests عامة حقيقية عبر المعاينة دون حجب الإقلاع', async () => {
  const { runtime, requests } = setup();
  const statuses = [];
  const task = startDesktopDefaultAddons({ runtime, onStatus: row => statuses.push(row) });
  expect(runtime.addons.registry.list()).toEqual([]);
  await task.done;
  expect(requests.sort()).toEqual(Object.keys(manifests).sort());
  expect(runtime.addons.registry.list()).toHaveLength(4);
  expect(task.statuses().map(row => row.state)).toEqual(['installed', 'installed', 'installed', 'installed']);
  expect(statuses.filter(row => row.state === 'installed')).toHaveLength(4);
});

it('يحافظ على Torrentio المعد مسبقا ولو كان على مضيف آخر', async () => {
  const { runtime, requests } = setup(async url => manifest(url.includes('custom.test') ? 'https://torrentio.strem.fun/manifest.json' : url));
  await runtime.addons.ready;
  const custom = 'https://custom.test/private-config/manifest.json?key=private';
  const installed = await runtime.addons.registry.install(await runtime.addons.registry.inspect(custom));
  await runtime.addons.registry.enable(installed.key, false);
  const task = startDesktopDefaultAddons({ runtime });
  await task.done;
  expect(requests).not.toContain('https://torrentio.strem.fun/manifest.json');
  expect(runtime.addons.registry.list()).toHaveLength(4);
  expect(runtime.addons.registry.list().find(row => row.key === installed.key).enabled).toBe(false);
  await runtime.addons.registry.enable(installed.key, true);
  expect(runtime.addons.registry.connection(installed.key).manifestUrl).toBe(custom);
  expect(JSON.stringify(task.statuses())).not.toContain('private');
});

it('لا يعيد تثبيت المحذوف ولا يفعّل المعطّل بعد إعادة فتح التخزين', async () => {
  const { runtime } = setup();
  await startDesktopDefaultAddons({ runtime }).done;
  const [one, two] = runtime.addons.registry.list();
  await runtime.addons.registry.remove(one.key);
  await runtime.addons.registry.enable(two.key, false);
  const again = setup(undefined, runtime.store);
  await startDesktopDefaultAddons({ runtime: again.runtime }).done;
  expect(again.requests).toEqual([]);
  expect(again.runtime.addons.registry.list()).toHaveLength(3);
  expect(again.runtime.addons.registry.list().find(row => row.key === two.key).enabled).toBe(false);
});

it('يفصل فشل الشبكة ويثبت بيانات Torrentio الموثقة دون اختلاق جاهزية للمزودات الأخرى', async () => {
  let offline = true;
  const { runtime } = setup(async url => { if (offline) throw new Error('https://custom.test/private-token'); return manifest(url); });
  const task = startDesktopDefaultAddons({ runtime });
  await task.done;
  expect(runtime.addons.registry.list()).toHaveLength(1);
  expect(task.statuses().map(row => row.state)).toEqual(['bundled', 'failed', 'failed', 'failed']);
  expect(JSON.stringify(task.statuses())).not.toContain('private-token');
  offline = false;
  await task.retry();
  expect(runtime.addons.registry.list()).toHaveLength(4);
});

it('تنهي مهلة مزود عالق وتتجاهل manifest الذي يصل بعد المهلة', async () => {
  vi.useFakeTimers();
  let late;
  const { runtime } = setup(url => url.includes('torrentio') ? new Promise(resolve => { late = resolve; }) : manifest(url));
  const task = startDesktopDefaultAddons({ runtime, timeoutMs: 25 });
  await vi.advanceTimersByTimeAsync(30);
  await task.done;
  expect(task.statuses()[0]).toMatchObject({state:'bundled',connectionState:'timeout'});
  expect(runtime.addons.registry.list()).toHaveLength(4);
  late(manifest('https://torrentio.strem.fun/manifest.json'));
  await vi.advanceTimersByTimeAsync(1);
  expect(runtime.addons.registry.list()).toHaveLength(4);
});

it('يعرض طلب الإعداد دون تثبيت مزود يحتاج مفتاحا كإضافة جاهزة', async () => {
  const { runtime } = setup(async url => ({ ...manifest(url), ...(url.includes('torrentio') ? { behaviorHints: { configurable: true, configurationRequired: true } } : {}) }));
  const task = startDesktopDefaultAddons({ runtime });
  await task.done;
  expect(task.statuses()[0].state).toBe('setup');
  expect(runtime.addons.registry.list()).toHaveLength(3);
});

it('لا يثبت عند تعذر حفظ علامة التهيئة التي تحمي حذف المستخدم', async () => {
  const store = createDesktopStore(null), set = store.set;
  store.set = async (ns, key, ...args) => key === 'desktop.defaultAddons.v1' ? false : set(ns, key, ...args);
  const { runtime } = setup(undefined, store);
  const task = startDesktopDefaultAddons({ runtime });
  await task.done;
  expect(runtime.addons.registry.list()).toEqual([]);
  expect(task.statuses()).toHaveLength(4);
  expect(task.statuses().every(row => row.state === 'failed')).toBe(true);
});

it('يحفظ نتيجة كل مزود سليم عندما يرفض Torrentio الاتصال', async () => {
  const { runtime } = setup(async url => { if (url.includes('torrentio')) throw Object.assign(new Error('403'), { status: 403 }); return manifest(url); });
  const task = startDesktopDefaultAddons({ runtime, onStatus: () => { throw new Error('عرض معطوب'); } });
  await task.done;
  expect(runtime.addons.registry.list()).toHaveLength(4);
  expect(task.statuses()[0]).toMatchObject({ state: 'bundled', httpStatus: 403 });
  expect(task.statuses()[0].message).toContain('تعذر الاتصال');
  const torrentio=runtime.addons.registry.list().find(row=>row.id==='com.stremio.torrentio.addon');
  expect(torrentio).toMatchObject({version:'0.0.15',capabilities:['streams'],assessment:{level:'candidate'}});
  expect(torrentio.health.streams.state).not.toBe('healthy');
  const connection=runtime.addons.registry.connection(torrentio.key);
  expect(connection.manifestUrl).toBe('https://torrentio.strem.fun/manifest.json');
  expect(connection.manifest.catalogs).toEqual([]);
  expect(connection.manifest.types).toContain('anime');
});

it('يعيد المحاولة بعد إقلاع بدأ دون شبكة دون تجاوز خيارات المزودات الناجحة', async () => {
  const first = setup(async url => { if (url.includes('torrentio')) throw new Error('offline'); return manifest(url); });
  await startDesktopDefaultAddons({ runtime: first.runtime }).done;
  const again = setup(undefined, first.runtime.store);
  await startDesktopDefaultAddons({ runtime: again.runtime }).done;
  expect(again.requests).toEqual(['https://torrentio.strem.fun/manifest.json']);
  expect(again.runtime.addons.registry.list()).toHaveLength(4);
});

it('يلغي الجلب العالق ولا يثبت ردودا تصل بعد إغلاق الواجهة', async () => {
  let started;
  const requestStarted = new Promise(resolve => { started = resolve; });
  const { runtime } = setup(() => { started(); return new Promise(() => {}); });
  const task = startDesktopDefaultAddons({ runtime });
  await requestStarted;
  task.cancel();
  await task.done;
  expect(task.statuses().map(row => row.state)).toEqual(['cancelled', 'cancelled', 'cancelled', 'cancelled']);
  expect(runtime.addons.registry.list()).toEqual([]);
});

it('لا يحول فشل حفظ التثبيت إلى اختيار حذف دائم عند الإقلاع التالي', async () => {
  const store = createDesktopStore(null), set = store.set;
  store.set = async (ns, key, ...args) => key === 'addons.v1' ? false : set(ns, key, ...args);
  const first = setup(undefined, store);
  await startDesktopDefaultAddons({ runtime: first.runtime }).done;
  expect(first.runtime.addons.registry.list()).toEqual([]);
  store.set = set;
  const again = setup(undefined, store);
  await startDesktopDefaultAddons({ runtime: again.runtime }).done;
  expect(again.runtime.addons.registry.list()).toHaveLength(4);
});

it('لا يستبدل الرابط الذي يثبته المستخدم أثناء حفظ علامة التهيئة', async () => {
  const store = createDesktopStore(null), set = store.set;
  const custom = 'https://torrentio.strem.fun/private-config/manifest.json';
  const { runtime } = setup(async url => manifest(url === custom ? 'https://torrentio.strem.fun/manifest.json' : url), store);
  let intervened = false;
  store.set = async (ns, key, value, ...args) => {
    if (key === 'desktop.defaultAddons.v1' && value.providers.torrentio && !intervened) {
      intervened = true;
      await runtime.addons.registry.install(await runtime.addons.registry.inspect(custom));
    }
    return set(ns, key, value, ...args);
  };
  await startDesktopDefaultAddons({ runtime }).done;
  const torrentio = runtime.addons.registry.list().find(row => row.id === 'com.stremio.torrentio.addon');
  expect(runtime.addons.registry.connection(torrentio.key).manifestUrl).toBe(custom);
});

it('يحدّث نسخة Torrentio المضمّنة من manifest حي عند إعادة المحاولة الصريحة', async () => {
  let blocked=true;
  const {runtime,requests}=setup(async url=>{
    if(url.includes('torrentio')&&blocked)throw Object.assign(new Error('403'),{status:403});
    return manifest(url);
  });
  const task=startDesktopDefaultAddons({runtime});await task.done;
  expect(task.statuses()[0].state).toBe('bundled');
  blocked=false;
  await task.retry('torrentio');
  expect(requests.filter(url=>url.includes('torrentio'))).toHaveLength(2);
  expect(task.statuses()[0].state).toBe('installed');
  expect(runtime.addons.registry.list().find(row=>row.id==='com.stremio.torrentio.addon').version).toBe('1.0.0');
  expect(runtime.addons.registry.list().find(row=>row.id==='com.stremio.torrentio.addon').health.streams.state).not.toBe('healthy');
});

it('يحافظ على رابط المستخدم الذي يستبدل Torrentio المضمّن قبل إعادة المحاولة', async () => {
  let blocked=true;
  const custom='https://torrentio.strem.fun/private-config/manifest.json';
  const {runtime,requests}=setup(async url=>{
    if(url==='https://torrentio.strem.fun/manifest.json'&&blocked)throw Object.assign(new Error('403'),{status:403});
    return manifest(url===custom?'https://torrentio.strem.fun/manifest.json':url);
  });
  const task=startDesktopDefaultAddons({runtime});await task.done;
  expect(task.statuses()[0].state).toBe('bundled');
  const installed=await runtime.addons.registry.install(await runtime.addons.registry.inspect(custom));
  blocked=false;await task.retry('torrentio');
  expect(runtime.addons.registry.connection(installed.key).manifestUrl).toBe(custom);
  expect(requests.filter(url=>url==='https://torrentio.strem.fun/manifest.json')).toHaveLength(1);
  expect(task.statuses()[0].state).toBe('preserved');
});

it('يبقي خطأ النسخة المضمّنة بعد إعادة الإقلاع ولا يعيدها إذا حذفها المستخدم', async () => {
  const json=async url=>{if(url.includes('torrentio'))throw Object.assign(new Error('403'),{status:403});return manifest(url);};
  const first=setup(json);await startDesktopDefaultAddons({runtime:first.runtime}).done;
  const again=setup(json,first.runtime.store);
  const task=startDesktopDefaultAddons({runtime:again.runtime});await task.done;
  expect(task.statuses()[0]).toMatchObject({state:'bundled',httpStatus:403});
  const torrentio=again.runtime.addons.registry.list().find(row=>row.id==='com.stremio.torrentio.addon');
  await again.runtime.addons.registry.remove(torrentio.key);
  const third=setup(json,first.runtime.store);await startDesktopDefaultAddons({runtime:third.runtime}).done;
  expect(third.requests).not.toContain('https://torrentio.strem.fun/manifest.json');
  expect(third.runtime.addons.registry.list()).toHaveLength(3);
});

it('لا يعيد النسخة المضمّنة إذا حذفها المستخدم ثم ضغط إعادة المحاولة في نفس الجلسة', async () => {
  const {runtime,requests}=setup(async url=>{if(url.includes('torrentio'))throw Object.assign(new Error('403'),{status:403});return manifest(url);});
  const task=startDesktopDefaultAddons({runtime});await task.done;
  expect(task.statuses()[0].state).toBe('bundled');
  const torrentio=runtime.addons.registry.list().find(row=>row.id==='com.stremio.torrentio.addon');
  await runtime.addons.registry.remove(torrentio.key);
  await task.retry('torrentio');
  expect(requests.filter(url=>url.includes('torrentio'))).toHaveLength(1);
  expect(runtime.addons.registry.list()).toHaveLength(3);
  expect(task.statuses()[0].state).toBe('skipped');
});
