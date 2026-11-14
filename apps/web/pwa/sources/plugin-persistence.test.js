/**
 * الإضافة المثبتة مستقلة تشغيليًا عن مستودعها — سجل مصادر الويب (docs/addons/PERSISTENT_PLUGINS.md).
 * «المستودع» هنا حزمة التعريفات defs.json، والنسخ المحلية في Plugin Vault (قاعدة لا تُكنس).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createStore } from '../cache/store.js';
import { createRegistry, DOWNGRADE_REFUSED, OUT_OF_REPOSITORY } from './registry.js';
import { ENGINES } from './engines/index.js';
import { loadDefs, VAULT_SPACES } from '../runtime.js';

const fake = {
  kind: 'fake',
  content: 'manga',
  create(def) {
    const ok = def.config?.works !== false;
    const fail = async () => { throw new Error('broken selectors'); };
    return {
      search: ok ? async () => ({ mangas: [{ url: '1', title: 'One' }], hasNextPage: false }) : fail,
      popular: ok ? async () => ({ mangas: [{ url: '1', title: 'One' }], hasNextPage: false }) : fail,
      series: ok ? async () => ({ manga: { url: '1', title: 'One' }, chapters: [{ url: 'c1', name: '1' }] }) : fail,
      pages: ok ? async () => [{ index: 0, url: 'x', imageUrl: 'https://img.test/1.jpg' }] : fail,
      version: def.version,
      def,
    };
  },
};
const def = (id, version = 1, extra = {}) => ({ id, label: id.split('.').pop(), lang: 'ar', content: 'manga', engine: 'fake', version, domain: `${id.split('.').pop()}.test`, config: { works: true }, ...extra });

function setup() {
  const cache = createStore({ indexedDB: null });
  const vault = createStore({ indexedDB: null, spaces: VAULT_SPACES });
  let t = 1_000_000;
  const logs = [];
  const make = () => createRegistry({ engines: { fake }, store: cache, durable: { store: vault, ns: 'vault' }, ctx: {}, now: () => t, log: (m) => logs.push(m) });
  return { cache, vault, make, logs, advance: (ms) => (t += ms) };
}

describe('the repository disappears: installed sources keep running from the vault', () => {
  it('bundle unreadable (offline / 404): every installed source runs from its local copy, nothing is deleted', async () => {
    const { make } = setup();
    await make().init([def('src.a'), def('src.b')]);
    const r = make();
    await r.init(null);
    expect(r.list().map((d) => d.id).sort()).toEqual(['src.a', 'src.b']);
    expect(await r.call('src.a', (s) => s.search('x'))).toMatchObject({ mangas: [{ title: 'One' }] });
  });

  it('loadDefs: an HTML 404 page or a network failure is "unknown", never "zero sources"', async () => {
    expect(await loadDefs(async () => new Response('<html>404</html>', { status: 404 }))).toBeNull();
    expect(await loadDefs(async () => new Response('<html>oops</html>', { status: 200 }))).toBeNull();
    expect(await loadDefs(async () => { throw new TypeError('offline'); })).toBeNull();
    expect(await loadDefs(async () => new Response(JSON.stringify({ sources: [def('src.a')], blocked: [{ id: 'x', reason: 'r' }] })))).toMatchObject({ sources: [{ id: 'src.a' }], blocked: [{ id: 'x' }] });
  });

  it('a manga source removed from the bundle stays installed and working, marked out of its repository', async () => {
    const { make } = setup();
    await make().init([def('src.a'), def('src.gone')]);
    const r = make();
    await r.init([def('src.a')]);
    const gone = r.list('manga').find((d) => d.id === 'src.gone');
    expect(gone).toMatchObject({ inRepository: false, repositoryNote: OUT_OF_REPOSITORY });
    expect(await r.call('src.gone', (s) => s.popular(1))).toMatchObject({ mangas: [{ url: '1' }] });
    // يعود للحزمة ⇒ تُرفع العلامة
    const again = make();
    await again.init([def('src.a'), def('src.gone')]);
    expect(again.list('manga').find((d) => d.id === 'src.gone').inRepository).toBeUndefined();
  });

  it('the state lives outside the swept cache: a full cache sweep and 60 idle days lose nothing', async () => {
    const { make, cache, advance } = setup();
    const r = make();
    await r.init([def('src.a')]);
    await r.addUser(def('user.site.test', 1, { label: 'My Site' }));
    advance(60 * 24 * 60 * 60 * 1000);
    await cache.sweep({ target: 0 });
    await cache.clear('health');
    const back = make();
    await back.init(null);
    expect(back.userSites().map((s) => s.id)).toEqual(['user.site.test']);
    expect(back.source('src.a')).toBeTruthy();
  });

  it('moves the legacy state (health cache, registry:v1) into the vault once, keeping user sites', async () => {
    const { make, cache } = setup();
    await cache.set('health', 'registry:v1', {
      'src.a': { stable: { version: 1, hash: 'fnv', def: def('src.a'), verified: true }, lkg: null, candidate: null, health: {} },
      'user.mine.test': { user: true, stable: { version: 1, hash: 'fnv2', def: def('user.mine.test'), verified: true }, lkg: null, candidate: null, health: {} },
    });
    const r = make();
    await r.init([def('src.a')]);
    expect(r.userSites().map((s) => s.id)).toEqual(['user.mine.test']);
    expect(r.status()['src.a'].stable.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(r.status()['src.a'].stable.verified).toBe(true);
  });
});

describe('Last Known Good', () => {
  it('a damaged update never replaces the working version; the old one stays LKG after a good one', async () => {
    const { make } = setup();
    await make().init([def('src.a', 1)]);
    let r = make();
    await r.init([def('src.a', 2, { config: { works: false } })]);
    await r.verifyPending();
    expect(r.source('src.a').version).toBe(1);
    expect(r.status()['src.a'].candidate.status).toBe('failed');
    r = make();
    await r.init([def('src.a', 3)]);
    await r.verifyPending();
    expect(r.source('src.a').version).toBe(3);
    expect(r.status()['src.a'].lkg.version).toBe(1);
  });

  it('a version that breaks after activation is rolled back to LKG with an Arabic reason', async () => {
    const { make } = setup();
    await make().init([def('src.a', 1)]);
    const r = make();
    await r.init([def('src.a', 2)]);
    await r.verifyPending();
    for (let i = 0; i < 4; i += 1) await r.call('src.a', async () => { throw new Error('selector gone'); }).catch(() => {});
    expect(r.source('src.a').version).toBe(1);
    expect(r.status()['src.a'].restored.reason).toMatch(/عادت آخر نسخة سليمة v1/);
  });

  it('site trouble (host cooling, challenge, network, cancellation) never rolls back a version', async () => {
    const { make } = setup();
    await make().init([def('src.a', 1)]);
    const r = make();
    await r.init([def('src.a', 2)]);
    await r.verifyPending();
    for (const code of ['HOST_COOLING', 'challenge', 'network', 'timeout'])
      for (let i = 0; i < 4; i += 1) await r.call('src.a', async () => { throw Object.assign(new Error(code), { code }); }).catch(() => {});
    for (let i = 0; i < 6; i += 1) await r.call('src.a', async () => { throw new DOMException('x', 'AbortError'); }).catch(() => {});
    expect(r.source('src.a').version).toBe(2);
  });

  it('a corrupted active copy on disk falls back to LKG automatically at start', async () => {
    const { make, vault } = setup();
    await make().init([def('src.a', 1)]);
    const r = make();
    await r.init([def('src.a', 2)]);
    await r.verifyPending();
    const active = r.status()['src.a'].stable.hash;
    await vault.set('vault', `blob:${active}`, JSON.stringify({ ...def('src.a', 2), domain: 'evil.test' }));
    const back = make();
    await back.init(null);
    expect(back.source('src.a').version).toBe(1);
    expect(back.def('src.a').domain).toBe('a.test');
    expect(back.status()['src.a'].restored.reason).toMatch(/تالفة/);
  });

  it('refuses an older bundle version (no downgrade); the installed version keeps running', async () => {
    const { make, logs } = setup();
    await make().init([def('src.a', 3)]);
    const r = make();
    await r.init([def('src.a', 2, { config: { works: true, changed: 1 } })]);
    expect(r.source('src.a').version).toBe(3);
    expect(r.status()['src.a'].candidate).toBeNull();
    expect(r.status()['src.a'].refused).toMatchObject({ version: 2, code: DOWNGRADE_REFUSED });
    expect(logs.join('\n')).toContain(DOWNGRADE_REFUSED);
  });

  it('a security block from the app bundle disables the version and restores a non-blocked LKG; never restores a blocked LKG', async () => {
    const { make } = setup();
    await make().init([def('src.a', 1)]);
    let r = make();
    await r.init([def('src.a', 2)]);
    await r.verifyPending();
    const v2 = r.status()['src.a'].stable.hash;
    const v1 = r.status()['src.a'].lkg.hash;
    r = make();
    await r.init([def('src.a', 2)], { blocked: [{ id: 'src.a', hash: v2, reason: 'سرقة جلسات' }] });
    expect(r.source('src.a').version).toBe(1);
    r = make();
    await r.init([def('src.a', 2)], { blocked: [{ id: 'src.a', hash: v1, reason: 'ثغرة' }, { id: 'src.a', hash: v2, reason: 'ثغرة' }] });
    expect(r.source('src.a')).toBeNull();
    expect(r.unavailableReason('src.a')).toMatch(/عُطّل لسبب أمني/);
    await expect(r.call('src.a', async () => 1)).rejects.toThrow(/لسبب أمني/);
  });
});

describe('stable identity: source id migration and collisions', () => {
  it('a renamed id (unique name + language match) is migrated: old library ids reach the new source', async () => {
    const { make } = setup();
    await make().init([def('ar.mangahub', 1, { label: 'Manga Hub' })]);
    const r = make();
    await r.init([def('ar.mangahub.v2', 2, { label: 'Manga Hub' })]);
    expect(r.aliases()).toEqual({ 'ar.mangahub': 'ar.mangahub.v2' });
    expect(r.def('ar.mangahub').id).toBe('ar.mangahub.v2');
    expect(await r.call('ar.mangahub', (s, d) => d.id)).toBe('ar.mangahub.v2');
    expect(r.list().map((d) => d.id)).toEqual(['ar.mangahub.v2']);
    // ترحيل ثانٍ: السلسلة تبقى متصلة
    const again = make();
    await again.init([def('ar.mangahub.v3', 3, { label: 'Manga Hub' })]);
    expect(again.def('ar.mangahub').id).toBe('ar.mangahub.v3');
  });

  it('an ambiguous match is never migrated automatically: the old source keeps running', async () => {
    const { make, logs } = setup();
    await make().init([def('ar.tuk', 1, { label: 'Tuk' })]);
    const r = make();
    await r.init([def('ar.tuk.one', 1, { label: 'Tuk' }), def('ar.tuk.two', 1, { label: 'Tuk' })]);
    expect(r.aliases()).toEqual({});
    expect(r.def('ar.tuk').id).toBe('ar.tuk');
    expect(r.list().find((d) => d.id === 'ar.tuk').inRepository).toBe(false);
    expect(logs.join('\n')).toMatch(/غامض/);
  });

  it('a different language is not a match', async () => {
    const { make } = setup();
    await make().init([def('ar.hub', 1, { label: 'Hub' })]);
    const r = make();
    await r.init([def('en.hub', 1, { label: 'Hub', lang: 'en' })]);
    expect(r.aliases()).toEqual({});
  });

  it('rejects colliding and reserved ids instead of letting one source replace another', async () => {
    const { make, logs } = setup();
    const r = make();
    await r.init([def('src.a', 1, { label: 'First' }), def('src.a', 1, { label: 'Second' }), def('addon|evil', 1), def('0', 1)]);
    expect(r.list().map((d) => d.label)).toEqual(['First']);
    expect(logs.join('\n')).toContain('ID_COLLISION');
    await expect(r.addUser(def('src.a', 1))).rejects.toMatchObject({ code: 'ID_COLLISION' });
    await r.addUser(def('user.site.test'));
    const next = make();
    await next.init([def('src.a'), def('user.site.test', 1, { label: 'Imposter', domain: 'evil.test' })]);
    expect(next.def('user.site.test').domain).toBe('test.test');
    expect(next.def('user.site.test').label).toBe('test');
  });

  it('a migrated old id cannot be reclaimed by a user site', async () => {
    const { make } = setup();
    await make().init([def('ar.old', 1, { label: 'Same' })]);
    const r = make();
    await r.init([def('ar.new', 1, { label: 'Same' })]);
    await expect(r.addUser(def('ar.old', 1, { label: 'Other' }))).rejects.toMatchObject({ code: 'ID_COLLISION' });
  });
});

describe('invisible separation: the real bundled manga sources keep the same ids', () => {
  it('every shipped manga id loads from the real defs.json, and again offline from the vault', async () => {
    const shipped = JSON.parse(readFileSync(new URL('./defs.json', import.meta.url), 'utf8')).sources;
    const cache = createStore({ indexedDB: null });
    const vault = createStore({ indexedDB: null, spaces: VAULT_SPACES });
    const make = () => createRegistry({ engines: ENGINES, store: cache, durable: { store: vault, ns: 'vault' }, ctx: { fetch: {}, hosts: {} } });
    const first = make();
    await first.init(shipped);
    const ids = shipped.filter((d) => d.content === 'manga' && d.edge !== 'challenge').map((d) => d.id).sort();
    expect(first.list('manga').map((d) => d.id).sort()).toEqual(ids);
    const offline = make();
    await offline.init(null);
    expect(offline.list('manga').map((d) => d.id).sort()).toEqual(ids);
    expect(offline.aliases()).toEqual({});
  });
});
