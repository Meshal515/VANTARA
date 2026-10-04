/** صحة لكل إضافة/قدرة/runtime؛ manifest ناجح لا يعني سيرفر جاهز. */
export function createHealth({ clock = Date.now, onChange = () => {} } = {}) {
  const map = new Map(),
    key = (a, c, r) => JSON.stringify([a, c, r]);
  const state = (a, c, r = "pwa") =>
    map.get(key(a, c, r)) ?? { state: "unknown", failures: 0, retryAt: 0 };
  function measured(old, ms) {
    const samples = [
      ...(old.samples ?? []),
      ...(Number.isFinite(ms) && ms >= 0 ? [ms] : []),
    ].slice(-50);
    const ordered = [...samples].sort((a, b) => a - b);
    return {
      samples,
      latencyMs: Number.isFinite(ms) ? ms : null,
      p50: ordered[Math.max(0, Math.ceil(ordered.length * 0.5) - 1)] ?? null,
      p95: ordered[Math.max(0, Math.ceil(ordered.length * 0.95) - 1)] ?? null,
    };
  }
  function success(a, c, r = "pwa", latencyMs) {
    map.set(key(a, c, r), {
      ...measured(state(a, c, r), latencyMs),
      lastSuccessAt: clock(),
      state: "healthy",
      failures: 0,
      retryAt: 0,
      at: clock(),
    });
    onChange();
  }
  function failure(a, c, r = "pwa", reason = "failure", latencyMs) {
    const old = state(a, c, r),
      failures = old.failures + 1;
    const delay =
      failures < 3
        ? 0
        : failures === 3
          ? 30000
          : failures === 4
            ? 120000
            : 600000;
    map.set(key(a, c, r), {
      ...measured(old, latencyMs),
      lastSuccessAt: old.lastSuccessAt ?? null,
      state: delay ? "cooling" : "failed",
      failures,
      retryAt: clock() + delay,
      reason,
      at: clock(),
      probing: false,
    });
    onChange();
  }
  const ready = (a, c, r = "pwa") => {
    const s = state(a, c, r);
    return s.state !== "cooling" || (s.retryAt <= clock() && !s.probing);
  };
  function allow(a, c, r = "pwa", { manual = false } = {}) {
    const s = state(a, c, r);
    if (manual || s.state !== "cooling") return true;
    if (s.retryAt > clock() || s.probing) return false;
    s.probing = true;
    return true;
  }
  function restore(rows) {
    for (const [key, row] of (Array.isArray(rows)
      ? rows.slice(-2000)
      : []
    ).filter((x) => Array.isArray(x) && x.length === 2))
      if (
        typeof key === "string" &&
        row &&
        ["healthy", "failed", "cooling"].includes(row.state) &&
        Number.isFinite(row.failures) &&
        Number.isFinite(row.retryAt)
      )
        map.set(key, {
          ...row,
          samples: (Array.isArray(row.samples) ? row.samples : [])
            .filter(Number.isFinite)
            .slice(-50),
          probing: false,
        });
  }
  function reset(addon) {
    for (const k of map.keys()) {
      try {
        if (JSON.parse(k)[0] === addon) map.delete(k);
      } catch {}
    }
    onChange();
  }
  return {
    state,
    success,
    failure,
    allow,
    ready,
    restore,
    reset,
    snapshot: () => [...map].slice(-2000),
  };
}
