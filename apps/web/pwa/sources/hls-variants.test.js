import { expect, it } from "vitest";
import { hlsVariants } from "./hls-variants.js";
it("extracts real master variants preserving resolution and relative signed URLs", () => {
  const s = {
    url: "https://cdn.test/master.m3u8?sig=a",
    type: "hls",
    referer: "https://host.test/",
  };
  const list = hlsVariants(
    "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1,RESOLUTION=852x480\n480/index.m3u8?sig=b\n#EXT-X-STREAM-INF:RESOLUTION=1920x1080\nhttps://cdn.test/1080.m3u8\n#EXT-X-STREAM-INF:RESOLUTION=3840x2160\n4k.m3u8",
    s,
  );
  expect(list.map((x) => x.quality)).toEqual([480, 1080, 2160]);
  expect(list[0].url).toBe("https://cdn.test/480/index.m3u8?sig=b");
  expect(list[0].referer).toBe(s.referer);
});
it("does not invent qualities for a media playlist or unsafe URI", () => {
  expect(
    hlsVariants("#EXTM3U\n#EXTINF:4\nchunk.ts", {
      url: "https://cdn.test/a.m3u8",
    }),
  ).toEqual([]);
  expect(
    hlsVariants(
      "#EXTM3U\n#EXT-X-STREAM-INF:RESOLUTION=1920x1080\njavascript:alert(1)",
      { url: "https://cdn.test/a.m3u8" },
    ),
  ).toEqual([]);
});
it("bounds a stalled master even when the playback session supplies a signal", async () => {
  const { vi } = await import("vitest");
  const { discoverHlsVariants } = await import("./hls-variants.js");
  vi.useFakeTimers();
  const old = globalThis.fetch;
  globalThis.fetch = (_u, { signal }) =>
    new Promise((_resolve, reject) =>
      signal.addEventListener("abort", () =>
        reject(new DOMException("aborted", "AbortError")),
      ),
    );
  try {
    const done = discoverHlsVariants(
      { url: "https://cdn.test/master.m3u8" },
      {
        ensureGrant: async () => ({}),
        mediaUrl: () => "https://edge.test/v1/media",
      },
      { signal: new AbortController().signal },
    ).catch((e) => e.name);
    await vi.advanceTimersByTimeAsync(8001);
    expect(await done).toBe("AbortError");
  } finally {
    globalThis.fetch = old;
    vi.useRealTimers();
  }
}, 1000);
it.each(['AUDIO','SUBTITLES'])('keeps the master when %s lives in an external rendition', kind => {
 const text=`#EXTM3U\n#EXT-X-MEDIA:TYPE=${kind},GROUP-ID="extra",URI="extra.m3u8"\n#EXT-X-STREAM-INF:RESOLUTION=1920x1080,${kind}="extra"\nvideo.m3u8`;
 expect(hlsVariants(text,{url:'https://cdn.test/master.m3u8'})).toEqual([]);
});
