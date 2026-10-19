import { momentLabel } from './anime-engine.js';


/** Durable native files stay owned by their account until a server row confirms delivery. */
export function createMomentOutbox({ native, sync, currentUser, storage = globalThis.localStorage, onError = () => {} }) {
  const running = new Set();
  return async function drain() {
    const userId = currentUser();
    if (!userId || running.has(userId) || !sync) return;
    running.add(userId);
    const key = `vantara.anime.native-outbox.v1.${encodeURIComponent(userId)}`;
    const active = () => currentUser() === userId;
    let pending;
    try {
      let saved;
      try { saved = JSON.parse(storage.getItem(key) ?? '[]'); } catch { saved = []; }
      const existing = Array.isArray(saved) ? saved : [];
      const items = await native.outbox(userId).catch(() => []);
      const entries = new Map(existing.map(row => [row.item?.id ?? row.id, row.item ? row : { item: row }]));
      for (const item of items) if (item.userId === userId && item.id && !entries.has(item.id)) entries.set(item.id, { item });
      pending = [...entries.values()].filter(row => row.item?.userId === userId);
      const persist = () => storage.setItem(key, JSON.stringify(pending));
      persist();
      for (const entry of [...pending]) {
        if (!active()) return;
        const it = entry.item;
        const confirmed = () => sync.rows('recommendations', row => row.id === it.id).some(row => row.id === it.id && !row._pending && row.rev > 0);
        const acknowledge = async () => {
          if (!active()) return;
          await native.acknowledgeOutbox?.({ userId, id: it.id });
          pending = pending.filter(row => row.item.id !== it.id);
          persist();
        };
        if (confirmed()) { await acknowledge(); continue; }
        try {
          const ep = Number(it.episode) > 0 ? Number(it.episode) : null;
          const moment = it.type === 'moment' ? {
            version: 1, startMs: it.startMs, endMs: it.endMs, episode: ep,
            sources: it.sources ?? it.moment?.sources ?? [],
          } : null;
          if (moment && (!Number.isFinite(moment.startMs) || !Number.isFinite(moment.endMs) || moment.startMs < 0 || moment.endMs <= moment.startMs || moment.endMs - moment.startMs > 70000)) throw new Error('invalid_clip');
          if (!active()) return;
          sync.enqueue('recommendation.send', {
            toId: it.toId ?? null, seriesRef: it.seriesRef || `anime:${it.animeId}`,
            seriesTitle: it.title || 'عمل', coverUrl: it.poster ?? null, message: null, hiddenFrom: [],
            chapterLabel: it.type === 'moment' ? momentLabel(ep, it.startMs, it.endMs) : ep == null ? 'فيلم' : `الحلقة ${ep}`, chapterNumber: ep,
            ...(moment ? { moment } : {}),
          }, { opId: it.id, requireDurable: true });
          await sync.push({ force: true });
          if (active() && confirmed()) await acknowledge();
        } catch (error) { onError(error, it); }
      }
    } catch (error) { onError(error); }
    finally { running.delete(userId); }
  };

}
