import { expect, it } from "vitest";
import { candidatePaths } from "./media.js";
it("external addon media uses anonymous direct transport without the core grant or arbitrary proxy", async () => {
  const runtime = {
    ensureMedia: async () => {
      throw new Error("auth");
    },
    fetcher: {
      mediaUrl: () => {
        throw new Error("proxy");
      },
    },
  };
  expect(
    await candidatePaths(
      { sourceId: "addon|demo", url: "https://cdn.test/video.mp4" },
      runtime,
    ),
  ).toEqual([["direct", "https://cdn.test/video.mp4"]]);
  await expect(
    candidatePaths(
      { sourceId: "addon|demo", url: "https://127.0.0.1/x" },
      runtime,
    ),
  ).rejects.toThrow();
});
it("keeps the known core direct and edge fallback unchanged", async () =>
  expect(
    await candidatePaths(
      {
        sourceId: "akwam",
        url: "https://cdn.test/v",
        referer: "https://akwam.ss",
      },
      {
        ensureMedia: async () => {},
        fetcher: { mediaUrl: () => "https://edge.test/v" },
      },
    ),
  ).toEqual([
    ["direct", "https://cdn.test/v"],
    ["edge", "https://edge.test/v"],
  ]));
