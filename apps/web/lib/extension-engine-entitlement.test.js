import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const DILAR = 'eu.kanade.tachiyomi.extension.ar.dilar';
const AZORA = 'eu.kanade.tachiyomi.extension.ar.azora';
const OTHER = 'eu.kanade.tachiyomi.extension.ar.other';
const EXISTING = Date.UTC(2026, 0, 1);
const NEW = Date.UTC(2027, 0, 1);

let plugin, written, engine, e;
async function load(createdAt) {
  vi.resetModules();
  written = [];
  plugin = {
    sources: vi.fn(async () => ({ sources: [
      { id: DILAR, label: 'Dilar', version: '1.4.5', installedVersion: '1.4.5', artifactPresent: true, ready: false, lang: 'ar' },
      { id: AZORA, label: 'Azora', version: '1.4.9', installedVersion: '1.4.9', artifactPresent: true, ready: false, lang: 'ar' },
      { id: `${AZORA}@en`, label: 'Azora EN', filler: true, lang: 'en' },
      { id: `${OTHER}#9`, label: 'Other', user: true, lang: 'ar' },
    ] })),
    search: vi.fn(async () => ({ mangas: [], hasNextPage: false })),
    prepare: vi.fn(async () => ({ ok: true })),
    repos: vi.fn(async () => ({ repos: [], installed: [] })),
    addRepo: vi.fn(),
    removeRepo: vi.fn(),
    repoIndex: vi.fn(async () => ({ extensions: [
      { pkg: DILAR, name: 'Dilar', version: '1.4.6', builtin: true },
      { pkg: OTHER, name: 'Other', version: '1.0', installed: '1.0' },
    ] })),
    installExtension: vi.fn(async () => ({})),
    uninstallExtension: vi.fn(async () => ({})),
    setVisibleBuiltins: vi.fn(async () => ({})),
  };
  vi.stubGlobal('Capacitor', { Plugins: { ExtensionEngine: plugin } });
  e = await import('./source-entitlement.js');
  let settings = {};
  const decideNow = () => e.setEntitlement(e.decide({ account: { user_id: 'u', created_at: createdAt }, settings }));
  e.setChoiceWriter(async (fields) => { written.push(fields); settings = { ...settings, ...fields }; decideNow(); });
  engine = await import('./extension-engine.js');
  decideNow();
}

beforeEach(() => vi.useRealTimers());
afterEach(() => vi.unstubAllGlobals());

it('حساب موجود: كل المصادر التي كان يراها، بالمعرّفات نفسها', async () => {
  await load(EXISTING);
  expect((await engine.sources()).map((s) => s.id)).toEqual([DILAR, AZORA, `${AZORA}@en`, `${OTHER}#9`]);
  await engine.search(DILAR, 'x');
  expect(plugin.search).toHaveBeenCalledWith({ sourceId: DILAR, query: 'x', page: 1 });
});

it('حساب جديد: لا مصادر مدمجة، ولا يصل طلبها إلى المحرك (لا تنزيل حزمة)', async () => {
  await load(NEW);
  expect((await engine.sources()).map((s) => s.id)).toEqual([`${OTHER}#9`]);
  await expect(engine.search(DILAR, 'x')).rejects.toMatchObject({ code: 'SOURCE_NOT_ADDED' });
  await expect(engine.prepare(AZORA)).rejects.toMatchObject({ code: 'SOURCE_NOT_ADDED' });
  expect(plugin.search).not.toHaveBeenCalled();
  expect(plugin.prepare).not.toHaveBeenCalled();
});

it('«مصادر جاهزة»: الإضافة تُظهر المصدر بمعرّفه القديم، والإزالة تخفيه دون تثبيت أو حذف ملفات', async () => {
  await load(NEW);
  const ready = engine.readySources();
  const before = await ready.extensions();
  expect(before.map((x) => [x.pkg, x.installed])).toEqual([[DILAR, null], [AZORA, null]]);
  await ready.install(engine.READY_REPOSITORY, DILAR);
  expect((await engine.sources()).map((s) => s.id)).toEqual([DILAR, `${OTHER}#9`]);
  expect((await ready.list()).installed.map((x) => x.pkg)).toEqual([DILAR]);
  await ready.uninstall(DILAR);
  expect((await engine.sources()).map((s) => s.id)).toEqual([`${OTHER}#9`]);
  expect(plugin.installExtension).not.toHaveBeenCalled();
  expect(plugin.uninstallExtension).not.toHaveBeenCalled();
  expect(written).toHaveLength(2);
});

