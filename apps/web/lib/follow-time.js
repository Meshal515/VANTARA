/** Native time is journaled independently of the WebView, then handed off durably. */
const plugin = () => {
  try {
    return globalThis.Capacitor?.Plugins?.FollowTime ?? null;
  } catch {
    return null;
  }
};
export const nativeFollowTime = () => Boolean(plugin());
let readerChain = Promise.resolve();
export function setReaderTime(owner, active) {
  const native = plugin();
  if (!native?.reader) return Promise.resolve();
  readerChain = readerChain.catch(() => {}).then(() => native.reader({ ...owner, active }));
  return readerChain;
}


/**
 * Register the optional native foreground listener without ever making it a
 * render dependency. Capacitor normally returns a Promise handle, but in-place
 * updates can briefly expose a stale/direct bridge shape. Both are accepted.
 */
export function listenFollowForeground(callback) {
  const native = plugin();
  if (!native?.addListener || typeof callback !== 'function') return () => {};

  let closed = false;
  let listener = null;
  try {
    const registration = native.addListener('foreground', callback);
    if (registration?.then) {
      Promise.resolve(registration).then(
        (handle) => {
          if (closed) {
            try { void handle?.remove?.(); } catch {}
          } else {
            listener = handle ?? null;
          }
        },
        () => {},
      );
    } else if (registration?.remove) {
      listener = registration;
    }
  } catch {
    // Optional accounting/lifecycle integration must never abort rendering.
  }

  return () => {
    closed = true;
    try { void listener?.remove?.(); } catch {}
  };
}

const flights = new WeakMap();
export function flushFollowTime(sync) {
  const native = plugin();
  if (!native?.pending || !native?.acknowledge || !sync?.user?.userId) return Promise.resolve();
  if (flights.has(sync)) return flights.get(sync);
  const userId = sync.user.userId;
  const job = (async () => {
    for (let batch = 0; batch < 20; batch++) {
      const { items = [] } = await native.pending({ userId });
      if (!items.length || sync.user?.userId !== userId) break;
      const ids = [];
      for (const item of items) {
        if (sync.user?.userId !== userId) break;
        const owner = item.owner;
        if (owner?.userId !== userId || !item.id || !(item.activeMs > 0)) continue;
        sync.enqueue('usage.work', {
          section: owner.section, seriesRef: owner.seriesRef, seriesTitle: owner.title,
          coverUrl: owner.coverUrl, activeMs: item.activeMs,
        }, { opId: `${item.id}:work`, requireDurable: true });
        if (['anime', 'cinema'].includes(owner.section)) sync.enqueue('usage.watch', {
          section: owner.section, day: item.day, activeMs: item.activeMs,
        }, { opId: `${item.id}:watch`, requireDurable: true });
        ids.push(item.id);
      }
      if (!ids.length) break;
      await native.acknowledge({ userId, ids });
      if (items.length < 100) break;
    }
  })().finally(() => flights.delete(sync));
  flights.set(sync, job);
  return job;
}

/** One collector per mounted shell. A failed handoff remains in native storage. */
export function collectFollowTime(sync) {
  const native = plugin();
  if (!native) return () => {};

  const visible = () => typeof document === 'undefined' || document.visibilityState !== 'hidden';
  const flush = () => {
    if (visible()) void flushFollowTime(sync).catch(() => {});
  };
  const onForeground = (e) => { if (e?.active) flush(); };

  let timer = null;
  const stopForeground = listenFollowForeground(onForeground);

  try {
    timer = setInterval(flush, 30_000);
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', flush);
    flush();
  } catch {
    // Accounting must degrade to a no-op, never block the application shell.
  }

  return () => {
    if (timer != null) clearInterval(timer);
    if (typeof document !== 'undefined') {
      try { document.removeEventListener('visibilitychange', flush); } catch {}
    }
    try { stopForeground(); } catch {}
  };
}
