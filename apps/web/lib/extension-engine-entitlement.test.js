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
      { id: DILAR, label: 'Dilar', version: '1.4.5', lang: 'ar' },
      { id: AZORA, label: 'Azora', version: '1.4.9', lang: 'ar' },
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
  expect((await repos.extensions('https://repo'))[0].installed).toBe('1.4.6');
  await repos.install('https://repo', OTHER);
  expect(plugin.installExtension).toHaveBeenCalledWith({ repo: 'https://repo', pkg: OTHER });
});

it('المحرك الأصلي يُبلَّغ بالحزم الظاهرة فقط ليحمّلها مسبقًا', async () => {
  await load(EXISTING);
  await vi.waitFor(() => expect(plugin.setVisibleBuiltins).toHaveBeenCalled());
  expect(plugin.setVisibleBuiltins).toHaveBeenLastCalledWith({ pkgs: [AZORA, DILAR].sort() });
});