it('مستودع Keiyoushi: الحزمة المدمجة سابقًا لا تُثبّت نسخة ثانية؛ تثبيتها اختيار في الحساب', async () => {
  await load(NEW);
  const repos = engine.repositories();
  const list = await repos.extensions('https://repo');
  expect(list[0]).toMatchObject({ pkg: DILAR, builtin: false, formerlyBundled: true, installed: null });
  expect(list[1]).toMatchObject({ pkg: OTHER, installed: '1.0' });
  await repos.install('https://repo', DILAR);
  expect(plugin.installExtension).not.toHaveBeenCalled();
  expect((await repos.extensions('https://repo'))[0].installed).toBe('1.4.5');
  await repos.install('https://repo', OTHER);
  expect(plugin.installExtension).toHaveBeenCalledWith({ repo: 'https://repo', pkg: OTHER });
});

it('المحرك الأصلي يُبلَّغ بالحزم الظاهرة فقط ليحمّلها مسبقًا', async () => {
  await load(EXISTING);
  await vi.waitFor(() => expect(plugin.setVisibleBuiltins).toHaveBeenCalled());
  expect(plugin.setVisibleBuiltins).toHaveBeenLastCalledWith({ pkgs: [AZORA, DILAR].sort() });
});

it('the legacy catalogue cannot claim an external repository URL', async () => {
  await load(EXISTING);
  expect(engine.readySources().add).toBeUndefined();
});

it('dismisses the legacy catalogue durably without uninstalling its sources', async () => {
  await load(EXISTING);
  let dismissed = false;
  plugin.repos.mockImplementation(async () => ({ repos: [], installed: [], readyCatalogDismissed: dismissed }));
  plugin.removeReadySources = vi.fn(async () => { dismissed = true; });
  const ready = engine.readySources();
  expect((await ready.list()).repos).toHaveLength(1);
  await ready.remove(engine.READY_REPOSITORY);
  expect((await engine.readySources().list()).repos).toEqual([]);
  expect((await ready.list()).installed.map(x => x.pkg)).toEqual([DILAR, AZORA]);
  expect(written).toEqual([]);
  expect(plugin.uninstallExtension).not.toHaveBeenCalled();
  expect(plugin.removeReadySources).toHaveBeenCalledOnce();
});

it('does not show a preset repository for a clean account', async () => {
  await load(NEW);
  expect((await engine.readySources().list()).repos).toEqual([]);
});

it('rejects a legacy installation with no declared source instead of saving a false success', async () => {
  await load(NEW);
  plugin.sources.mockResolvedValue({ sources: [] });
  await expect(engine.readySources().install(engine.READY_REPOSITORY, DILAR)).rejects.toMatchObject({ code: 'SOURCE_NOT_DECLARED' });
  expect(plugin.prepare).not.toHaveBeenCalled();
  expect(written).toEqual([]);
  expect(e.entitlement().added.has(DILAR)).toBe(false);
});

it.each([EXISTING, NEW])('failed native restoration preserves the previous account selection for cohort %s', async createdAt => {
  await load(createdAt);
  const before = e.visible({ id: DILAR });
  plugin.prepare.mockRejectedValue(new Error('offline package restoration'));
  await expect(engine.readySources().install(engine.READY_REPOSITORY, DILAR)).rejects.toThrow('offline package restoration');
  expect(plugin.prepare).toHaveBeenCalledWith({ sourceId: DILAR });
  expect(e.visible({ id: DILAR })).toBe(before);
  expect(written).toEqual([]);
});

it('selects the original source ID only after its package was prepared successfully', async () => {
  await load(NEW);
  const order = [];
  plugin.prepare.mockImplementation(async args => {
    order.push(['prepare', args.sourceId]);
    expect(e.visible({ id: DILAR })).toBe(false);
    return { ok: true };
  });
  e.setChoiceWriter(async fields => { order.push(['choice', fields]); });
  await engine.readySources().install(engine.READY_REPOSITORY, DILAR);
  expect(order.map(([step]) => step)).toEqual(['prepare', 'choice']);
  expect(order[0][1]).toBe(DILAR);
  expect(e.visible({ id: DILAR })).toBe(true);
});

it('does not select a legacy package when native preparation did not confirm success', async () => {
  await load(NEW);
  plugin.prepare.mockResolvedValue({ ok: false });
  await expect(engine.readySources().install(engine.READY_REPOSITORY, DILAR)).rejects.toMatchObject({ code: 'SOURCE_PREPARE_UNCONFIRMED' });
  expect(written).toEqual([]);
  expect(e.visible({ id: DILAR })).toBe(false);
});

