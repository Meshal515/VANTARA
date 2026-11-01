/** Interceptor-owned passive Android WebViews are not verification Activities.
 * The Java WebViews field in dumpsys counts objects awaiting GC too, so it is
 * not a reliable gauge of open browser windows or leak-free teardown.
 */
export function analyzePassiveSessions(log, pid, uptimeMs, maxAgeMs = 30_000) {
  const active = new Map();
  let started = 0;
  let ended = 0;
  for (const line of log.split(/\r?\n/)) {
    const m = line.match(/^\S+\s+\S+\s+(\d+)\s+\d+\s+I\s+VantaraPassiveWebView:\s+(START|END)\s+id=(\d+)\s+at=(\d+)/);
    if (!m || Number(m[1]) !== Number(pid)) continue;
    const [, , kind, id, msText] = m;
    const at = Number(msText);
    if (kind === 'START') {
      if (active.has(id)) throw new Error(`Passive WebView ${id} opened twice without cleanup`);
      active.set(id, at);
      started++;
    } else {
      if (!active.has(id)) throw new Error(`Passive WebView ${id} destroyed without a matching start`);
      active.delete(id);
      ended++;
    }
  }
  const ages = [...active.values()].map(at => uptimeMs - at);
  if (ages.some(age => age > maxAgeMs))
    throw new Error(`Passive WebView exceeded ${maxAgeMs} ms lifetime (oldest ${Math.max(...ages)} ms)`);
  return { started, ended, active: active.size, oldestActiveMs: ages.length ? Math.max(...ages) : 0 };
}
