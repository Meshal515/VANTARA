import { describe, expect, it, vi } from 'vitest';
import { collectExtensions, FORMAT, installItem, parseExtensions, planImport, serialize } from './extensions-transfer.js';

// طلب المالك (20 نوفمبر): «إضافاتي» بإعداداتها في ملف واحد، يُستورد على أي منصة، وكل إضافة بزر «تثبيت»
function nativeStore(id, { repos = [], installed = [] } = {}) {
  const state = { repos: [...repos], installed: [...installed] };
  return { id, state, api: {
    list: vi.fn(async () => structuredClone(state)),
    add: vi.fn(async (url) => { state.repos.push({ url, name: 'R' }); }),
    install: vi.fn(async (repo, pkg) => { if (pkg.endsWith('.broken')) throw new Error(`HTTP 500 at https://repo.example/${pkg}`); state.installed.push({ pkg, repo }); }),
    enable: vi.fn(async () => {}),
  } };
}
function registryOf(rows = []) {
  return { runtimeName: 'pwa', list: () => rows, inspect: vi.fn(async (url) => ({ key: `k:${url}` })), install: vi.fn(async (p) => { rows.push({ url: p.key.slice(2) }); return { key: p.key }; }), enable: vi.fn(), pin: vi.fn() };
}

describe('extensions transfer file', () => {
  it('exports repositories, installed extensions with state, web add-on links and sites; never bundled or secret data', async () => {
    const manga = nativeStore('manga', { repos: [{ url: 'https://repo.example/index.min.json', name: 'Keiyoushi' }], installed: [{ pkg: 'eu.kanade.tachiyomi.extension.ar.teamx', name: 'Team X', version: '1.4.2', repo: 'https://repo.example/index.min.json' }] });
    const cs = nativeStore('cloudstream', { installed: [{ pkg: 'com.example.cs', name: 'CS', version: '3', repo: 'https://cs.example/repo.json', content: 'cinema', enabled: false }] });
    const registry = registryOf([{ bundled: true, url: 'https://core/x' }, { url: 'https://addon.example/abc123token/manifest.json', manifest: { name: 'Torrentio' }, pinned: true }]);
    const sites = { list: async () => [{ id: 'site-9', label: 'Site', domain: 'site.example', engine: 'madara' }] };
    const doc = await collectExtensions({ stores: [manga, cs, { id: 'ready', api: { list: async () => ({ installed: [{ pkg: 'x.y.z' }] }) } }], registry, sites, platform: 'android', now: () => 5 });
    expect(doc).toMatchObject({ format: FORMAT, version: 1, exportedAt: 5, platform: 'android' });
    expect(doc.native.manga.extensions[0]).toEqual({ pkg: 'eu.kanade.tachiyomi.extension.ar.teamx', name: 'Team X', version: '1.4.2', repo: 'https://repo.example/index.min.json' });
    expect(doc.native.cloudstream.extensions[0]).toMatchObject({ content: 'cinema', enabled: false });
    expect(doc.native.ready).toBeUndefined(); // المدمج سابقًا لا يُصدَّر (صفر مدمج)
    expect(doc.addons).toEqual([{ url: 'https://addon.example/abc123token/manifest.json', name: 'Torrentio', pinned: true }]); // الإعدادات داخل الرابط
    expect(doc.sites).toEqual([{ url: 'https://site.example/', name: 'Site' }]);
    expect(serialize(doc)).not.toMatch(/cookie|token"|password|session/i);
  });

  it('rejects files that are not ours, newer versions, and junk packages, with clear Arabic reasons', () => {
    expect(() => parseExtensions('not json')).toThrow('ليس JSON');
    expect(() => parseExtensions('{"format":"other"}')).toThrow('ليس ملف «إضافاتي»');
    expect(() => parseExtensions(JSON.stringify({ format: FORMAT, version: 9 }))).toThrow('إصدار أحدث');
    expect(() => parseExtensions(JSON.stringify({ format: FORMAT, version: 1, native: {}, addons: [] }))).toThrow('لا يحوي إضافات');
    const doc = parseExtensions(JSON.stringify({ format: FORMAT, version: 1, native: { manga: { repos: [{ url: 'javascript:alert(1)' }], extensions: [{ pkg: '../../evil' }, { pkg: 'eu.ok.ext', repo: 'ftp://x' }] } }, addons: [{ url: 'https://a.example/manifest.json' }] }));
    expect(doc.native.manga.repos).toEqual([]);
    expect(doc.native.manga.extensions).toEqual([{ pkg: 'eu.ok.ext', name: 'eu.ok.ext', version: null, repo: null }]);
  });

  it('plans per device: installed here, ready to install, or unavailable on this platform (kept, not dropped)', async () => {
    const doc = parseExtensions(JSON.stringify({ format: FORMAT, version: 1, native: {
      manga: { repos: [{ url: 'https://repo.example/i.json' }], extensions: [{ pkg: 'eu.a.one', repo: 'https://repo.example/i.json' }, { pkg: 'eu.a.two' }] },
      anime: { repos: [], extensions: [{ pkg: 'eu.b.anime', repo: 'https://anime.example/r.json' }] },
    }, addons: [{ url: 'https://a.example/manifest.json' }, { url: 'https://b.example/manifest.json' }], sites: [{ url: 'https://s.example/' }] }));
    const manga = nativeStore('manga', { installed: [{ pkg: 'eu.a.one' }] });
    const web = await planImport(doc, { stores: [], registry: registryOf([{ url: 'https://a.example/manifest.json' }]), sites: { list: async () => [] } });
    expect(web.find((i) => i.pkg === 'eu.b.anime')).toMatchObject({ status: 'unavailable', reason: 'تعمل في تطبيق الجوال' });
    expect(web.find((i) => i.url === 'https://a.example/manifest.json').status).toBe('installed');
    expect(web.find((i) => i.url === 'https://b.example/manifest.json').status).toBe('ready');
    expect(web.find((i) => i.kind === 'site').status).toBe('ready');
    const phone = await planImport(doc, { stores: [manga] });
    expect(phone.find((i) => i.pkg === 'eu.a.one').status).toBe('installed');
    expect(phone.find((i) => i.pkg === 'eu.a.two')).toMatchObject({ status: 'ready', repo: 'https://repo.example/i.json' }); // مستودع المجموعة
    expect(phone.find((i) => i.kind === 'site')).toMatchObject({ status: 'unavailable' });
  });

  it('installs through the normal path: adds the repository once, installs, restores disabled state; one failure does not stop the rest', async () => {
    const cs = nativeStore('cloudstream');
    const ctx = { stores: [cs] };
    const item = { kind: 'native', group: 'cloudstream', key: 'cloudstream:eu.c.one', pkg: 'eu.c.one', repo: 'https://cs.example/r.json', content: 'cinema', enabled: false, status: 'ready' };
    expect((await installItem(item, ctx)).status).toBe('installed');
    expect(cs.api.add).toHaveBeenCalledTimes(1);
    expect(cs.api.install).toHaveBeenCalledWith('https://cs.example/r.json', 'eu.c.one', 'cinema');
    expect(cs.api.enable).toHaveBeenCalledWith('eu.c.one', false);
    await installItem({ ...item, pkg: 'eu.c.two', key: 'x' }, ctx);
    expect(cs.api.add).toHaveBeenCalledTimes(1); // المستودع مرة واحدة
    const failed = await installItem({ ...item, pkg: 'eu.c.broken', key: 'y' }, ctx);
    expect(failed.status).toBe('failed');
    expect(failed.error).toBe('HTTP 500 at [رابط]');
  });

  it('web add-ons are re-installed from their saved link (with its settings) and keep pinned/disabled state', async () => {
    const registry = registryOf([]);
    const r = await installItem({ kind: 'addon', url: 'https://addon.example/tok/manifest.json', enabled: false, pinned: true }, { registry });
    expect(r.status).toBe('installed');
    expect(registry.inspect).toHaveBeenCalledWith('https://addon.example/tok/manifest.json');
    expect(registry.enable).toHaveBeenCalledWith('k:https://addon.example/tok/manifest.json', false);
    expect(registry.pin).toHaveBeenCalledWith('k:https://addon.example/tok/manifest.json', true);
  });

  it('round-trips: what one device exports, another parses identically', async () => {
    const manga = nativeStore('manga', { repos: [{ url: 'https://repo.example/i.json' }], installed: [{ pkg: 'eu.a.one', name: 'One', version: '2', repo: 'https://repo.example/i.json' }] });
    const doc = await collectExtensions({ stores: [manga], platform: 'windows', now: () => 1 });
    expect(parseExtensions(serialize(doc))).toEqual(doc);
  });
});
