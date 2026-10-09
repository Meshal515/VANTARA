import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateManifest } from "../manifest.js";
import { matchesStremioResource } from "../stremio-model.js";
import { createStremioAdapter } from "./stremio.js";

// Live captures pin protocol facts; source-contract fixtures are separately
// labelled and contain inert example.com identities, not playable media.
const capture = (name) => JSON.parse(readFileSync(new URL(`../../../../docs/addons/rebuild/research/2026-10-09/${name}`, import.meta.url), "utf8"));
function normalize(name) {
  const observed = capture(`${name}-manifest.observed.json`);
  const normalized = validateManifest(observed.manifest, { origin: new URL(observed.sourceUrl).origin });
  expect(normalized.errors).toEqual([]);
  return { observed, manifest: normalized.manifest };
}
function instance(name, response, transport = {}) {
  const { observed, manifest } = normalize(name);
  return createStremioAdapter({ manifest, manifestUrl: observed.sourceUrl, transport: { json: async () => structuredClone(response), ...transport } });
}

describe("fresh 2026-10-09 public Stremio manifest corpus", () => {
  it.each(["opensubtitles", "subdl", "subsource", "subpool", "comet", "mediafusion", "stremthru-correct"])("accepts the independently captured %s contract", (name) => {
    const { observed, manifest } = normalize(name);
    expect(observed.evidence).toBe("LIVE_CAPTURE_MINIMIZED");
    expect(observed.httpStatus).toBe(200);
    expect(manifest.protocol).toBe("stremio");
    expect(manifest.capabilities.length).toBeGreaterThan(0);
  });

  it("StremThru resource types work even with an empty top-level type list", () => {
    const { observed, manifest } = normalize("stremthru-correct");
    expect(observed.manifest.types).toEqual([]);
    expect(matchesStremioResource(manifest, "stream", "series", "tt4574334:1:1")).toBe(true);
    expect(matchesStremioResource(manifest, "stream", "anime", "mal:123:1")).toBe(true);
    expect(matchesStremioResource(manifest, "stream", "movie", "title-only-identity")).toBe(false);
  });

  it("MediaFusion scoped prefix rules do not force its additional event type into cinema", async () => {
    const { manifest } = normalize("mediafusion");
    expect(matchesStremioResource(manifest, "stream", "events", "mf:event-id")).toBe(true);
    expect(matchesStremioResource(manifest, "meta", "series", "tt4574334")).toBe(false);
    expect(manifest.contentTypes).not.toContain("events");
    expect(await instance("mediafusion", { streams: [] }).streams({ type: "movie", videoId: "tt1254207" })).toEqual([]);
  });

  it("Comet object resource rules retain Kitsu support without inventing anime resource support", () => {
    const { manifest } = normalize("comet");
    expect(matchesStremioResource(manifest, "stream", "series", "kitsu:123:1")).toBe(true);
    expect(matchesStremioResource(manifest, "stream", "anime", "kitsu:123:1")).toBe(false);
  });

  it("does not fetch or surface SubPool's setup-message SRT as a real subtitle", async () => {
    const request = [];
    const addon = instance("subpool", { subtitles: [{ id: "subpool-setup-required", lang: "eng", label: "No subtitle source connected", url: "https://example.com/setup.srt" }] }, { json: async (url) => { request.push(url); return { subtitles: [] }; } });
    await expect(addon.subtitles({ type: "movie", videoId: "tt1254207" })).rejects.toMatchObject({ code: "CONFIG_REQUIRED", resource: "subtitles" });
    expect(request).toEqual([]);
  });

  it.each(["subdl", "subsource"])("accepts %s subtitle external type without bypassing user configuration", async (name) => {
    const { observed, manifest } = normalize(name);
    expect(observed.manifest.types).toContain("subtitles");
    expect(manifest.capabilities).toContain("subtitles");
    await expect(instance(name, { subtitles: [] }).subtitles({ type: "series", videoId: "tt4574334:1:1" })).rejects.toMatchObject({ code: "CONFIG_REQUIRED" });
  });

  it("retains the real transport failure distinction and redacts configured path/query", async () => {
    const { manifest } = normalize("comet");
    const configuredUrl = "https://comet.example.com/private-user-settings/manifest.json?api_key=private-token";
    const addon = createStremioAdapter({ manifest, manifestUrl: configuredUrl, transport: { json: async () => { throw Object.assign(new Error(configuredUrl), { status: 403 }); } } });
    const error = await addon.streams({ type: "series", videoId: "tt4574334:1:1" }).catch((e) => e);
    expect(error).toMatchObject({ code: "HTTP_403", status: 403, resource: "stream" });
    expect(error.message).not.toMatch(/private-user-settings|private-token|api_key/);
    expect(JSON.stringify(error)).not.toMatch(/private-user-settings|private-token|api_key/);
  });
});

