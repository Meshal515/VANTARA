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
    start(session, plugin, { addonGeneration, timeoutMs = 49_000 } = {}) {
      const controller = new AbortController();
      // Android independently expires reservations; never depend on a remote Promise
      // or the Capacitor bridge to finish before another provider may complete.
      const done = Promise.allSettled([...selected.values()].map(async entry => {
        const sourceId = entry.copy.sourceId;
        let result = [], provider = null, reason = null;
        const providerController = new AbortController();
        const abort = () => providerController.abort();
        controller.signal.addEventListener('abort', abort, { once: true });
        let timer, onAbort;
        const deadline = new Promise((_, reject) => {
          timer = setTimeout(() => { providerController.abort(); reject(new Error('ADDON_PREPARE_TIMEOUT')); }, Math.max(1, timeoutMs));
          onAbort = () => reject(new Error('ADDON_PREPARE_CANCELLED'));
          controller.signal.addEventListener('abort', onAbort, { once: true });
        });
        try {
          const response = await Promise.race([streams(entry, providerController.signal), deadline]);
          result = response.list;
          provider = response.provider;
        } catch {
          reason = 'تعذر الاتصال بالإضافة أو انتهاء مهلة تجهيز السيرفرات';
        } finally {
          clearTimeout(timer);
          controller.signal.removeEventListener('abort', onAbort);
          controller.signal.removeEventListener('abort', abort);
        }
        if (controller.signal.aborted) return;
        const args = { session, sourceId, name: entry.provider.name, streams: result, reason, ...(provider ? { provider } : {}), ...(addonGeneration ? { addonGeneration } : {}) };
        try {
          await plugin.appendAddonStreams(args);
        } catch {
          // Idempotent settlement: a bridge rejection must not strand the
          // session's native pendingBatches, even when all providers fail.
          if (controller.signal.aborted) return;
          let settled = false;
          if (typeof plugin.finishAddonBatch === 'function') {
            try {
              await plugin.finishAddonBatch({ session, sourceId, ...(addonGeneration ? { addonGeneration } : {}) });
              settled = true;
            } catch { /* Older Android binaries may not support this method. */ }
          }
          if (!settled) {
            try {
              await plugin.appendAddonStreams({ ...args, streams: [], provider: undefined, reason: 'تعذر تسليم سيرفرات الإضافة' });
            } catch { /* The native watchdog drains any remaining reservation. */ }
          }
        }
      })).then(() => undefined);
      return { done, cancel: () => controller.abort() };
    },
  };
}
