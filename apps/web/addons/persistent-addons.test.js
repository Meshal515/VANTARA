/**
 * إضافات Stremio/Remote على الويب والويندوز: النسخة المثبتة مستقلة عن رابطها
 * (docs/addons/PERSISTENT_PLUGINS.md §3.1، §3.3، قرار 22).
 */
import { describe, expect, it } from 'vitest';
import { createAddonRegistry, DOWNGRADE_REFUSED, OUT_OF_REPOSITORY, PROBATION_FAILS } from './registry.js';
import { createStore } from '../pwa/cache/store.js';
import { createAddonRuntime } from './runtime.js';
import { createHostBreaker, HOST_COOLING } from '../lib/host-breaker.js';

const raw = (version = '1.0.0', extra = {}) => ({ id: 'org.demo', name: 'Demo', version, types: ['series'], resources: ['stream'], catalogs: [], ...extra });
const flush = async () => { for (let i = 0; i < 20; i += 1) await new Promise((r) => setTimeout(r, 0)); };

function setup() {
  let reply = () => raw('1.0.0');
  let t = 1_000_000;
  const store = createStore({ indexedDB: null });
  const transport = { json: async () => reply(), text: async () => JSON.stringify(reply()) };
  const make = () => createAddonRegistry({ store, transport, clock: () => t });
  return { store, make, set: (fn) => (reply = fn), advance: (ms) => (t += ms) };
}
const httpError = (status) => Object.assign(new Error(`الإضافة أعادت HTTP ${status}`), { status });

describe('the add-on keeps working when its repository link disappears', () => {
  it('404/410 on update check marks it «not in its repository» and keeps the installed copy active', async () => {
    const { make, set } = setup();
    const r = make();
    await r.ready;
    const one = await r.install(await r.inspect('https://addon.test/manifest.json'));
    set(() => { throw httpError(404); });
    await expect(r.stage(one.key)).rejects.toMatchObject({ status: 404 });
    expect(r.list()[0]).toMatchObject({ version: '1.0.0', inRepository: false, upstream: { state: 'missing', reason: OUT_OF_REPOSITORY } });
    expect(r.connection(one.key).manifest.version).toBe('1.0.0');
    // يبقى بعد إعادة التشغيل، بلا أي طلب شبكة
    const again = make();
    await again.ready;
    expect(again.list()[0]).toMatchObject({ version: '1.0.0', inRepository: false });
    expect(again.connection(one.key).manifest.name).toBe('Demo');
    // الرابط عاد ⇒ تُرفع العلامة
    set(() => raw('1.0.0'));
    await again.stage(one.key);
    expect(again.list()[0].inRepository).toBe(true);
  });

  it('a failed reinstall (404, HTML page, network) never removes or replaces the working copy', async () => {
    const { make, set } = setup();
    const r = make();
    await r.ready;
    const one = await r.install(await r.inspect('https://addon.test/manifest.json'));
    for (const failure of [() => { throw httpError(410); }, () => { throw new Error('الإضافة لم تُرجع JSON صالحًا'); }, () => { throw new Error('تعذّر الاتصال بالإضافة'); }]) {
      set(failure);
      await expect(r.reinstall(one.key)).rejects.toThrow();
      expect(r.connection(one.key).manifest.version).toBe('1.0.0');
    }
  });
});

