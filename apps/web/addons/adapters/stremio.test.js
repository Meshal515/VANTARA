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
