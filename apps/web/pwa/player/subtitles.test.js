import { expect, it } from "vitest";
import { parseHTML } from "linkedom";
import { createSubtitleSession } from "./subtitles.js";
function setup(providers = []) {
  const { document } = parseHTML("<html><body></body></html>");
  globalThis.document = document;
  const video = document.createElement("video");
  video.textTracks = [];
  const s = createSubtitleSession({
    video,
    providers,
    transport: {
      text: async () => "WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nمرحبا",
    },
    getHls: () => null,
  });
  return { s, video };
}
it("hardcoded or Arabic audio alone creates no track and no fake subtitle UI", () => {
  const { s } = setup();
  s.setStream({ id: "1", hardcodedArabic: true, audio: [{ lang: "ar" }] });
  expect(s.tracks()).toEqual([]);
  expect(s.available()).toBe(false);
  s.close();
});
it("source soft subtitles appear immediately without a provider", () => {
  const { s } = setup();
  s.setStream({
    id: "1",
    subtitles: [{ url: "https://subs.test/ar.vtt", lang: "ar" }],
  });
  expect(s.available()).toBe(true);
  expect(s.tracks()[0]).toMatchObject({ kind: "source", lang: "ar" });
  s.close();
});
it("ignores late provider results on server switch and never touches video playback", async () => {
  let release;
  const provider = {
    key: "p",
    name: "Provider",
    subtitles: async () => {
      await new Promise((r) => (release = r));
      return [{ id: "old", lang: "ar", url: "https://subs.test/old.srt" }];
    },
  };
  const { s, video } = setup([provider]);
  let plays = 0;
  video.play = () => {
    plays++;
  };
  s.setStream({
    id: "one",
    identity: { kind: "movie", externalIds: { imdb: "tt1" } },
  });
  await Promise.resolve();
  s.setStream({ id: "two", subtitles: [] });
  release();
  await new Promise((r) => setTimeout(r, 5));
  expect(s.tracks()).toEqual([]);
  expect(plays).toBe(0);
  s.close();
});
it("a provider failure leaves the video source intact and finishes empty honestly", async () => {
  const { s, video } = setup([
    {
      key: "p",
      subtitles: async () => {
        throw new Error("failed");
      },
    },
  ]);
  video.src = "https://video.test/movie.mp4";
  s.setStream({
    id: "1",
    identity: { kind: "movie", externalIds: { imdb: "tt1" } },
  });
  await new Promise((r) => setTimeout(r, 5));
  expect(video.src).toBe("https://video.test/movie.mp4");
  expect(s.pending()).toBe(false);
  expect(s.available()).toBe(false);
  s.close();
});
it("keeps an explicit Off selection when metadata arrives again", async () => {
  const { s, video } = setup();
  s.setStream({
    id: "1",
    subtitles: [{ url: "https://subs.test/ar.vtt", lang: "ar" }],
  });
  await s.select(null);
  video.dispatchEvent(new document.defaultView.Event("loadedmetadata"));
  await new Promise((r) => setTimeout(r, 0));
  expect(s.selected()).toBeNull();
  expect(video.querySelector("track")).toBeNull();
  s.close();
});
it("orders Arabic source tracks before other source languages", () => {
  const { s } = setup();
  s.setStream({
    id: "1",
    subtitles: [
      { url: "https://subs.test/en.vtt", lang: "en" },
      { url: "https://subs.test/ar.vtt", lang: "ar" },
    ],
  });
  expect(s.tracks().map((t) => t.lang)).toEqual(["ar", "en"]);
  s.close();
});
it('does not let an untyped builtin cinema candidate erase the confirmed series identity',async()=>{
 let calls=0;const {document}=parseHTML('<html><body></body></html>');globalThis.document=document;const video=document.createElement('video');video.textTracks=[];
 const s=createSubtitleSession({video,identity:{kind:'series',externalIds:{imdb:'tt1196946'},season:1,episode:1},providers:[{key:'real',subtitles:async req=>{calls++;expect(req.videoId).toBe('tt1196946:1:1');return [];}}]});
 s.setStream({identity:{kind:'cinema',externalIds:undefined,season:1,episode:1}});await new Promise(r=>setTimeout(r,5));expect(calls).toBe(1);s.close();
});
