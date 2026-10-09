import { expect, it } from "vitest";
import { validateManifest, publicUrl, safeUrlLabel } from "./manifest.js";
import { readFileSync } from "node:fs";
const native = () => ({
  id: "demo.manga",
  name: "Demo",
  version: "1.0.0",
  protocolVersion: 1,
  minVantaraVersion: "0.1.0",
  runtime: "remote",
  contentTypes: ["manga"],
  capabilities: ["search", "details", "chapters", "pages"],
  baseUrl: "https://demo.test/api/",
  resources: {
    search: "/search?query={query}",
    details: "/details/{workId}",
    chapters: "/chapters/{workId}",
    pages: "/pages/{chapterId}",
  },
  permissions: { networkHosts: ["demo.test"], verification: false },
});
const check = (raw) =>
  validateManifest(raw, {
    origin: "https://demo.test",
    productVersion: "0.2.0",
  });
it("validates data-only remote capabilities and prevents self-declared official trust", () => {
  const x = check({ ...native(), official: true });
  expect(x.errors).toEqual([]);
  expect(x.manifest.official).toBe(false);
  expect(x.manifest.key).toBe("https://demo.test|demo.manga");
});
it.each([
  null,
  { ...native(), protocolVersion: 42 },
  { ...native(), runtime: "javascript" },
  { ...native(), minVantaraVersion: "9.0.0" },
  { ...native(), permissions: { networkHosts: ["*"] } },
  { ...native(), resources: { search: "https://evil.test/x" } },
])("rejects invalid or incompatible manifest %#", (raw) =>
  expect(check(raw).errors.length).toBeGreaterThan(0),
);
const observed = (name) => JSON.parse(readFileSync(new URL(`../../../docs/addons/rebuild/research/${name}-manifest.observed.json`, import.meta.url), "utf8")).manifest;
it.each(["cinemeta", "opensubtitles-v3", "subdl", "subsource", "subsro"])("accepts observed public %s manifest semantics", (name) => {
  const raw = observed(name);
  const result = check(raw);
  expect(result.errors).toEqual([]);
  expect(result.manifest.types).toEqual(raw.types);
  expect(result.manifest.capabilities).not.toContain("addon_catalog");
});
it("normalizes setup requirements and preserves safe external branding", () => {
  const result = check({ ...observed("subdl"), logo: "https://cdn.test/subdl.png" });
  expect(result.manifest.configuration).toEqual({ required: true, configurable: true, configured: false });
  expect(result.manifest.logo).toBe("https://cdn.test/subdl.png");
});
it("keeps prefix absence separate from explicit empty resource prefixes", () => {
  const raw = { ...observed("opensubtitles-v3"), resources: [{ name: "subtitles", types: ["movie"] }, { name: "stream", types: ["movie"], idPrefixes: [] }] };
  const result = check(raw);
  expect(result.manifest.resources[0]).not.toHaveProperty("idPrefixes");
  expect(result.manifest.resources[1].idPrefixes).toEqual([]);
});
it("retains unknown resources for diagnostics without executable capabilities", () => {
  const raw = { ...observed("opensubtitles-v3"), resources: ["subtitles", "future_resource", "addon_catalog"] };
  const result = check(raw);
  expect(result.errors).toEqual([]);
  expect(result.manifest.capabilities).toEqual(["subtitles"]);
  expect(result.manifest.diagnostics.unsupportedResources).toEqual(["future_resource", "addon_catalog"]);
});
it("keeps unfamiliar safe content types outside VANTARA cinema categories", () => {
  const raw = { ...observed("opensubtitles-v3"), types: ["Podcasts", "tv", "channel", "subtitles"] };
  const result = check(raw);
  expect(result.errors).toEqual([]);
  expect(result.manifest.types).toEqual(raw.types);
  expect(result.manifest.contentTypes).toEqual([]);
});
it("accepts semantic versions carrying prerelease and build identifiers", () => {
  expect(check({ ...observed("opensubtitles-v3"), version: "1.2.3-rc.1+build.42" }).errors).toEqual([]);
});
it.each([
  { types: ["movie\nunsafe"] },
  { resources: [{ name: "subtitles", types: {} }] },
  { catalogs: [{ type: "movie", id: "x", extra: [{ name: "search", isRequired: "yes" }] }] },
  { behaviorHints: { configurationRequired: "yes" } },
])("rejects malformed Stremio nested data safely %#", (patch) => {
  const result = check({ ...observed("opensubtitles-v3"), ...patch });
  expect(result.manifest).toBeNull();
  expect(result.errors.length).toBeGreaterThan(0);
});
it("normalizes real Stremio resources and preserves advertised filtering", () => {
  const x = check({
    id: "org.subtitles",
    name: "Subtitles",
    version: "1.0.0",
    types: ["movie", "series"],
    resources: [{ name: "subtitles", types: ["series"], idPrefixes: ["tt"] }],
    catalogs: [],
  });
  expect(x.errors).toEqual([]);
  expect(x.manifest.protocol).toBe("stremio");
  expect(x.manifest.capabilities).toEqual(["subtitles"]);
  expect(x.manifest.resources[0].types).toEqual(["series"]);
});
it("supports each Stremio request capability on APK independently of torrent playback", () => {
  const result = check({ id: "org.native", name: "Native", version: "1.0.0", types: ["movie", "series"], resources: ["catalog", "meta", "stream", "subtitles"], catalogs: [{ type: "movie", id: "top" }] });
  expect(result.errors).toEqual([]);
  expect(result.compatibility.apk).toBe(true);
  expect(result.compatibility.apkCapabilities).toEqual(["catalog", "meta", "streams", "subtitles"]);
});
it("keeps Stremio opaque manifest IDs separate from VANTARA Remote v1 identifier rules", () => {
 const id="stremio.addons.mediafusion|elfhosted";
 const stremio={id,name:"MediaFusion",version:"1.0.0",types:["movie"],resources:["stream"],catalogs:[]};
 expect(check(stremio).manifest).toMatchObject({id,key:`https://demo.test|${id}`});
 expect(check({...native(),id}).errors).toContain("id");
 for(const unsafe of [".","..","../other","other/work","bad\\id","bad\nidentity","a".repeat(161)])
  expect(check({...stremio,id:unsafe}).errors).toContain("id");
});
it.each([
  "http://demo.test",
  "https://127.0.0.1/x",
  "https://[::1]/x",
  "https://192.168.1.1/x",
  "https://demo.local/x",
  "https://localhost/x",
  "https://a@demo.test/x",
  "javascript:alert(1)",
  "https://demo.test:8443/x",
])("rejects unsafe URL %s", (url) => expect(() => publicUrl(url)).toThrow());
it("redacts configured URL path and query from labels", () => {
  expect(
    safeUrlLabel("https://demo.test/secret-token/manifest.json?key=abc"),
  ).toBe("demo.test");
});
it.each([
  {
    id: "demo.bad",
    name: "Bad",
    version: "1.0.0",
    types: ["movie"],
    resources: [null],
  },
  { ...native(), capabilities: {} },
  { ...native(), capabilities: 4 },
])(
  "rejects malformed nested fields without crashing the installer %#",
  (raw) => {
    const result = check(raw);
    expect(result.manifest).toBeNull();
    expect(result.errors.length).toBeGreaterThan(0);
  },
);