it('rejects an account-write failure after preparation without claiming selection succeeded', async () => {
  await load(NEW);
  e.setChoiceWriter(async () => { throw new Error('account write failed'); });
  await expect(engine.readySources().install(engine.READY_REPOSITORY, DILAR)).rejects.toThrow('account write failed');
  expect(plugin.prepare).toHaveBeenCalledWith({ sourceId: DILAR });
  expect(e.visible({ id: DILAR })).toBe(false);
});

const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};

it.each(['switch-account', 'switch-away-and-return'])('rejects stale preparation across %s with identical cohort and choices', async change => {
  await load(NEW);
  e.setChoiceOwner?.('account:a');
  const started = deferred(), finish = deferred(), writes = [];
  plugin.prepare.mockImplementation(async () => { started.resolve(); await finish.promise; return { ok: true }; });
  e.setChoiceWriter(async fields => { writes.push(fields); });
  const install = engine.readySources().install(engine.READY_REPOSITORY, DILAR);
  const rejected = expect(install).rejects.toMatchObject({ code: 'ACCOUNT_CHANGED' });
  await started.promise;
  e.setChoiceOwner?.('account:b');
  // Identity must invalidate the operation even when the entitlement signature is unchanged.
  e.setEntitlement(e.decide({ account: { user_id: 'b', created_at: NEW }, settings: {} }));
  if (change === 'switch-away-and-return') e.setChoiceOwner?.('account:a');
  finish.resolve();
  await rejected;
  expect(writes).toEqual([]);
  expect(e.entitlement().added.has(DILAR)).toBe(false);
});

it('rejects an account change during source discovery before downloading or saving choices', async () => {
  await load(NEW);
  e.setChoiceOwner?.('account:a');
  const started = deferred(), finish = deferred();
  const result = await plugin.sources();
  plugin.sources.mockImplementation(async () => { started.resolve(); await finish.promise; return result; });
  const install = engine.readySources().install(engine.READY_REPOSITORY, DILAR);
  const rejected = expect(install).rejects.toMatchObject({ code: 'ACCOUNT_CHANGED' });
  await started.promise;
  e.setChoiceOwner?.('account:b');
  finish.resolve();
  await rejected;
  expect(plugin.prepare).not.toHaveBeenCalled();
  expect(written).toEqual([]);
});

it('does not apply an old writer completion to a newly active identical account', async () => {
  await load(NEW);
  e.setChoiceOwner?.('account:a');
  const started = deferred(), finish = deferred(), dispatched = [];
  e.setChoiceWriter(async fields => { dispatched.push(fields); started.resolve(); await finish.promise; });
  const selecting = e.choosePackage(DILAR, true);
  const rejected = expect(selecting).rejects.toMatchObject({ code: 'ACCOUNT_CHANGED' });
  await started.promise;
  e.setChoiceOwner?.('account:b');
  e.setEntitlement(e.decide({ account: { user_id: 'b', created_at: NEW }, settings: {} }));
  finish.resolve();
  await rejected;
  expect(dispatched).toHaveLength(1);
  expect(e.entitlement().added.has(DILAR)).toBe(false);
});

it('preserves the operation context while refreshing the same account', async () => {
  await load(NEW);
  expect(typeof e.setChoiceOwner).toBe('function');
  e.setChoiceOwner('account:a');
  const original = e.choiceContext();
  e.setChoiceOwner('account:a');
  expect(e.choiceContext()).toBe(original);
  e.setChoiceOwner(null);
  expect(e.choiceContext()).not.toBe(original);
  e.setChoiceOwner('account:a');
  expect(e.choiceContext()).not.toBe(original);
});

it('lets the writer reject a delayed session change before dispatching any account operation', async () => {
  await load(NEW);
  e.setChoiceOwner('account:a');
  const dispatched = [];
  e.setChoiceWriter(async (fields, context) => {
    // Same order as app.js: bind the actual current owner, then validate, then enqueue.
    e.setChoiceOwner('account:b');
    e.assertChoiceContext(context);
    dispatched.push(fields);
  });
  await expect(engine.readySources().install(engine.READY_REPOSITORY, DILAR)).rejects.toMatchObject({ code: 'ACCOUNT_CHANGED' });
  expect(dispatched).toEqual([]);
  expect(e.entitlement().added.has(DILAR)).toBe(false);
});

