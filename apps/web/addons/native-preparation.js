import { subtitleRequest } from './subtitles.js';

/** Native source selection stays user-driven; this helper only prepares addon batches. */
export function nativeAddonPreparation({ runtime, copies, episode }) {
  const providers = new Map(runtime.registry.list().filter(m => m.enabled && m.protocol === 'stremio' &&
    m.capabilities.includes('streams') && !(m.configuration?.required && !m.configuration.configured)).map(m => [m.key, m]));
  const selected = new Map();
  for (const copy of copies) {
    if (!copy.sourceId?.startsWith('addon|')) continue;
    const key = copy.sourceId.slice(6), provider = providers.get(key);
    if (provider && selected.size < 128 && !selected.has(copy.sourceId)) selected.set(copy.sourceId, { copy, provider });
  }
  function canonicalRequest(copy) {
    const imdb = copy.identity?.externalIds?.imdb ?? copy.externalIds?.imdb ?? (/^tt\d+$/.test(copy.id ?? copy.url ?? '') ? copy.id ?? copy.url : null);
    const request = subtitleRequest({ ...copy.identity, kind: copy.identity?.kind ?? copy.type, externalIds: { ...copy.externalIds, ...copy.identity?.externalIds, ...(imdb ? { imdb } : {}) }, season: copy.requestedSeason ?? copy.identity?.season, episode: Number(episode) });
    // إضافة أنمي تعلن بثّ Kitsu تحت anime وحده: نطلبها بالنوع الذي اختارته addonCopies
    return request && copy.type === 'anime' && request.videoId.startsWith('kitsu:') ? { ...request, type: 'anime' } : request;
  }
  function descriptor(entry, input, episodes) {
    if (!runtime.registry.connection) return null;
    const { manifestUrl } = runtime.registry.connection(entry.provider.key);
    return { sourceId: entry.copy.sourceId, name: entry.provider.name, manifestUrl, type: input.type, videoId: input.videoId, ...(episodes ? { episodes } : {}) };
  }
  async function streams({ copy, provider }, signal) {
    const canonical = canonicalRequest(copy);
    if (canonical) return { list: await runtime.adapter(provider.key).streams({ ...canonical, signal }), provider: descriptor({ copy, provider }, canonical) };
    const source = runtime.sources.source(copy.sourceId);
    if (!source) throw new Error('source unavailable');
    const episodes = await source.episodes({ ...copy, episode: Number(episode) }, { signal });
    const current = copy.type === 'movie'
      ? episodes.find(ep => ep.type === 'movie' && ep.url === (copy.id ?? copy.url))
      : episodes.find(ep => Number(ep.number) === Number(episode) && (copy.requestedSeason == null || Number(ep.season) === Number(copy.requestedSeason)));
    if (!current) throw new Error('episode identity unavailable');
    const servers = await source.servers(current);
    const results = await Promise.allSettled(servers.map(server => source.streams(server, undefined, { signal })));
    return { list: results.flatMap(result => result.status === 'fulfilled' ? result.value : []), provider: descriptor({ copy, provider }, { type: current.type ?? copy.type, videoId: current.url }, episodes.filter(ep => copy.requestedSeason == null || Number(ep.season) === Number(copy.requestedSeason)).map(ep => ({ number: ep.number, id: ep.url }))) };
  }
  return {
    sourceIds: [...selected.keys()],
    providers: [...selected.values()].flatMap(entry => {
      const input = canonicalRequest(entry.copy);
      const provider = input && descriptor(entry, input);
      return provider ? [provider] : [];
    }),
    start(session, plugin, { addonGeneration, deadlineMs = 52_000, deliveryTimeoutMs = 10_000 } = {}) {
      // Independent provider deadlines and generation-safe native settlement.
      const controllers = new Set(), cancelTasks = new Set();
      const budget = Number.isFinite(deadlineMs) ? Math.max(1, Math.min(60_000, deadlineMs)) : 52_000;
      const deliveryBudget = Number.isFinite(deliveryTimeoutMs) ? Math.max(1, Math.min(10_000, deliveryTimeoutMs)) : 10_000;
      let cancelled = false;
      const bounded = (work, ms, { onTimeout = () => {}, cancellation } = {}) => {
        let timer;
        return Promise.race([
          Promise.resolve().then(work).then(value => ({ ok: true, value }), () => ({ ok: false })),
          new Promise(resolve => { timer = setTimeout(() => { onTimeout(); resolve({ timeout: true }); }, ms); }),
          ...(cancellation ? [cancellation] : []),
        ]).finally(() => clearTimeout(timer));
      };
      const done = Promise.all([...selected.values()].map(async entry => {
        const controller = new AbortController();
        controllers.add(controller);
        let cancelTask;
        const cancellation = new Promise(resolve => { cancelTask = () => resolve({ cancelled: true }); cancelTasks.add(cancelTask); });
        try {
          const result = await bounded(() => streams(entry, controller.signal), budget,
            { onTimeout: () => controller.abort(), cancellation });
          if (cancelled || result.cancelled) return;
          const found = result.ok ? result.value : null;
          const reason = found ? null : result.timeout ? 'انتهت مهلة تجهيز سيرفر الإضافة' : 'تعذر الاتصال بالإضافة أو العثور على فيديو مطابق';
          const payload = { session, sourceId: entry.copy.sourceId, name: entry.provider.name, streams: found?.list ?? [], reason, ...(found?.provider ? { provider: found.provider } : {}), ...(addonGeneration ? { addonGeneration } : {}) };
          const delivered = await bounded(() => plugin.appendAddonStreams(payload), deliveryBudget, { cancellation });
          if (cancelled || delivered.cancelled || delivered.ok) return;
          // A rejected or unresponsive bridge must not strand an already-reserved batch.
          if (typeof plugin.finishAddonBatch === 'function') {
            await bounded(() => plugin.finishAddonBatch({
              session, sourceId: entry.copy.sourceId, addonGeneration, reason: 'DELIVERY_FAILED',
            }), 5_000, { cancellation });
          }
        } finally {
          controllers.delete(controller);
          cancelTasks.delete(cancelTask);
        }
      })).then(() => undefined);
      return {
        done,
        cancel: () => {
          cancelled = true;
          for (const controller of controllers) controller.abort();
          for (const resolve of cancelTasks) resolve();
          controllers.clear();
          cancelTasks.clear();
        },
      };
    },
  };
}
