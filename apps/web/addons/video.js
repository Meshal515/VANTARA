import { subtitleRequests } from "./subtitles.js";
import { matchesStremioResource } from "./stremio-model.js";
/** الربط بالهوية الدقيقة لا بالعنوان، وإضافات التورنت ليست مرشحين صالحين تلقائيًا. */
export function nextEpisodeCopies(copies = [], episode, identity = {}) {
  return copies.map(c => {
    const next = { ...c, ...(identity.kind === "series" ? { requestedSeason: identity.season ?? c.requestedSeason } : {}) };
    if (c.sourceId?.startsWith("addon|")) {
      next.episode = episode;
      next.identity = { ...c.identity, ...identity, episode };
      if (next.identity.videoId === c.identity?.videoId && (episode !== c.identity?.episode || next.identity.season !== c.identity?.season))
        delete next.identity.videoId;
    }
    return next;
  });
}
export function addonCopies(registry, identity, runtimeName = "pwa") {
  // Cross-provider video fan-out needs a canonical work ID, not just one
  // provider's private episode ID. Its own source copy already retains that ID.
  if (!/^tt\d+$/.test(identity?.externalIds?.imdb ?? "") && !(identity?.kind === "anime" && /^[1-9]\d*$/.test(String(identity.externalIds?.kitsu ?? "")))) return [];
  const requests = subtitleRequests(identity);
  if (!requests.length) return [];
  return registry
    .list()
    .filter(
      (m) =>
        !m.bundled &&
        m.enabled &&
        m.compatibility?.[runtimeName] !== false &&
        m.protocol === "stremio" &&
        m.capabilities.includes("streams") &&
        !(m.configuration?.required && !m.configuration.configured),
    )
    .flatMap((m) => {
      const input = requests.find(request => matchesStremioResource(m, "stream", request.type, request.videoId));
      if (!input) return [];
      const workId = input.videoId.startsWith("kitsu:") ? `kitsu:${identity.externalIds.kitsu}` : identity.externalIds.imdb;
      return [{
      sourceId: `addon|${m.key}`,
      url: workId,
      id: workId,
      type: input.type,
      title: m.name,
      requestedSeason: identity.season,
      episode: identity.episode,
      externalIds: identity.externalIds,
      identity,
    }]; });
}
