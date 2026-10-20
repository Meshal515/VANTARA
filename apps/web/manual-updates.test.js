import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Exercise the app's real boot/check handlers without mounting the unrelated shell.
function handlers(over = {}) {
  const source = readFileSync(new URL('./app.js', import.meta.url), 'utf8');
  const section = source.slice(source.indexOf('// ───────────────────────────── التحديث'), source.indexOf('// ───────────────────────────── الإقلاع'));
  const deps = {
    reportHealthy: vi.fn(async () => ({ confirmed: true })),
    showToast: vi.fn(), checkDesktopUpdate: vi.fn(),
    findUpdate: vi.fn(async () => null), stageWeb: vi.fn(async () => true), activateStaged: vi.fn(async () => true),
    supports: () => false, document: { addEventListener: vi.fn() }, setInterval: vi.fn(),
    appVersion: () => '1.0.0', ...over,
  };
  const context = vm.createContext(deps);
  vm.runInContext(section + '\nthis.handlers = { startUpdates, checkUpdates };', context);
  return { ...deps, ...context.handlers };
}

describe('updates require the Settings action', () => {
  it('boot confirms bundle health without checks, timers, visibility hooks or alerts', async () => {
    const app = handlers();
    await app.startUpdates();
    await app.startUpdates();
    expect(app.reportHealthy).toHaveBeenCalledTimes(1);
    expect(app.findUpdate).not.toHaveBeenCalled();
    expect(app.showToast).not.toHaveBeenCalled();
    expect(app.setInterval).not.toHaveBeenCalled();
    expect(app.document.addEventListener).not.toHaveBeenCalled();
  });
  it('a background caller cannot query or install updates', async () => {
    const app = handlers();
    expect(await app.checkUpdates()).toBeNull();
    expect(app.findUpdate).not.toHaveBeenCalled();
    expect(app.stageWeb).not.toHaveBeenCalled();
    expect(app.activateStaged).not.toHaveBeenCalled();
  });
  it('Settings checks, verifies/stages and activates a compatible Android web update', async () => {
    const web = { version: '1.0.1', sha256: 'a'.repeat(64) };
    const app = handlers({ findUpdate: vi.fn(async () => ({ web, device: {} })) });
    await app.checkUpdates({ force: true });
    expect(app.findUpdate).toHaveBeenCalledWith({ force: true });
    expect(app.stageWeb).toHaveBeenCalledWith(web);
    expect(app.activateStaged).toHaveBeenCalledTimes(1);
  });
});
