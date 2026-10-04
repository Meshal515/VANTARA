import { expect, it } from "vitest";
import { subtitleRequest, discoverSubtitles, toWebVtt } from "./subtitles.js";
it("matches episode by explicit IMDb and season/episode, never title alone", () => {
  expect(
    subtitleRequest(
      {
        kind: "series",
        externalIds: { imdb: "tt1196946" },
        season: 1,
        episode: 1,
      },
      { filename: "release.mkv" },
    ),
  ).toMatchObject({
    type: "series",
    videoId: "tt1196946:1:1",
    extra: { filename: "release.mkv" },
  });
  expect(
    subtitleRequest({ kind: "anime", title: "Mentalist", episode: 1 }, {}),
  ).toBeNull();
  expect(
    subtitleRequest(
      { kind: "series", externalIds: { imdb: "tt1" }, episode: 1 },
      {},
    ),
  ).toBeNull();
});
it("publishes real results before a dead subtitle provider completes", async () => {
  const c = new AbortController(),
    found = [];
  let release;
  const providers = [
    {
      key: "slow",
      name: "Slow",
      subtitles: async () => {
        await new Promise((r) => (release = r));
        return [];
      },
    },
    {
      key: "fast",
      name: "Fast",
      subtitles: async () => [
        { id: "1", url: "https://subs.test/ar.srt", lang: "ara" },
      ],
    },
  ];
  const done = discoverSubtitles({
    identity: { kind: "movie", externalIds: { imdb: "tt1" } },
    stream: {},
    providers,
    signal: c.signal,
    onResult: (t) => found.push(t),
  });
  await new Promise((r) => setTimeout(r, 5));
  expect(found).toHaveLength(1);
  expect(found[0]).toMatchObject({
    kind: "addon",
    lang: "ar",
    match: "episode",
  });
  c.abort();
  release();
  await done;
});
it("converts Arabic SRT safely and retains timing without rendering HTML", () => {
  const v = toWebVtt(
    "1\n00:00:01,200 --> 00:00:03,500\nمرحبا <script>alert(1)</script>\n",
  );
  expect(v).toContain("WEBVTT");
  expect(v).toContain("00:00:01.200 --> 00:00:03.500");
  expect(v).not.toContain("<script>");
  expect(() => toWebVtt("not subtitles")).toThrow();
});
it('preserves a provider-confirmed video identity for compatible non-IMDb subtitle providers',()=>{
 expect(subtitleRequest({kind:'series',addonKey:'https://addon.test|demo',videoId:'custom:episode:one',season:1,episode:1}, {videoHash:'0123456789abcdef',videoSize:12345})).toMatchObject({type:'series',videoId:'custom:episode:one',extra:{videoHash:'0123456789abcdef',videoSize:12345}});
 expect(subtitleRequest({kind:'series',title:'Custom episode'},{})).toBeNull();
});
