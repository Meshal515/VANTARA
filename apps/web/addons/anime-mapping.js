/** Exact namespace relationships from Kitsu; titles never establish identity. */
const numericId = value => /^\d+$/.test(String(value ?? '')) && Number.isSafeInteger(Number(value)) && Number(value) > 0 ? String(Number(value)) : null;
export function animeMappingRequests(ids = {}) {
  return [['anilist', 'anilist/anime'], ['mal', 'myanimelist/anime']].flatMap(([key, externalSite]) => {
    const id = numericId(ids[key]);
    if (!id) return [];
    const url = new URL('https://kitsu.io/api/edge/mappings');
    url.search = new URLSearchParams({ 'filter[externalSite]': externalSite, 'filter[externalId]': id, include: 'item' });
    return [{ id, externalSite, url: url.href }];
  });
}
export function kitsuIdFromMappings(response, request) {
  if (!Array.isArray(response?.data) || response.data.length > 100 || response.links?.next) return null;
  const ids = new Set(response.data.flatMap(item => item?.type === 'mappings' && item.attributes?.externalSite === request.externalSite && String(item.attributes.externalId) === request.id && item.relationships?.item?.data?.type === 'anime' ? [numericId(item.relationships.item.data.id)].filter(Boolean) : []));
  return ids.size === 1 ? [...ids][0] : null;
}
export function kitsuVideoRequest(identity) {
  const id = numericId(identity?.externalIds?.kitsu);
  if (identity?.kind !== 'anime' || !id) return null;
  const workId = `kitsu:${id}`;
  if (identity.format === 'MOVIE') return { type: 'movie', workId, videoId: workId };
  if (!Number.isInteger(identity.episode) || identity.episode < 1) return null;
  return { type: 'series', workId, videoId: `${workId}:${identity.episode}` };
}
export function createAnimeIdentityResolver({ transport, maxEntries = 200, ttlMs = 86400000, now = Date.now }) {
  const cache = new Map();
  const check = signal => { if (signal?.aborted) throw new DOMException('ألغي ربط هوية الأنمي', 'AbortError'); };
  return { async enrich(identity, { signal } = {}) {
    check(signal);
    if (identity?.kind !== 'anime') return identity;
    const requests = animeMappingRequests(identity.externalIds);
    if (!requests.length) return identity;
    const key = JSON.stringify(requests.map(({ id, externalSite }) => [externalSite, id]));
    let hit = cache.get(key);
    if (hit && hit.until <= now()) { cache.delete(key); hit = null; }
    const results = hit ? hit.ids : await Promise.all(requests.map(async request => {
      try { return kitsuIdFromMappings(await transport.json(request.url, { signal, timeout: 8000 }), request); }
      catch (error) { if (signal?.aborted || error?.name === 'AbortError') throw error; return null; }
    }));
    check(signal);
    const ids = new Set(results.filter(Boolean));
    if (!hit) {
      cache.set(key, { ids: results, until: now() + (ids.size === 1 && results.every(Boolean) ? ttlMs : Math.min(1000, ttlMs)) });
      while (cache.size > Math.max(1, Math.min(2000, maxEntries))) cache.delete(cache.keys().next().value);
    }
    const existing = numericId(identity.externalIds?.kitsu);
    if (ids.size !== 1 || (existing && !ids.has(existing))) {
      if (!existing) return identity;
      const { kitsu, ...externalIds } = identity.externalIds;
      return { ...identity, externalIds };
    }
    return { ...identity, externalIds: { ...identity.externalIds, kitsu: [...ids][0] } };
  } };
}
