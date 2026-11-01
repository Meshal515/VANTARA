/** Tracks live Chromium WebView targets instead of GC-sensitive Java object counts.
 * The existing Activity/process checks separately forbid an automatic verifier.
 */
export function observeWebViewTargets(pages, seen, nowMs, maxAgeMs = 45_000) {
  if (!Array.isArray(pages)) throw new Error('Android WebView targets unavailable');
  const active = new Map();
  let shellTargets = 0;
  const externalHosts = new Set();
  for (const target of pages) {
    if (target.type !== 'page') continue;
    if (String(target.url || '').startsWith('https://localhost')) { shellTargets++; continue; }
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
