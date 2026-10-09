import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { animeMappingRequests, kitsuIdFromMappings, kitsuVideoRequest, createAnimeIdentityResolver } from "./anime-mapping.js";
const captured = (name) => JSON.parse(readFileSync(new URL(`../../../docs/addons/rebuild/research/2026-10-09/${name}-response.observed.json`, import.meta.url), "utf8"));
const al = captured("kitsu-anilist-21").response;
const mal = captured("kitsu-mal-21").response;
const identity = { kind: "anime", format: "TV", season: 2, episode: 1, externalIds: { anilist: "21", mal: "21" }, canonicalId: "anime|anilist:21" };

it("builds public exact namespace mapping requests without a title search", () => {
  const requests = animeMappingRequests({ anilist: 21, mal: "21", title: "Other anime" });
  expect(requests).toHaveLength(2);
  expect(requests.map((request) => request.externalSite)).toEqual(["anilist/anime", "myanimelist/anime"]);
  for (const request of requests) {
    const url = new URL(request.url);
    expect(url.origin).toBe("https://kitsu.io");
    expect(url.pathname).toBe("/api/edge/mappings");
    expect(url.searchParams.get("filter[externalId]")).toBe("21");
    expect(url.searchParams.get("filter[externalSite]")).toBe(request.externalSite);
    expect(url.searchParams.get("filter[text]")).toBeNull();
  }
});
it.each([{}, { anilist: 0 }, { mal: -1 }, { anilist: 1.5 }, { mal: "../21" }, { anilist: Number.MAX_SAFE_INTEGER + 1 }])("does not construct a guessed or malformed mapping request %j", (ids) => {
  expect(animeMappingRequests(ids)).toEqual([]);
});
it("uses the live observed AL and MAL relationship IDs as the same Kitsu identity", () => {
  const requests = animeMappingRequests(identity.externalIds);
  expect(kitsuIdFromMappings(al, requests[0])).toBe("12");
  expect(kitsuIdFromMappings(mal, requests[1])).toBe("12");
});
it("rejects an ignored filter that returns another external ID", () => {
  expect(kitsuIdFromMappings(al, { externalSite: "anilist/anime", id: "22" })).toBeNull();
});
it("does not accept a manga mapping as an anime mapping", () => {
  const response = structuredClone(al);
  response.data[0].relationships.item.data.type = "manga";
  expect(kitsuIdFromMappings(response, { externalSite: "anilist/anime", id: "21" })).toBeNull();
});
it("rejects ambiguous mappings and incompletely paginated results", () => {
  const response = structuredClone(al);
  response.data.push({ ...structuredClone(response.data[0]), relationships: { item: { data: { type: "anime", id: "99" } } } });
  expect(kitsuIdFromMappings(response, { externalSite: "anilist/anime", id: "21" })).toBeNull();
  expect(kitsuIdFromMappings({ ...al, links: { next: "https://kitsu.io/api/edge/mappings?page[offset]=20" } }, { externalSite: "anilist/anime", id: "21" })).toBeNull();
});
it("builds a Kitsu episode ID without transplanting the AniList part's season", () => {
  expect(kitsuVideoRequest({ ...identity, externalIds: { ...identity.externalIds, kitsu: "12" }, episode: 7 })).toEqual({ type: "series", workId: "kitsu:12", videoId: "kitsu:12:7" });
});
it("uses the bare Kitsu ID for an actual anime movie instead of requesting a series episode", () => {
  expect(kitsuVideoRequest({ ...identity, format: "MOVIE", externalIds: { kitsu: "142" }, episode: 1 })).toEqual({ type: "movie", workId: "kitsu:142", videoId: "kitsu:142" });
});
it.each([{}, { ...identity, externalIds: {} }, { ...identity, kind: "series", externalIds: { kitsu: "12" } }, { ...identity, episode: 0, externalIds: { kitsu: "12" } }])("does not manufacture a video request for incomplete or wrong-section identity %j", (value) => {
  expect(kitsuVideoRequest(value)).toBeNull();
});
it("enriches the same anime identity after exact AL/MAL mappings agree", async () => {
  const resolver = createAnimeIdentityResolver({ transport: { json: async (url) => url.includes("myanimelist") ? mal : al } });
  const result = await resolver.enrich(identity);
  expect(result).toEqual({ ...identity, externalIds: { ...identity.externalIds, kitsu: "12" } });
  expect(identity.externalIds.kitsu).toBeUndefined();
  expect(result.externalIds.imdb).toBeUndefined();
});
it("falls back to an exact MAL mapping if AL returns a transport failure", async () => {
  const resolver = createAnimeIdentityResolver({ transport: { json: async (url) => { if (!url.includes("myanimelist")) throw new Error("upstream failure"); return mal; } } });
  expect((await resolver.enrich(identity)).externalIds.kitsu).toBe("12");
});
it("does not enrich when provided AL and MAL identities resolve to different anime", async () => {
  const wrongMal = structuredClone(mal);
  wrongMal.data[0].relationships.item.data.id = "99";
  const resolver = createAnimeIdentityResolver({ transport: { json: async (url) => url.includes("myanimelist") ? wrongMal : al } });
  expect(await resolver.enrich(identity)).toEqual(identity);
});
it("does not accept an existing Kitsu ID that contradicts an exact external mapping", async () => {
  const resolver = createAnimeIdentityResolver({ transport: { json: async () => al } });
  const conflicting = { ...identity, externalIds: { anilist: "21", kitsu: "99" } };
  const result = await resolver.enrich(conflicting);
  expect(result.externalIds.kitsu).toBeUndefined();
});
it("reuses bounded work-ID cache without reusing episode position or mixing another work", async () => {
  let requests = 0;
  const resolver = createAnimeIdentityResolver({ transport: { json: async () => { requests++; return al; } }, maxEntries: 1 });
  const first = { ...identity, externalIds: { anilist: "21" } };
  expect((await resolver.enrich(first)).externalIds.kitsu).toBe("12");
  expect((await resolver.enrich({ ...first, episode: 9 })).episode).toBe(9);
  expect(requests).toBe(1);
  expect((await resolver.enrich({ ...first, externalIds: { anilist: "22" } })).externalIds.kitsu).toBeUndefined();
  await resolver.enrich(first);
  expect(requests).toBe(3);
});
it("expires successful cached mappings and does not permanently cache a failed upstream", async () => {
  let time = 0, requests = 0;
  const resolver = createAnimeIdentityResolver({ transport: { json: async () => { requests++; return requests === 1 ? { data: [] } : al; } }, ttlMs: 100, now: () => time });
  const first = { ...identity, externalIds: { anilist: "21" } };
  expect((await resolver.enrich(first)).externalIds.kitsu).toBeUndefined();
  time = 1001;
  expect((await resolver.enrich(first)).externalIds.kitsu).toBe("12");
  time = 1200;
  await resolver.enrich(first);
  expect(requests).toBe(3);
});
it("preserves cancellation rather than publishing an old work's enrichment", async () => {
  const controller = new AbortController();
  controller.abort();
  const resolver = createAnimeIdentityResolver({ transport: { json: async () => al } });
  await expect(resolver.enrich(identity, { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
});
