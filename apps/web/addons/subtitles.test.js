import { expect, it } from "vitest";
import { subtitleRequest, subtitleRequests, animeImdbAddresses, discoverSubtitles, toWebVtt } from "./subtitles.js";
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
it("converts ASS dialogue with declared event fields and centisecond timing", () => {
  const text = `[Script Info]
Title: this metadata is not a cue
[Events]
Format: Layer, End, Start, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Comment: 0,0:00:04.50,0:00:01.23,Default,,0,0,0,,do not render this comment
Dialogue: 0,0:00:04.50,0:00:01.23,Default,,0,0,0,,{\\an8\\i1}مرحبا، بالعالم, welcome{\\i0}\\Nالسطر الثاني\\nالسطر الثالث\\hهنا
[Fonts]
Dialogue: 0,0:00:09.00,0:00:08.00,Default,,0,0,0,,not an event
`;
  expect(toWebVtt(text)).toBe("WEBVTT\n\n00:00:01.230 --> 00:00:04.500\nمرحبا، بالعالم, welcome\nالسطر الثاني\nالسطر الثالث\u00a0هنا\n");
});
it("accepts SSA's Marked event field and preserves hours without rendering styles", () => {
  const text = `[Script Info]
ScriptType: v4.00
[V4 Styles]
Format: Name, Fontname, Fontsize
Style: Default,Arial,28
[Events]
Format: Marked, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: Marked=0,1:02:03.04,1:02:05.60,Default,,0000,0000,0000,,<i>النص</i> & الباقي
`;
  expect(toWebVtt(text)).toBe("WEBVTT\n\n01:02:03.040 --> 01:02:05.600\nالنص &amp; الباقي\n");
});
it("omits ASS drawing paths while retaining dialogue after drawing mode ends", () => {
  const text = `[Script Info]
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,{\\p1}m 0 0 l 100 0 100 100
Dialogue: 0,0:00:02.00,0:00:03.00,Default,,0,0,0,,قبل{\\p1\\an7}m 0 0 l 10 10{\\p0\\i1}بعد
`;
  expect(toWebVtt(text)).toBe("WEBVTT\n\n00:00:02.000 --> 00:00:03.000\nقبلبعد\n");
});
it("rejects invalid ASS event times and missing timing fields without inventing cues", () => {
  for (const event of [
    "Format: Start, End, Text\nDialogue: 0:00:99.00,0:00:01.00,invalid seconds",
    "Format: Start, End, Text\nDialogue: 0:00:03.00,0:00:01.00,backwards",
    "Format: Layer, Style, Text\nDialogue: 0,Default,missing time",
    "Format: Start, End, Text\nComment: 0:00:01.00,0:00:02.00,comment only",
  ]) expect(() => toWebVtt(`[Script Info]\n[Events]\n${event}`)).toThrow();
});
it("applies existing subtitle size and cue limits to ASS conversion", () => {
  const header = "[Script Info]\n[Events]\nFormat: Start, End, Text\n";
  expect(() => toWebVtt(header + "Dialogue: 0:00:01.00,0:00:02.00," + "x".repeat(2 * 1024 * 1024))).toThrow("أكبر من الحد");
  expect(() => toWebVtt(header + "Dialogue: 0:00:01.00,0:00:02.00,نص\n".repeat(20001))).toThrow("عدد أسطر");
});
it('preserves a provider-confirmed video identity for compatible non-IMDb subtitle providers',()=>{
 expect(subtitleRequest({kind:'series',addonKey:'https://addon.test|demo',videoId:'custom:episode:one',season:1,episode:1}, {videoHash:'0123456789abcdef',videoSize:12345})).toMatchObject({type:'series',videoId:'custom:episode:one',extra:{videoHash:'0123456789abcdef',videoSize:12345}});
 expect(subtitleRequest({kind:'series',title:'Custom episode'},{})).toBeNull();
});
it('does not invent a season for an explicit anime movie with an exact IMDb ID',()=>{
 expect(subtitleRequest({kind:'anime',format:'MOVIE',externalIds:{imdb:'tt123456'}})).toEqual({type:'movie',videoId:'tt123456',extra:{}});
});
it('uses a provider-specific exact request without requesting incompatible namespaces',async()=>{
 const calls=[], results=[];
 await discoverSubtitles({identity:{kind:'anime',format:'MOVIE',externalIds:{kitsu:'12',imdb:'tt123'}},providers:[{key:'imdb',request:()=>({type:'movie',videoId:'tt123',extra:{}}),subtitles:async input=>{calls.push(input);return [{url:'https://sub.test/a.srt',lang:'ara'}];}},{key:'wrong',request:()=>null,subtitles:async()=>{throw Error('must not request');}}],onResult:x=>results.push(x)});
 expect(calls[0].videoId).toBe('tt123');expect(results).toHaveLength(1);
});

it('عنوان حلقة الأنمي في IMDb: موسم TVDB ثم المطلق، وحلقة لم تصل الخريطة تكمل من آخر معروفة', () => {
  const map = { 1: [2, 13, 38], 2: [2, 14, 39] };
  expect(animeImdbAddresses(map, 1)).toEqual([[2, 13], [1, 38]]);
  expect(animeImdbAddresses(map, 5)).toEqual([[2, 17], [1, 42]]);
  expect(animeImdbAddresses(map, 40)).toEqual([]);
  expect(animeImdbAddresses({ 3: [1, 3, 3] }, 3)).toEqual([[1, 3]]);
  expect(subtitleRequests({ kind: 'anime', externalIds: { kitsu: '12', imdb: 'tt0388629' }, imdbEpisodes: { 62: [5, 2, 62] }, episode: 62 }).map(r => r.videoId))
    .toEqual(['kitsu:12:62', 'tt0388629:5:2', 'tt0388629:1:62']);
});

it('المزوّد يجرّب المعرّف التالي حين يرجع الأول فارغًا (One Piece مفهرس بالمطلق)', async () => {
  const asked = [];
  const found = [];
  await discoverSubtitles({
    identity: { kind: 'anime', externalIds: { imdb: 'tt0388629' }, imdbEpisodes: { 62: [5, 2, 62] }, episode: 62 },
    providers: [{ key: 'os', subtitles: async (req) => { asked.push(req.videoId); return req.videoId === 'tt0388629:1:62' ? [{ url: 'https://subs.test/a.srt', lang: 'ara' }] : []; } }],
    onResult: (t) => found.push(t),
  });
  expect(asked).toEqual(['tt0388629:5:2', 'tt0388629:1:62']);
  expect(found.map(t => t.lang)).toEqual(['ar']);
});
