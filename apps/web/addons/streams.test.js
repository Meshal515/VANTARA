import { expect, it } from "vitest";
import { normalizeStreams } from "./streams.js";
it("preserves advertised UHD and source subtitles with release matching metadata", () => {
  const [s] = normalizeStreams(
    [
      {
        url: "https://cdn.test/4k.mp4",
        name: "2160p HDR",
        subtitles: [{ id: "ar", url: "https://cdn.test/ar.vtt", lang: "ar" }],
        behaviorHints: { filename: "release.mkv" },
      },
    ],
    { addonKey: "a" },
  );
  expect(s).toMatchObject({
    quality: 2160,
    hdr: true,
    filename: "release.mkv",
    status: "RESOLVED",
  });
  expect(s.subtitles).toHaveLength(1);
});
it("never advertises torrent, local, external or expired streams as Ready", () => {
  const out = normalizeStreams(
    [
      { infoHash: "abc" },
      { externalUrl: "https://site.test/video" },
      { url: "http://localhost:11470/a.mp4" },
      { url: "https://cdn.test/a.mp4", expiresAt: 1 },
    ],
    { addonKey: "a", now: 100 },
  );
  expect(
    out.every((x) => x.status === "UNSUPPORTED" || x.status === "EXPIRED"),
  ).toBe(true);
});
it("does not invent quality or HDR from a provider name", () =>
  expect(
    normalizeStreams([{ url: "https://cdn.test/a.mp4" }], {
      addonKey: "4K HDR Provider",
    })[0],
  ).toMatchObject({ quality: null, hdr: null }));
it("preserves an explicit HLS container on an extensionless URL and refuses required remote headers", () => {
  expect(
    normalizeStreams([{ url: "https://cdn.test/watch/token", type: "hls" }], {
      addonKey: "a",
    })[0].type,
  ).toBe("hls");
  expect(
    normalizeStreams(
      [
        {
          url: "https://cdn.test/video.mp4",
          headers: { Referer: "https://addon.test/" },
        },
      ],
      { addonKey: "a" },
    )[0].status,
  ).toBe("UNSUPPORTED");
});
