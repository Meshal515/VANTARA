import { subtitleRequest } from "./subtitles.js";
/** الربط بالهوية الدقيقة لا بالعنوان، وإضافات التورنت ليست مرشحين صالحين تلقائيًا. */
export function nextEpisodeCopies(copies = [], episode, identity = {}) {
  return copies.map(c => ({ ...c, ...(identity.kind === "series" ? { requestedSeason: identity.season ?? c.requestedSeason } : {}), ...(c.sourceId?.startsWith("addon|") ? { episode, identity: { ...c.identity, ...identity, episode } } : {}) }));
}
export function addonCopies(registry, identity) {
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
        m.resources.some(
          (r) =>
            r.name === "stream" &&
            (r.types ?? m.types).includes(input.type) &&
            (!(r.idPrefixes ?? m.idPrefixes).length ||
              (r.idPrefixes ?? m.idPrefixes).some((p) =>
                input.videoId.startsWith(p),
              )),
        ),
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
