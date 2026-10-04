import { expect, it } from "vitest";
import { validateManifest, publicUrl, safeUrlLabel } from "./manifest.js";
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