describe("pinned Torrentio source contract", () => {
  const sourceContract = capture("torrentio-stream.contract.json");
  function torrentio(response = sourceContract.response, options = {}) {
    const result = validateManifest(sourceContract.manifest, { origin: "https://torrentio.example.com" });
    expect(result.errors).toEqual([]);
    return createStremioAdapter({ manifest: result.manifest, manifestUrl: "https://torrentio.example.com/manifest.json", transport: { json: async () => structuredClone(response) }, ...options });
  }
  it("keeps source-derived evidence labelled separately from live response/playback", () => {
    expect(sourceContract.evidence).toBe("AUTHORED_SOURCE_CONTRACT_FIXTURE_NOT_LIVE_PLAYBACK");
    expect(sourceContract.sourceUrl).toContain("d812d87aa8f65a1fe0d4f15a66bee7ebdba9bdd0");
  });
  it("never marks a raw torrent as direct PWA playback or trusts Stremio's local subtitles", async () => {
    const result = await torrentio().streams({ type: "series", videoId: "tt4574334:1:1" });
    expect(result).toHaveLength(1);
    expect(result[0].status).not.toBe("RESOLVED");
    expect(result[0].subtitles).toEqual([]);
  });
  it("isolates a malformed sibling so that a direct HTTPS result can still be shown", async () => {
    const result = await torrentio({ streams: [null, ...sourceContract.response.streams, { url: "https://example.com/authored-video.m3u8", name: "2160p", behaviorHints: { filename: "Example.S01E01.mkv", videoHash: "0123456789abcdef", videoSize: 4096 } }] }).streams({ type: "series", videoId: "tt4574334:1:1" });
    const direct = result.find((stream) => stream.url?.startsWith("https://"));
    expect(direct).toMatchObject({ status: "RESOLVED", type: "hls", quality: 2160, qualitySource: "advertised", filename: "Example.S01E01.mkv", videoHash: "0123456789abcdef", videoSize: 4096 });
  });
});

describe("platform-specific Torrentio adapter bridge contract", () => {
  const contract = capture("torrentio-stream.contract.json");
  function adapter(streams, options = {}) {
    const { manifest } = validateManifest(contract.manifest, { origin: "https://torrentio.example.com" });
    return createStremioAdapter({ manifest, manifestUrl: "https://torrentio.example.com/manifest.json", transport: { json: async () => ({ streams: structuredClone(streams) }) }, runtimeName: "apk", ...options });
  }
  const input = { type: "series", videoId: "tt4574334:1:1" };
  it("retains exact torrent file 0, discovery hints and subtitle filename when the runtime exists", async () => {
    const result = await adapter(contract.response.streams, { torrentSupported: true }).streams(input);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ type: "torrent", status: "RESOLVED", infoHash: "0123456789abcdef0123456789abcdef01234567", fileIdx: 0, sources: contract.response.streams[0].sources, filename: "Example.S01E01.2160p.WEB.H265.mkv", quality: 2160, qualitySource: "advertised" });
    expect(result[0].subtitles).toEqual([]);
    expect(result[0].videoHash).toBeNull();
    expect(result[0].url).toBeUndefined();
  });
  it("does not declare raw torrent playable on an APK without the native engine", async () => {
    const result = await adapter(contract.response.streams).streams(input);
    expect(result[0].status).toBe("UNSUPPORTED");
    expect(result[0].infoHash).toBe(contract.response.streams[0].infoHash);
  });
  it("preserves unspecified file selection distinctly from explicit file 0", async () => {
    const { fileIdx, ...stream } = contract.response.streams[0];
    const result = await adapter([stream], { torrentSupported: true }).streams(input);
    expect(result[0]).toMatchObject({ status: "RESOLVED", type: "torrent", fileIdx: null });
  });
  it.each([-1, 1.5, "0"])("rejects malformed torrent file index %s without silently choosing another file", async (fileIdx) => {
    const result = await adapter([{ ...contract.response.streams[0], fileIdx }], { torrentSupported: true }).streams(input);
    expect(result[0].status).toBe("UNSUPPORTED");
  });
  it("preserves a distinct real OpenSubtitles file hash instead of substituting torrent infoHash", async () => {
    const stream = { ...contract.response.streams[0], behaviorHints: { ...contract.response.streams[0].behaviorHints, videoHash: "fedcba9876543210", videoSize: 8192 } };
    const result = await adapter([stream], { torrentSupported: true }).streams(input);
    expect(result[0]).toMatchObject({ videoHash: "fedcba9876543210", videoSize: 8192 });
    expect(result[0].videoHash).not.toBe(result[0].infoHash);
  });
  it("admits a native HTTPS stream requiring HTTP request headers and notWebReady", async () => {
    const streams = [{ url: "https://example.com/video.m3u8", behaviorHints: { notWebReady: true, filename: "Example.mkv", proxyHeaders: { request: { "User-Agent": "VANTARA", Referer: "https://example.com/" } } } }];
    const native = await adapter(streams).streams(input);
    expect(native[0]).toMatchObject({ status: "RESOLVED", type: "hls", headers: { "User-Agent": "VANTARA", Referer: "https://example.com/" } });
    const browser = await adapter(streams, { runtimeName: "pwa" }).streams(input);
    expect(browser[0].status).toBe("UNSUPPORTED");
  });
  it("does not convert proxy response header semantics to pretend native request support", async () => {
    const result = await adapter([{ url: "https://example.com/video.mp4", behaviorHints: { notWebReady: true, proxyHeaders: { response: { "Content-Encoding": "deflate" } } } }]).streams(input);
    expect(result[0].status).toBe("UNSUPPORTED");
  });
  it("forwards stream extra arguments while preserving configured URL credentials only in the request", async () => {
    const { manifest } = validateManifest(contract.manifest, { origin: "https://torrentio.example.com" });
    const requested = [];
    const addon = createStremioAdapter({ manifest, manifestUrl: "https://torrentio.example.com/private-config/manifest.json?key=private-query", transport: { json: async (url) => { requested.push(new URL(url)); return { streams: [] }; } }, runtimeName: "apk" });
    expect(await addon.streams({ ...input, extra: { filename: "حلقة + Example & Release.mkv", videoSize: 8192 } })).toEqual([]);
    expect(requested[0].pathname).toContain("/private-config/stream/series/tt4574334%3A1%3A1/");
    const encodedExtras = requested[0].pathname.split("/").at(-1).slice(0, -5);
    expect(new URLSearchParams(encodedExtras).get("filename")).toBe("حلقة + Example & Release.mkv");
    expect(requested[0].searchParams.get("key")).toBe("private-query");
  });
});