it('refuses a stale explicit context after returning to the original account', async () => {
  await load(NEW);
  e.setChoiceOwner('account:a');
  const context = e.choiceContext();
  e.setChoiceOwner('account:b');
  e.setChoiceOwner('account:a');
  await expect(e.choosePackage(DILAR, true, context)).rejects.toMatchObject({ code: 'ACCOUNT_CHANGED' });
  expect(written).toEqual([]);
  expect(e.entitlement().added.has(DILAR)).toBe(false);
});

it('keeps a verified cached legacy package installed after runtime unload and uses its stored version', async () => {
  await load(EXISTING);
  plugin.sources.mockResolvedValue({ sources: [
    { id: DILAR, label: 'Dilar', version: '1.4.5', installedVersion: '1.4.4', artifactPresent: true, ready: false, lang: 'ar' },
  ] });
  const ready = engine.readySources();
  expect(await ready.extensions()).toMatchObject([{ pkg: DILAR, selected: true, installed: '1.4.4', pendingRestore: false }]);
  expect((await ready.list()).installed).toMatchObject([{ pkg: DILAR, installed: '1.4.4' }]);
});

it('keeps selected packages without verified artifacts recoverable without counting them installed', async () => {
  await load(EXISTING);
  plugin.sources.mockResolvedValue({ sources: [
    { id: DILAR, label: 'Dilar', version: '1.4.5', installedVersion: null, artifactPresent: false, ready: false, lang: 'ar' },
  ] });
  const ready = engine.readySources();
  expect(await ready.extensions()).toMatchObject([{ pkg: DILAR, selected: true, installed: null, pendingRestore: true }]);
  const list = await ready.list();
  expect(list.installed).toEqual([]);
  expect(list.pending).toMatchObject([{ pkg: DILAR, selected: true, pendingRestore: true, repo: engine.READY_REPOSITORY }]);
  expect(list.repos).toEqual([{ url: engine.READY_REPOSITORY, name: 'مصادر جاهزة' }]);
  await ready.uninstall(DILAR);
  expect(e.visible({ id: DILAR })).toBe(false);
  expect((await ready.list()).pending).toEqual([]);
  expect((await ready.list()).repos).toEqual([]);
});

it('reads formerly bundled installed versions from native artifacts instead of the repository candidate', async () => {
  await load(EXISTING);
  plugin.sources.mockResolvedValue({ sources: [
    { id: DILAR, label: 'Dilar', version: '1.4.5', installedVersion: '1.4.4', artifactPresent: true, ready: false },
  ] });
  const repos = engine.repositories();
  expect((await repos.extensions('https://repo'))[0]).toMatchObject({
    pkg: DILAR, version: '1.4.6', installed: '1.4.4', selected: true, pendingRestore: false, formerlyBundled: true,
  });
  plugin.repoIndex.mockRejectedValue(new Error('repository offline'));
  expect((await engine.readySources().list()).installed).toMatchObject([{ pkg: DILAR, installed: '1.4.4' }]);
});

it('does not convert a selected missing artifact into an installed repository candidate', async () => {
  await load(EXISTING);
  plugin.sources.mockResolvedValue({ sources: [
    { id: DILAR, label: 'Dilar', version: '1.4.5', artifactPresent: false, ready: true },
  ] });
  expect((await engine.repositories().extensions('https://repo'))[0]).toMatchObject({
    pkg: DILAR, installed: null, selected: true, pendingRestore: true,
  });
});

it('keeps a clean account empty even when legacy artifacts are stored on the device', async () => {
  await load(NEW);
  plugin.sources.mockResolvedValue({ sources: [
    { id: DILAR, label: 'Dilar', version: '1.4.5', installedVersion: '1.4.4', artifactPresent: true, ready: true },
  ] });
  expect(await engine.readySources().list()).toMatchObject({ repos: [], installed: [], pending: [] });
  expect((await engine.readySources().extensions())[0]).toMatchObject({ selected: false, installed: null, pendingRestore: false });
  expect((await engine.repositories().extensions('https://repo'))[0]).toMatchObject({ selected: false, installed: null, pendingRestore: false });
});

it('preserves older bridge source access while keeping unknown storage evidence pending', async () => {
  await load(EXISTING);
  plugin.sources.mockResolvedValue({ sources: [{ id: DILAR, label: 'Dilar', version: '1.4.5', ready: true }] });
  const list = await engine.readySources().list();
  expect(list.installed).toEqual([]);
  expect(list.pending).toMatchObject([{ pkg: DILAR, selected: true, installed: null, pendingRestore: true, installationEvidence: 'unknown' }]);
  expect(list.pending[0].artifactPresent).toBeUndefined();
  expect(list.repos).toHaveLength(1);
  expect((await engine.sources()).map(source => source.id)).toEqual([DILAR]);
});
