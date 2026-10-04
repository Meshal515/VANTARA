import { subtitleRequest } from "./subtitles.js";
import { matchesStremioResource } from "./stremio-model.js";
/** الربط بالهوية الدقيقة لا بالعنوان، وإضافات التورنت ليست مرشحين صالحين تلقائيًا. */
export function nextEpisodeCopies(copies = [], episode, identity = {}) {
  return copies.map(c => ({ ...c, ...(identity.kind === "series" ? { requestedSeason: identity.season ?? c.requestedSeason } : {}), ...(c.sourceId?.startsWith("addon|") ? { episode, identity: { ...c.identity, ...identity, episode } } : {}) }));
}
export function addonCopies(registry, identity) {
  // Cross-provider video fan-out needs a canonical work ID, not just one
  // provider's private episode ID. Its own source copy already retains that ID.
  if (!/^tt\d+$/.test(identity?.externalIds?.imdb ?? "")) return [];
  const input = subtitleRequest(identity);
  if (!input) return [];
  return registry
    .list()
    .filter(
      (m) =>
        !m.bundled &&
        m.enabled &&
        m.compatibility?.pwa !== false &&
        m.protocol === "stremio" &&
        m.capabilities.includes("streams") &&
        !(m.configuration?.required && !m.configuration.configured) &&
        matchesStremioResource(m, "stream", input.type, input.videoId),
    )
    .map((m) => ({
      sourceId: `addon|${m.key}`,
      url: identity.externalIds.imdb,
      id: identity.externalIds.imdb,
      type: input.type,
      title: m.name,
      requestedSeason: identity.season,
      episode: identity.episode,
      externalIds: identity.externalIds,
      identity,
    }));
}
