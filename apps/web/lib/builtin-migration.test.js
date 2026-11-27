import { afterEach, expect, it, vi } from 'vitest';

// المرحلة 2 من «صفر مصادر مدمجة»: الواجهة تطلب الترحيل لفوج معروف فقط، بما يراه الحساب، وتحفظ المستودع للقديم وحده.
const DILAR = 'eu.kanade.tachiyomi.extension.ar.dilar';
const AZORA = 'eu.kanade.tachiyomi.extension.ar.azora';
const EXISTING = Date.UTC(2026, 0, 1);
const NEW = Date.UTC(2027, 0, 1);

let plugin, e, engine;
async function load({ createdAt = null, standalone = false, settings = {}, installed = [], used = [AZORA, DILAR] } = {}) {
  vi.resetModules();
  plugin = {
    sources: vi.fn(async () => ({ sources: [
      ...(installed.includes(DILAR) ? [{ id: DILAR, label: 'Dilar', user: true, lang: 'ar' }] : [{ id: DILAR, label: 'Dilar', lang: 'ar' }]),
      { id: AZORA, label: 'Azora', lang: 'ar' },
      { id: `${AZORA}@en`, label: 'Azora EN', filler: true, lang: 'en' },
    ] })),
    search: vi.fn(async () => ({ mangas: [], hasNextPage: false })),
    setVisibleBuiltins: vi.fn(async () => ({})),
    migrateBuiltins: vi.fn(async ({ pkgs }) => ({ migrated: pkgs, skipped: [], failed: [] })),
  };
  vi.stubGlobal('Capacitor', { Plugins: { ExtensionEngine: plugin } });
  e = await import('./source-entitlement.js');
  engine = await import('./extension-engine.js');
  e.setEntitlement(e.decide({ standalone, account: createdAt == null ? null : { user_id: 'u', created_at: createdAt }, settings, used }));
}
afterEach(() => vi.unstubAllGlobals());

it('old account: only what it uses becomes installed (owner, 27 Nov: no 19 ready-made)', async () => {
  await load({ createdAt: EXISTING, used: [DILAR] });
  await vi.waitFor(() => expect(plugin.migrateBuiltins).toHaveBeenCalled());
  expect(plugin.migrateBuiltins).toHaveBeenLastCalledWith({ pkgs: [DILAR], keepRepository: true });
});

it('old account: everything it uses becomes installed, and its repository is kept as its own data', async () => {
  await load({ createdAt: EXISTING });
  await vi.waitFor(() => expect(plugin.migrateBuiltins).toHaveBeenCalled());
  expect(plugin.migrateBuiltins).toHaveBeenLastCalledWith({ pkgs: [AZORA, DILAR].sort(), keepRepository: true });
});

it('new account: only what it added, and never the repository', async () => {
  await load({ createdAt: NEW, settings: { srcpkg_eu_kanade_tachiyomi_extension_ar_dilar: { pkg: DILAR, on: true, at: 1 } } });
  await vi.waitFor(() => expect(plugin.migrateBuiltins).toHaveBeenCalled());
  expect(plugin.migrateBuiltins).toHaveBeenLastCalledWith({ pkgs: [DILAR], keepRepository: false });
});

it('no account (read without an account) is treated like an old one', async () => {
  await load({ standalone: true });
  await vi.waitFor(() => expect(plugin.migrateBuiltins).toHaveBeenCalled());
  expect(plugin.migrateBuiltins).toHaveBeenLastCalledWith({ pkgs: [AZORA, DILAR].sort(), keepRepository: true });
});

it('an account whose row has not arrived yet is not migrated (sync delay hides nothing)', async () => {
  vi.resetModules();
  plugin = { sources: vi.fn(async () => ({ sources: [{ id: DILAR, lang: 'ar' }] })), migrateBuiltins: vi.fn(), setVisibleBuiltins: vi.fn() };
  vi.stubGlobal('Capacitor', { Plugins: { ExtensionEngine: plugin } });
  const ent = await import('./source-entitlement.js');
  const eng = await import('./extension-engine.js');
  ent.setEntitlement(ent.decide({ account: null, settings: null }));
  await new Promise((r) => setTimeout(r, 20));
  expect(plugin.migrateBuiltins).not.toHaveBeenCalled();
  expect(await eng.migrateBuiltins(plugin, ent.entitlement(), [DILAR])).toBeNull();
});

it('a package installed as an extension opens by its old id even for a new account that never added it', async () => {
  await load({ createdAt: NEW, installed: [DILAR] });
  expect((await engine.sources()).map((s) => s.id)).toContain(DILAR);
  await engine.search(DILAR, 'x');
  expect(plugin.search).toHaveBeenCalledWith({ sourceId: DILAR, query: 'x', page: 1 });
  // غير المثبّت يبقى محجوبًا كما كان
  await expect(engine.search(AZORA, 'x')).rejects.toMatchObject({ code: 'SOURCE_NOT_ADDED' });
});

