import { expect, it } from "vitest";
import { catalogExtras, matchesStremioResource, normalizeStremioManifest } from "./stremio-model.js";
const raw = () => ({ types: ["movie"], resources: ["subtitles"], catalogs: [] });
it("unknown resource names cannot acquire object prototype capabilities", () => {
  const model = normalizeStremioManifest({ ...raw(), resources: ["subtitles", "constructor", "__proto__", "toString"] });
  expect(model.capabilities).toEqual(["subtitles"]);
  expect(model.diagnostics.unsupportedResources).toEqual(["constructor", "__proto__", "toString"]);
});
it("matches shorthand prefixes but omitted prefixes accept every namespace", () => {
  const a = normalizeStremioManifest({ ...raw(), idPrefixes: ["tt"] });
  expect(matchesStremioResource(a, "subtitles", "movie", "custom:1")).toBe(false);
  expect(matchesStremioResource(a, "subtitles", "movie", "tt1")).toBe(true);
  const b = normalizeStremioManifest(raw());
  expect(matchesStremioResource(b, "subtitles", "movie", "custom:1")).toBe(true);
  expect(b).not.toHaveProperty("idPrefixes");
});
it("an explicit empty string prefix retains the protocol's match-all meaning", () => {
  const model = normalizeStremioManifest({ ...raw(), idPrefixes: [""] });
  expect(model.errors).toEqual([]);
  expect(matchesStremioResource(model, "subtitles", "movie", "custom:1")).toBe(true);
});
it("normalizes legacy catalog extras without overriding modern extras", () => {
  expect(catalogExtras({ extraSupported: ["search", "genre"], extraRequired: ["genre"], genres: ["Drama"] })).toEqual([{ name: "search", isRequired: false }, { name: "genre", isRequired: true, options: ["Drama"] }]);
  expect(catalogExtras({ extra: [{ name: "skip" }], extraSupported: ["search"] })).toEqual([{ name: "skip" }]);
});
it("catalogs imply a catalog capability independently of resources", () => {
  const a = normalizeStremioManifest({ ...raw(), catalogs: [{ type: "channel", id: "feed" }] });
  expect(a.capabilities).toContain("catalog");
  expect(matchesStremioResource(a, "catalog", "channel", "feed")).toBe(true);
});
it("rejects dot-only external types that normalize resource paths", () => {
  expect(normalizeStremioManifest({ ...raw(), types: [".."] }).errors).toContain("types");
});
it("rejects non-data nested fields without throwing", () => {
  expect(() => normalizeStremioManifest({ ...raw(), catalogs: [{ type: "movie", id: "feed", extra: [{ name: "search" }], callback: () => {} }] })).not.toThrow();
  expect(normalizeStremioManifest({ ...raw(), behaviorHints: { callback: () => {} } }).errors).toContain("behaviorHints");
  expect(normalizeStremioManifest({ ...raw(), config: [{ key: "setting", type: "text", callback: () => {} }] }).errors).toContain("config");
});
it('projects legacy catalog filters into the internal extra model consumed by Source Mode and search',()=>{
 const a=normalizeStremioManifest({...raw(),catalogs:[{type:'movie',id:'legacy',extraSupported:['search','genre','skip'],extraRequired:['genre'],genres:['Drama','Action']}]});
 expect(a.catalogs[0].extra).toEqual([{name:'search',isRequired:false},{name:'genre',isRequired:true,options:['Drama','Action']},{name:'skip',isRequired:false}]);
 expect(a.catalogs[0].extraRequired).toEqual(['genre']);
});