describe("fresh real resource response corpus", () => {
  it("adapts the newly observed OpenSubtitles response with release hints kept distinct from exact hash matching", async () => {
    const observed = capture("opensubtitles-bbb-response.observed.json");
    const results = await instance("opensubtitles", observed.response).subtitles({ type: "movie", videoId: "tt1254207", extra: { filename: "big_buck_bunny.mp4" } });
    expect(observed.originalCount).toBe(2);
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ id: "5833874", lang: "eng", subtitleFileName: "big_buck_bunny.eng.srt", movieReleaseName: "big_buck_bunny", fpsMilli: 24000 });
    expect(results[0].url).toBe("https://example.com/observed-subtitle-0.srt");
    expect(results[0].hashMatched).toBeUndefined();
  });
  it("keeps the observed MediaFusion empty success separate from error/unsupported playback", async () => {
    const observed = capture("mediafusion-bbb-stream-response.observed.json");
    expect(observed.httpStatus).toBe(200);
    expect(await instance("mediafusion", observed.response).streams({ type: "movie", videoId: "tt1254207" })).toEqual([]);
  });
  it("uses captured Cinemeta identities for current catalog and meta responses", async () => {
    const source = JSON.parse(readFileSync(new URL("../../../../docs/addons/rebuild/research/cinemeta-manifest.observed.json", import.meta.url), "utf8"));
    const { manifest } = validateManifest(source.manifest, { origin: new URL(source.sourceUrl).origin });
    const catalog = capture("cinemeta-search-response.observed.json");
    const meta = capture("cinemeta-movie-meta-response.observed.json");
    const addon = createStremioAdapter({ manifest, manifestUrl: source.sourceUrl, transport: { json: async (url) => structuredClone(url.includes("/catalog/") ? catalog.response : meta.response) } });
    expect((await addon.catalog({ type: "movie", id: "top", extra: { search: "Big Buck Bunny" } })).map((item) => item.id)).toEqual(["tt2245084", "tt7336572"]);
    expect(await addon.meta({ type: "movie", id: "tt1254207" })).toMatchObject({ id: "tt1254207", type: "movie", name: "Big Buck Bunny" });
  });
  it("records observed 403s and a subtitle download separately from first-frame evidence", () => {
    const outcomes = capture("live-observations.json");
    const torrentio = outcomes.find((item) => item.sourceUrl === "https://torrentio.strem.fun/manifest.json");
    expect(torrentio).toMatchObject({ httpStatus: 403, playbackVerified: false });
    const download = capture("opensubtitles-bbb-file-proof.json");
    expect(download).toMatchObject({ httpStatus: 200, containsSrtTimestamp: true, evidence: "LIVE_DOWNLOAD_PROBE_NOT_PLAYER_RENDER", urlAndContentOmitted: true });
  });
});