it('the migration tells the interface to refresh only when something moved', async () => {
  await load({ createdAt: EXISTING });
  // الترحيل التلقائي عند الإقلاع يكتمل أولًا، ثم يُقاس النداء المباشر وحده
  await vi.waitFor(() => expect(plugin.migrateBuiltins).toHaveBeenCalled());
  await new Promise((r) => setTimeout(r, 10));
  const seen = vi.fn();
  vi.stubGlobal('document', { dispatchEvent: seen });
  await engine.migrateBuiltins({ migrateBuiltins: async () => ({ migrated: [], skipped: [DILAR] }) }, e.entitlement(), [DILAR]);
  expect(seen).not.toHaveBeenCalled();
  await engine.migrateBuiltins({ migrateBuiltins: async () => ({ migrated: [DILAR] }) }, e.entitlement(), [DILAR]);
  expect(seen).toHaveBeenCalledTimes(1);
  expect(await engine.migrateBuiltins({ migrateBuiltins: vi.fn() }, e.entitlement(), [])).toBeNull();
});

it('installing, removing or rolling back an extension tells the work pages to refresh their sources at once', async () => {
  await load({ createdAt: EXISTING });
  // الترحيل التلقائي عند الإقلاع يبلّغ أيضًا (صحيح)؛ يكتمل أولًا ثم يُقاس النداء المباشر وحده
  await vi.waitFor(() => expect(plugin.migrateBuiltins).toHaveBeenCalled());
  await new Promise((r) => setTimeout(r, 10));
  const seen = vi.fn();
  engine.onSourcesChanged(seen);
  Object.assign(plugin, { repos: vi.fn(async () => ({})), addRepo: vi.fn(), removeRepo: vi.fn(), repoIndex: vi.fn(async () => ({ extensions: [] })),
    installExtension: vi.fn(async () => ({})), uninstallExtension: vi.fn(async () => ({})), rollbackExtension: vi.fn(async () => ({})) });
  const repos = engine.repositories();
  await repos.install('https://repo', 'eu.kanade.tachiyomi.extension.all.mangamillion');
  await repos.uninstall('eu.kanade.tachiyomi.extension.all.mangamillion');
  await repos.rollback('eu.kanade.tachiyomi.extension.all.mangamillion');
  expect(seen).toHaveBeenCalledTimes(3);
  // فشل التثبيت لا يبلّغ
  plugin.installExtension.mockRejectedValueOnce(new Error('signature'));
  await expect(repos.install('https://repo', 'x.y.z')).rejects.toThrow('signature');
  expect(seen).toHaveBeenCalledTimes(3);
});

it('what you do by hand is reported to the account list; what the sync applies is not reported back', async () => {
  await load({ createdAt: EXISTING });
  await vi.waitFor(() => expect(plugin.migrateBuiltins).toHaveBeenCalled());
  const changes = [];
  engine.onLocalExtensionChange((c) => changes.push(c));
  Object.assign(plugin, {
    repos: vi.fn(async () => ({ repos: [], installed: [] })), removeRepo: vi.fn(async () => ({})), repoIndex: vi.fn(async () => ({ extensions: [] })),
    addRepo: vi.fn(async ({ url, fingerprint }) => ({ repo: { url, name: 'Keiyoushi', fingerprint: fingerprint ?? 'abc' } })),
    installExtension: vi.fn(async () => ({})), uninstallExtension: vi.fn(async () => ({})),
  });
  const repos = engine.repositories();
  await repos.add('https://repo.example/r');
  await repos.install('https://repo.example/r', 'eu.kanade.tachiyomi.extension.all.mangamillion');
  await repos.uninstall('eu.kanade.tachiyomi.extension.all.mangamillion');
  await repos.remove('https://repo.example/r');
  expect(changes).toEqual([
    { type: 'repo', on: true, url: 'https://repo.example/r', name: 'Keiyoushi', fingerprint: 'abc' },
    { type: 'ext', on: true, pkg: 'eu.kanade.tachiyomi.extension.all.mangamillion', repo: 'https://repo.example/r' },
    { type: 'ext', on: false, pkg: 'eu.kanade.tachiyomi.extension.all.mangamillion' },
    { type: 'repo', on: false, url: 'https://repo.example/r' },
  ]);
  const target = engine.syncTarget();
  await target.addRepo({ url: 'https://repo.example/r', fingerprint: 'KEY' });
  await target.install({ pkg: 'eu.kanade.tachiyomi.extension.ar.teamx', repo: 'https://repo.example/r' });
  await target.uninstall({ pkg: 'eu.kanade.tachiyomi.extension.ar.teamx' });
  expect(changes).toHaveLength(4);
  // المفتاح المحفوظ في الحساب يصل للمحرك ليرفض مستودعًا غيّر مفتاحه
  expect(plugin.addRepo).toHaveBeenLastCalledWith({ url: 'https://repo.example/r', fingerprint: 'KEY' });
});
