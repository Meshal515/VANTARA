/** Tracks live Chromium WebView targets instead of GC-sensitive Java object counts.
 * The existing Activity/process checks separately forbid an automatic verifier.
 */
export function observeWebViewTargets(pages, seen, nowMs, maxAgeMs = 45_000, expectedShellId = null) {
  if (!Array.isArray(pages)) throw new Error('Android WebView targets unavailable');
  const active = new Map();
  let shellTargets = 0;
  const externalHosts = new Set();
  for (const target of pages) {
    if (target.type !== 'page') continue;
    if (isAppShellTarget(target) && (expectedShellId === null || String(target.id) === String(expectedShellId))) { shellTargets++; continue; }
    if (!target.id) throw new Error('Unidentified secondary WebView target');
    const id = String(target.id);
    const started = seen.get(id) ?? nowMs;
    if (nowMs - started > maxAgeMs) throw new Error(`Secondary WebView target outlived ${maxAgeMs}ms without teardown`);
    active.set(id, started);
    try { externalHosts.add(new URL(target.url).hostname); } catch { externalHosts.add('loading'); }
  }
  if (shellTargets < 1) throw new Error('App shell WebView target missing');
  return { seen:active, sample:{ shellTargets, temporaryTargets:active.size, temporaryHosts:[...externalHosts] } };
}

/** Exact origin prevents an unrelated page being mistaken for the APK shell. */
export function isAppShellTarget(target) {
  try { return target?.type === 'page' && new URL(target.url).origin === 'https://localhost'; }
  catch { return false; }
}

/** A fresh response on the original CDP socket is the direct shell-liveness gate.
 * Java WebView object counts from dumpsys are collected separately as diagnostics.
 */
export function assertLiveShellWebView({pages, expectedTargetId, probe}) {
  if (!expectedTargetId || !Array.isArray(pages) || !pages.some(p => isAppShellTarget(p) && String(p.id) === String(expectedTargetId)))
    throw new Error('Original app shell WebView target missing or replaced');
  if (!probe || !isAppShellTarget({type:'page',url:probe.url})) throw new Error('Live shell is not on the exact local APK origin');
  if (!['interactive','complete'].includes(probe.readyState)) throw new Error('Live shell document is not ready');
  if (probe.home !== true || probe.utility !== false) throw new Error('Live shell Home is not mounted and active');
  if (probe.fixture !== true) throw new Error('Original shell fixture is unavailable');
  return { originalShellTarget:true, liveHome:true, documentReady:true };
}
