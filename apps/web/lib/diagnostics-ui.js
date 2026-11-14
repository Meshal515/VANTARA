import { appVersion } from './config.js';
/** One native-backed device preference for visible Debug tools, independent of engine logging. */
const PREFERENCE = 'vantara.debug.ui.showDiagnostics';

/** Browser Debug builds use the existing CI-baked version; never a hostname/query/CSS flag. */
export function webDiagnosticsBridge(version, storage = globalThis.localStorage) {
  const debug = /^web-(?:debug|engine)-/.test(version ?? '');
  return { async diagnostics(options) {
    let visible = false;
    if (debug) try {
      if (typeof options?.visible === 'boolean') storage?.setItem(PREFERENCE, String(options.visible));
      visible = storage?.getItem(PREFERENCE) === 'true';
    } catch { /* Storage blocked: remain hidden. */ }
    return { debug, visible };
  } };
}
/** ويندوز: Debug بالقناة لا برقم النسخة؛ Stable لا يُظهر الأدوات ولا يقرأ التفضيل. */
export function desktopDiagnosticsBridge(channel, storage = globalThis.localStorage) {
  return webDiagnosticsBridge(channel === 'debug' ? 'web-debug-desktop' : '', storage);
}
function platformBridge() {
  const capacitor = globalThis.Capacitor;
  // The native build gate wins even when an APK loads newer Debug web assets.
  if (capacitor?.Plugins?.SystemUi || capacitor?.getPlatform?.() === 'android') return capacitor?.Plugins?.SystemUi;
  // ويندوز: رقم النسخة 0.4.N لا يحمل «debug»، فكانت أدوات Debug مخفية فيه دائمًا. القناة من العملية الرئيسية
  // (النافذة الرئيسية وطبقة المشغل كلتاهما) هي الحكم، والتفضيل نفسه في التخزين المحلي المشترك بينهما.
  const channel = globalThis.VantaraDesktop?.channel ?? globalThis.VantaraOverlay?.channel;
  if (channel === 'debug' || channel === 'stable') return desktopDiagnosticsBridge(channel);
  return webDiagnosticsBridge(appVersion());
}
export function createDiagnosticsVisibility(bridge = platformBridge) {
  let debug = false, visible = false, initialized, writes = Promise.resolve();
  const listeners = new Set();
  const publish = result => {
    debug = result?.debug === true;
    visible = debug && result?.visible === true;
    for (const listener of listeners) listener();
  };
  const initialize = () => initialized ??= Promise.resolve().then(async () => {
    try { publish(await bridge()?.diagnostics?.()); } catch { publish(null); }
  });
  return {
    available: () => debug,
    visible: () => debug && visible,
    initialize,
    setVisible(value) {
      writes = writes.then(async () => {
        await initialize();
        if (!debug) return;
        try { publish(await bridge()?.diagnostics?.({ visible: value === true })); }
        catch { publish(null); }
      });
      return writes;
    },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  };
}
export const diagnosticsUi = createDiagnosticsVisibility();
