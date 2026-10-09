import { expect, it } from "vitest";
import { createStremioAdapter } from "./stremio.js";
import { validateManifest } from "../manifest.js";
const manifest = validateManifest(
  {
    id: "org.demo",
    name: "Demo",
    version: "1.0.0",
    types: ["movie", "series"],
    idPrefixes: ["tt"],
    resources: [
      { name: "subtitles", types: ["series"], idPrefixes: ["tt"] },
      "stream",
      "meta",
      "catalog",
    ],
    catalogs: [{ type: "series", id: "demo", extra: [{ name: "search" }] }],
  },
  { origin: "https://addon.test" },
).manifest;
it("preserves configured URL and encodes episode and subtitle extras", async () => {
  let url;
  const a = createStremioAdapter({
    manifest,
    manifestUrl: "https://addon.test/token/manifest.json?key=s",
    transport: {
      json: async (u) => {
        url = u;
        return { subtitles: [] };
      },
    },
  });
  await a.subtitles({
    type: "series",
    videoId: "tt1196946:1:1",
    extra: { filename: "The Mentalist S01E01.mkv" },
  });
  const u = new URL(url);
  expect(u.pathname).toContain("/token/subtitles/series/tt1196946%3A1%3A1/");
  expect(decodeURIComponent(u.pathname)).toContain(
    "filename=The+Mentalist+S01E01.mkv",
  );
  expect(u.searchParams.get("key")).toBe("s");
});
it("rejects unsupported resource/type/namespace before requesting", async () => {
  let calls = 0;
  const a = createStremioAdapter({
    manifest,
    manifestUrl: "https://addon.test/manifest.json",
    transport: {
      json: async () => {
        calls++;
        return {};
      },
    },
  });
  await expect(
    a.subtitles({ type: "movie", videoId: "tt1" }),
  ).rejects.toThrow();
  await expect(
    a.streams({ type: "series", videoId: "unverified-anime-title" }),
  ).rejects.toThrow();
  expect(calls).toBe(0);
});
it("catalog IDs are not video IDs and are not filtered by IMDb prefixes", async () => {
  const a = createStremioAdapter({
    manifest,
    manifestUrl: "https://addon.test/manifest.json",
    transport: {
      json: async () => ({
        metas: [{ id: "tt1", type: "series", name: "Work" }],
      }),
    },
  });
  expect(await a.catalog({ type: "series", id: "demo" })).toHaveLength(1);
});
function make(raw, respond = async () => ({ subtitles: [] })) {
  return createStremioAdapter({ manifest: validateManifest(raw, { origin: "https://addon.test" }).manifest, manifestUrl: "https://addon.test/public-settings/manifest.json", transport: { json: respond } });
}
const raw = () => ({ id: "org.regression", name: "Regression", version: "1.0.0", types: ["movie"], resources: ["subtitles"], idPrefixes: ["tt"], catalogs: [] });
it("uses object resource rules independently of global prefixes", async () => {
  const a = make({ ...raw(), resources: [{ name: "subtitles", types: ["movie"] }] });
  expect(await a.subtitles({ type: "movie", videoId: "custom:1" })).toEqual([]);
});
it("explicit empty prefixes dispatch no requests", async () => {
  let calls = 0;
  const a = make({ ...raw(), resources: [{ name: "subtitles", types: ["movie"], idPrefixes: [] }] }, async () => { calls++; return { subtitles: [] }; });
  await expect(a.subtitles({ type: "movie", videoId: "tt1" })).rejects.toMatchObject({ code: "UNSUPPORTED_RESOURCE" });
  expect(calls).toBe(0);
});
it("catalog dispatch requires a declared identity and required extras", async () => {
  let calls = 0;
  const a = make({ ...raw(), resources: ["catalog"], catalogs: [{ type: "movie", id: "search", extra: [{ name: "search", isRequired: true }] }] }, async () => { calls++; return { metas: [] }; });
  await expect(a.catalog({ type: "movie", id: "unknown" })).rejects.toMatchObject({ code: "UNSUPPORTED_RESOURCE" });
  await expect(a.catalog({ type: "movie", id: "search" })).rejects.toMatchObject({ code: "REQUIRED_EXTRA" });
  expect(await a.catalog({ type: "movie", id: "search", extra: { search: "A & B/C + D" } })).toEqual([]);
  expect(calls).toBe(1);
});
it("catalog declarations match independently of top-level types", async () => {
  const a = make({ ...raw(), types: ["subtitles"], resources: ["catalog"], catalogs: [{ type: "movie", id: "work" }] }, async () => ({ metas: [] }));
  expect(await a.catalog({ type: "movie", id: "work" })).toEqual([]);
});
it("distinguishes configuration-required responses from empty results", async () => {
  const a = make(raw(), async () => ({ error: "config_required" }));
  await expect(a.subtitles({ type: "movie", videoId: "tt1" })).rejects.toMatchObject({ code: "CONFIG_REQUIRED", resource: "subtitles" });
});
it("blocks unconfigured providers before the transport", async () => {
  let calls = 0;
  const a = make({ ...raw(), behaviorHints: { configurationRequired: true, configurable: true } }, async () => { calls++; return { subtitles: [] }; });
  await expect(a.subtitles({ type: "movie", videoId: "tt1" })).rejects.toMatchObject({ code: "CONFIG_REQUIRED" });
  expect(calls).toBe(0);
});
it("isolates malformed subtitle entries and preserves safe fields", async () => {
  const a = make(raw(), async () => ({ subtitles: [null, { id: "x", url: "https://cdn.test/x.srt", lang: "eng", label: "English", subtitleFileName: "release.srt" }, { id: "bad", url: "http://127.0.0.1/x", lang: "ara" }, "bad"] }));
  const result = await a.subtitles({ type: "movie", videoId: "tt1" });
  expect(result).toHaveLength(1);
  expect(result[0]).toMatchObject({ id: "x", url: "https://cdn.test/x.srt", lang: "eng", label: "English", subtitleFileName: "release.srt" });
});
it("isolates malformed stream entries without hiding usable direct candidates", async () => {
  const a = make({ ...raw(), resources: ["stream"] }, async () => ({ streams: [null, { url: "https://cdn.test/video.mp4" }, "bad"] }));
  const result = await a.streams({ type: "movie", videoId: "tt1" });
  expect(result).toHaveLength(1);
  expect(result[0].status).toBe("RESOLVED");
});
it.each([
  ["subtitles", { subtitles: [null, { id: "missing-url", lang: "eng" }] }],
  ["catalog", { metas: [{ name: "Missing identity" }] }],
  ["stream", { streams: [null, {}] }],
])("does not turn entirely malformed %s entries into healthy empty results", async (resource, response) => {
  const instance = make({ ...raw(), resources: [resource], catalogs: resource === "catalog" ? [{ type: "movie", id: "works" }] : [] }, async () => response);
  const input = resource === "catalog" ? { type: "movie", id: "works" } : { type: "movie", videoId: "tt1" };
  await expect(instance[{ stream: "streams", catalog: "catalog", subtitles: "subtitles" }[resource]](input)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
});
it("bounds resource lists and returns structured errors without configured URLs", async () => {
  const a = make(raw(), async () => ({ subtitles: Array(1001).fill({}) }));
  await expect(a.subtitles({ type: "movie", videoId: "tt1" })).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  const b = make(raw(), async () => { throw Object.assign(new Error("https://addon.test/private-secret/manifest.json"), { status: 403 }); });
  await expect(b.subtitles({ type: "movie", videoId: "tt1" })).rejects.toMatchObject({ code: "HTTP_403", status: 403 });
  try { await b.subtitles({ type: "movie", videoId: "tt1" }); } catch (error) { expect(error.message).not.toContain("private-secret"); }
});
it("does not expose arbitrary transport status data or fail on a null rejection", async () => {
  const a = make(raw(), async () => { throw { status: "private-secret" }; });
  const error = await a.subtitles({ type: "movie", videoId: "tt1" }).catch((error) => error);
  expect(error.code).toBe("REQUEST_FAILED");
  expect(JSON.stringify(error)).not.toContain("private-secret");
  const b = make(raw(), async () => { throw null; });
  await expect(b.subtitles({ type: "movie", videoId: "tt1" })).rejects.toMatchObject({ code: "REQUEST_FAILED" });
});
it('uses native stream capabilities and forwards valid stream extraArgs on configured endpoints', async () => {
 let request;
 const adapter=createStremioAdapter({manifest,manifestUrl:'https://addon.test/settings/manifest.json?token=s',runtimeName:'apk',torrentSupported:true,transport:{json:async url=>{request=url;return {streams:[{infoHash:'0123456789abcdef0123456789abcdef01234567',fileIdx:2}]};}}});
 const [stream]=await adapter.streams({type:'series',videoId:'tt1196946:1:1',extra:{filename:'release.mkv',videoSize:100}});
 expect(stream).toMatchObject({type:'torrent',fileIdx:2,status:'RESOLVED'});
 expect(decodeURIComponent(new URL(request).pathname)).toContain('/settings/stream/series/tt1196946:1:1/filename=release.mkv&videoSize=100.json');
 expect(new URL(request).searchParams.get('token')).toBe('s');
});
it('allows long-running series metadata beyond 1000 episodes while bounding the list separately', async()=>{
 const manifest={key:'x',types:['series'],resources:[{name:'meta',types:['series']}],catalogs:[]};
 const videos=Array.from({length:1200},(_,i)=>({id:`kitsu:12:${i+1}`,episode:i+1}));
 const a=createStremioAdapter({manifest,manifestUrl:'https://addon.test/manifest.json',transport:{json:async()=>({meta:{id:'kitsu:12',type:'series',videos}})}});
 expect((await a.meta({type:'series',id:'kitsu:12'})).videos).toHaveLength(1200);
 videos.push(...Array.from({length:8801},(_,i)=>({id:String(i)})));
 await expect(a.meta({type:'series',id:'kitsu:12'})).rejects.toThrow();
});
