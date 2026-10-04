import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { validateManifest } from "../manifest.js";
import { createStremioAdapter } from "./stremio.js";

// Captures pin protocol facts; response URLs explicitly rewritten by sanitization
// records are inert example.com placeholders, never network test dependencies.
const fixture = (name) => JSON.parse(readFileSync(new URL(`../../../../docs/addons/rebuild/research/${name}`, import.meta.url), "utf8"));
function adapter(addon, response, requests = []) {
  const captured = fixture(`${addon}-manifest.observed.json`);
  const result = validateManifest(captured.manifest, { origin: new URL(captured.sourceUrl).origin });
  expect(result.errors).toEqual([]);
  return createStremioAdapter({ manifest: result.manifest, manifestUrl: captured.sourceUrl, transport: { json: async (url) => { requests.push(url); return structuredClone(response); } } });
}

it("adapts captured Cinemeta catalog identities without generating stream identities", async () => {
  const captured = fixture("cinemeta-catalog-response.observed.json");
  const requests = [];
  const result = await adapter("cinemeta", captured.response, requests).catalog({ type: "movie", id: "top", extra: { search: "Big Buck Bunny" } });
  expect(result.map((item) => [item.id, item.type, item.name])).toEqual([["tt2245084", "movie", "Big Hero 6"], ["tt7336572", "movie", "Big Brother"]]);
  expect(requests).toHaveLength(1);
  expect(new URL(requests[0]).pathname).toContain("/catalog/movie/top/search=Big+Buck+Bunny.json");
  expect(captured.originalCount).toBe(6);
});

it("adapts captured movie metadata under its exact IMDb identity", async () => {
  const captured = fixture("cinemeta-movie-meta-response.observed.json");
  expect(await adapter("cinemeta", captured.response).meta({ type: "movie", id: "tt1254207" })).toMatchObject({ id: "tt1254207", type: "movie", name: "Big Buck Bunny" });
});

it("keeps captured series video identities including season-zero episodes", async () => {
  const captured = fixture("cinemeta-series-meta-response.observed.json");
  const result = await adapter("cinemeta", captured.response).meta({ type: "series", id: "tt3107288" });
  expect(result.videos.map((video) => [video.id, video.season, video.episode])).toEqual([["tt3107288:0:1", 0, 1], ["tt3107288:0:2", 0, 2]]);
  expect(captured.originalVideoCount).toBe(192);
});

it("adapts captured OpenSubtitles movie languages with explicitly sanitized download URLs", async () => {
  const captured = fixture("opensubtitles-movie-response.observed.json");
  const result = await adapter("opensubtitles-v3", captured.response).subtitles({ type: "movie", videoId: "tt1254207" });
  expect(result.map((item) => [item.id, item.lang])).toEqual([["5833874", "eng"], ["5511948", "ind"]]);
  expect(result.every((item) => new URL(item.url).hostname === "example.com")).toBe(true);
  expect(captured.sanitization.urlRewrites).toHaveLength(1);
});

it("preserves captured episode subtitle release and FPS advisory fields", async () => {
  const captured = fixture("opensubtitles-series-response.observed.json");
  const requests = [];
  const result = await adapter("opensubtitles-v3", captured.response, requests).subtitles({ type: "series", videoId: "tt3107288:1:1", extra: { filename: "The.Flash.2014.S01E01.WEB.x264-NOGRP.mkv" } });
  expect(result).toHaveLength(2);
  expect(result[0]).toMatchObject({ id: "5737608", lang: "eng", fpsMilli: 23976, season: 1, episode: 1 });
  expect(new URL(requests[0]).pathname).toContain("/subtitles/series/tt3107288%3A1%3A1/filename=");
  expect(captured.originalCount).toBe(97);
});

it("classifies the observed static example HTTP stream as unsupported PWA playback", async () => {
  const captured = fixture("static-stream-response.observed.json");
  const requests = [];
  const result = await adapter("static-example", captured.response, requests).streams({ type: "movie", videoId: "BigBuckBunny" });
  expect(result).toHaveLength(1);
  expect(result[0].status).toBe("UNSUPPORTED");
  expect(result[0].url).toBeUndefined();
  expect(requests[0]).toBe("https://stremio.github.io/stremio-static-addon-example/stream/movie/BigBuckBunny.json");
});

it("recognizes live unconfigured SubDL shape before requesting its observed failing route", async () => {
  const captured = fixture("subdl-unconfigured-error.observed.json");
  const requests = [];
  const instance = adapter("subdl", {}, requests);
  await expect(instance.subtitles({ type: "movie", videoId: "tt1254207" })).rejects.toMatchObject({ code: "CONFIG_REQUIRED" });
  expect(requests).toEqual([]);
  expect(captured.httpStatus).toBe(404);
  expect(captured.observedBody).toBe("404 Not Found");
});
