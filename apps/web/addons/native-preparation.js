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
    return subtitleRequest({ ...copy.identity, kind: copy.identity?.kind ?? copy.type, externalIds: { ...copy.externalIds, ...copy.identity?.externalIds, ...(imdb ? { imdb } : {}) }, season: copy.requestedSeason ?? copy.identity?.season, episode: Number(episode) });
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
    start(session, plugin, { addonGeneration } = {}) {
      const controller = new AbortController();
      const done = Promise.all([...selected.values()].map(async entry => {
        let result = [], provider = null, reason = null;
        try { const response = await streams(entry, controller.signal); result = response.list; provider = response.provider; }
        catch { reason = 'تعذر الاتصال بالإضافة أو العثور على فيديو مطابق'; }
        if (controller.signal.aborted) return;
        await plugin.appendAddonStreams({ session, sourceId: entry.copy.sourceId, name: entry.provider.name, streams: result, reason, ...(provider ? { provider } : {}), ...(addonGeneration ? { addonGeneration } : {}) });
      })).then(() => undefined);
      return { done, cancel: () => controller.abort() };
    },
  };
}
