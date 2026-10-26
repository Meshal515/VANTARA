import { afterEach, expect, it, vi } from 'vitest';
import { parseHTML } from 'linkedom';
import { installDesktopBridges, renderInstallPreview } from './boot.js';
import * as desktopRuntime from './runtime.js';
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
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
it('يعلن فقط قدرات مصادر ويندوز ولا يدعي دعم مستودعات APK أو DEX', () => {
  const g = { VantaraDesktop: { platform:'windows',requestResource:async()=>({}),startPlayback:async()=>({started:true}),onEvent:()=>()=>{} } };
  const plugin = installDesktopBridges(g).ExtensionEngine;
  for (const method of ['sources','prepare','search','series','chapters','pages','image','cover','sites','addSite','removeSite'])
    expect(plugin[method]).toBeTypeOf('function');
  for (const method of ['addRepo','repos','repoIndex','installExtension','uninstallExtension','removeRepo','then'])
    expect(plugin[method]).toBeUndefined();
});
it('يوصل تحديث المصدر المعتمد إلى document لتتجدد بطاقة الإضافات المفتوحة', () => {
  const { document } = parseHTML('<html><body></body></html>');
  const changed = vi.fn(); document.addEventListener('vantara:addons-changed',changed);
  const runtimeFor = vi.spyOn(desktopRuntime,'getRuntime').mockReturnValue({});
  const g = { document,VantaraDesktop:{platform:'windows',requestResource:async()=>({}),startPlayback:async()=>({started:true}),onEvent:()=>()=>{}} };
  const bridges = installDesktopBridges(g);
  bridges.SourceRuntime.getRuntime();
  const options = runtimeFor.mock.calls.at(-1)?.[1];
  expect(options?.onSourcesChanged).toBeTypeOf('function');
  options.onSourcesChanged();
  expect(changed).toHaveBeenCalledTimes(1);
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