describe('verified update: no downgrade, LKG, atomic switch', () => {
  it('an older version from the repository is refused at stage, reinstall and install', async () => {
    const { make, set } = setup();
    const r = make();
    await r.ready;
    set(() => raw('2.0.0'));
    const one = await r.install(await r.inspect('https://addon.test/manifest.json'));
    set(() => raw('1.9.0'));
    expect(await r.stage(one.key)).toMatchObject({ changed: false, refused: DOWNGRADE_REFUSED });
    expect(r.list()[0].stagedVersion).toBeNull();
    await expect(r.reinstall(one.key)).rejects.toMatchObject({ code: DOWNGRADE_REFUSED });
    await expect(r.install(await r.inspect('https://addon.test/manifest.json'))).rejects.toMatchObject({ code: DOWNGRADE_REFUSED });
    expect(r.connection(one.key).manifest.version).toBe('2.0.0');
    // الرجوع المشروع: النسخة السابقة المحلية فقط
    set(() => raw('2.1.0'));
    await r.stage(one.key);
    await r.activateStaged(one.key);
    await r.rollback(one.key);
    expect(r.connection(one.key).manifest.version).toBe('2.0.0');
  });

  it('a corrupted active manifest on disk (sha256 mismatch) falls back to the previous good copy', async () => {
    const { make, set, store } = setup();
    const r = make();
    await r.ready;
    const one = await r.install(await r.inspect('https://addon.test/manifest.json'));
    set(() => raw('2.0.0'));
    await r.stage(one.key);
    await r.activateStaged(one.key);
    await flush();
    const rows = (await store.get('state', 'addons.v1')).value;
    expect(rows[0].sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0].previous.sha256).toMatch(/^[0-9a-f]{64}$/);
    rows[0].manifestRaw = { ...rows[0].manifestRaw, name: 'Tampered' };
    await store.set('state', 'addons.v1', rows);
    const again = make();
    await again.ready;
    expect(again.list()[0]).toMatchObject({ version: '1.0.0', name: 'Demo', restored: { to: '1.0.0' } });
    expect(again.list()[0].restored.reason).toMatch(/تالفة/);
  });

  it('a saved add-on this build cannot read is kept on disk, never silently deleted by the next save', async () => {
    const { make, store } = setup();
    const r = make();
    await r.ready;
    await r.install(await r.inspect('https://addon.test/manifest.json'));
    const rows = (await store.get('state', 'addons.v1')).value;
    const future = { ...rows[0], manifest: { ...rows[0].manifest, key: 'https://future.test|org.future' }, url: 'https://future.test/manifest.json', manifestRaw: { id: 'org.future', name: 'Future', version: 'not-semver' }, previous: null };
    await store.set('state', 'addons.v1', [...rows, future]);
    const again = make();
    await again.ready;
    expect(again.list()).toHaveLength(1);
    await again.enable(again.list()[0].key, false);
    const saved = (await store.get('state', 'addons.v1')).value;
    expect(saved).toHaveLength(2);
    expect(saved[1].manifestRaw.name).toBe('Future');
  });

  it('after activation, repeated contract failures roll back automatically with an Arabic reason; site failures do not', async () => {
    const { make, set, advance } = setup();
    const r = make();
    await r.ready;
    const one = await r.install(await r.inspect('https://addon.test/manifest.json'));
    set(() => raw('2.0.0'));
    await r.stage(one.key);
    await r.activateStaged(one.key);
    for (let i = 0; i < 10; i += 1) await r.observe(one.key, { ok: false, structural: false });
    expect(r.connection(one.key).manifest.version).toBe('2.0.0');
    for (let i = 0; i < PROBATION_FAILS - 1; i += 1) await r.observe(one.key, { ok: false, structural: true });
    await r.observe(one.key, { ok: true });
    await r.observe(one.key, { ok: false, structural: true });
    expect(r.connection(one.key).manifest.version).toBe('2.0.0');
    for (let i = 0; i < PROBATION_FAILS; i += 1) await r.observe(one.key, { ok: false, structural: true });
    expect(r.connection(one.key).manifest.version).toBe('1.0.0');
    expect(r.list()[0].restored.reason).toMatch(/عادت النسخة السابقة 1\.0\.0 تلقائيًا/);
    // خارج نافذة المراقبة لا رجوع تلقائي
    set(() => raw('3.0.0'));
    await r.stage(one.key);
    await r.activateStaged(one.key);
    advance(31 * 60 * 1000);
    for (let i = 0; i < 5; i += 1) await r.observe(one.key, { ok: false, structural: true });
    expect(r.connection(one.key).manifest.version).toBe('3.0.0');
  });
});

describe('Stremio secrets stay out of anything that leaves the device (decision 22)', () => {
  it('a debrid key in the manifest URL never appears in the list, keys, source ids or errors', async () => {
    const { make, set } = setup();
    const r = make();
    await r.ready;
    const secret = 'realdebrid=SECRETKEY123';
    const one = await r.install(await r.inspect(`https://torrentio.test/${secret}/manifest.json`));
    expect(one.key).not.toContain('SECRETKEY123');
    expect(JSON.stringify(r.list())).not.toContain('SECRETKEY123');
    set(() => { throw httpError(404); });
    const error = await r.stage(one.key).catch((e) => e);
    expect(String(error.message)).not.toContain('SECRETKEY123');
    expect(JSON.stringify(r.list())).not.toContain('SECRETKEY123');
  });
});

describe('add-on runtime: per-host breaker in front of every add-on request', () => {
  it('a site answering 429 + Retry-After gets no more requests; the failure is not blamed on the add-on', async () => {
    let calls = 0;
    const manifest = { id: 'org.cat', name: 'Cat', version: '1.0.0', types: ['movie'], resources: ['catalog'], catalogs: [{ type: 'movie', id: 'top' }] };
    const transport = {
      async json(url) {
        if (url.endsWith('/manifest.json')) return manifest;
        calls += 1;
        throw Object.assign(new Error('الإضافة أعادت HTTP 429'), { status: 429, retryAfter: '120' });
      },
      async text() { throw new Error('unused'); },
    };
    const store = createStore({ indexedDB: null });
    const runtime = { ready: Promise.resolve(), registry: { list: () => [], def: () => null, source: () => null } };
    const addons = createAddonRuntime({ runtime, store, transport, breaker: createHostBreaker() });
    await addons.ready;
    const preview = await addons.registry.inspect('https://cat.test/manifest.json');
    const installed = await addons.registry.install(preview);
    const adapter = addons.adapter(installed.key);
    const first = await adapter.catalog({ type: 'movie', id: 'top' }).catch((e) => e);
    expect(first.status).toBe(429);
    const second = await adapter.catalog({ type: 'movie', id: 'top' }).catch((e) => e);
    expect(second.code).toBe(HOST_COOLING);
    expect(second.message).toContain('الخلل من الموقع لا من VANTARA');
    expect(calls).toBe(1);
  });
});
