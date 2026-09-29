/** Native time is journaled independently of the WebView, then handed off durably. */
const plugin = () => globalThis.Capacitor?.Plugins?.FollowTime;
export const nativeFollowTime = () => Boolean(plugin());
let readerChain = Promise.resolve();
export function setReaderTime(owner, active) {
  if (!plugin()) return Promise.resolve();
  readerChain = readerChain.catch(() => {}).then(() => plugin().reader({ ...owner, active }));
  return readerChain;
}

const flights = new WeakMap();
export function flushFollowTime(sync) {
  if (!plugin() || !sync?.user?.userId) return Promise.resolve();
  if (flights.has(sync)) return flights.get(sync);
  const userId = sync.user.userId;
  const job = (async () => {
    const { items = [] } = await plugin().pending({ userId });
    const ids = [];
    for (const item of items) {
      if (sync.user?.userId !== userId) break;
      const owner = item.owner;
      if (owner?.userId !== userId || !item.id || !(item.activeMs > 0)) continue;
      sync.enqueue('usage.work', {
        section: owner.section, seriesRef: owner.seriesRef, seriesTitle: owner.title,
        coverUrl: owner.coverUrl, activeMs: item.activeMs,
      }, { opId: `${item.id}:work`, requireDurable: true });
      if (owner.section === 'anime') sync.enqueue('usage.watch', {
        section: 'anime', day: item.day, activeMs: item.activeMs,
      }, { opId: `${item.id}:watch`, requireDurable: true });
      ids.push(item.id);
    }
    if (ids.length) await plugin().acknowledge({ userId, ids });
  })().finally(() => flights.delete(sync));
  flights.set(sync, job);
  return job;
}

/** One collector per mounted shell. A failed handoff remains in native storage. */
export function collectFollowTime(sync) {
  const flush = () => { if (document.visibilityState !== 'hidden') void flushFollowTime(sync).catch(() => {}); };
  const onForeground = (e) => { if (e.active) flush(); };
  let closed = false;
  let listener;
  plugin()?.addListener('foreground', onForeground).then((l) => { if (closed) l.remove(); else listener = l; });
  const timer = setInterval(flush, 30_000);
  document.addEventListener('visibilitychange', flush);
  flush();
  return () => {
    closed = true;
    clearInterval(timer);
    document.removeEventListener('visibilitychange', flush);
    listener?.remove();
  };
}
