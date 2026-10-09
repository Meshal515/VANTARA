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
it('keeps valid siblings when a provider returns malformed stream entries',()=>{
 const out=normalizeStreams([null,42,'wrong',{url:'https://cdn.test/a.mp4',name:'1080p'}],{addonKey:'a'});
 expect(out).toHaveLength(4);expect(out[0].status).toBe('UNSUPPORTED');expect(out[3]).toMatchObject({status:'RESOLVED',quality:1080});
});
it('preserves real subtitle file matching hints and refuses response-header-only proxy requirements',()=>{
 const [s]=normalizeStreams([{url:'https://cdn.test/a.mp4',behaviorHints:{filename:'real.mkv',videoHash:'0123456789abcdef',videoSize:12345,proxyHeaders:{response:{'Access-Control-Allow-Origin':'*'}}}}],{addonKey:'a'});
 expect(s).toMatchObject({filename:'real.mkv',videoHash:'0123456789abcdef',videoSize:12345,status:'UNSUPPORTED'});
});

it('routes native HTTP request headers and browser-only hints without pretending PWA can proxy them', () => {
 const raw=[{url:'https://cdn.test/movie.mkv', name:'2160p HDR', behaviorHints:{notWebReady:true,proxyHeaders:{request:{Referer:'https://provider.test/', 'User-Agent':'Player'},response:{'Access-Control-Allow-Origin':'*'}}}}];
 expect(normalizeStreams(raw,{addonKey:'a',runtimeName:'apk'})[0]).toMatchObject({status:'RESOLVED',type:'mp4',quality:2160,headers:{Referer:'https://provider.test/','User-Agent':'Player'}});
 expect(normalizeStreams(raw,{addonKey:'a'})[0].status).toBe('UNSUPPORTED');
});
it('keeps native torrent file identity and peer hints only when a real torrent runtime is present', () => {
 const infoHash='0123456789abcdef0123456789abcdef01234567';
 const raw=[{infoHash,fileIdx:3,sources:['tracker:udp://tracker.example.com:80','dht:'+infoHash],name:'Torrentio 4K',title:'Release',behaviorHints:{filename:'release.mkv',videoSize:123456,notWebReady:true}}];
 expect(normalizeStreams(raw,{addonKey:'a',runtimeName:'apk',torrentSupported:true})[0]).toMatchObject({status:'RESOLVED',type:'torrent',infoHash,fileIdx:3,filename:'release.mkv',quality:2160,sources:raw[0].sources});
 expect(normalizeStreams(raw,{addonKey:'a',runtimeName:'apk'})[0].status).toBe('UNSUPPORTED');
 expect(normalizeStreams(raw,{addonKey:'a',torrentSupported:true})[0].status).toBe('UNSUPPORTED');
});
it('does not confuse torrent hash with the OpenSubtitles movie hash and isolates malformed native fields', () => {
 const infoHash='0123456789abcdef0123456789abcdef01234567';
 const out=normalizeStreams([{infoHash,fileIdx:-1},{infoHash:'garbage'},{url:'https://cdn.test/a.mp4',headers:{Referer:'bad\r\nInjected: x'}},{infoHash}],{addonKey:'a',runtimeName:'apk',torrentSupported:true});
 expect(out.slice(0,3).every(x=>x.status==='UNSUPPORTED')).toBe(true);
 expect(out[3]).toMatchObject({status:'RESOLVED',type:'torrent',fileIdx:null,videoHash:null});
});
it('accepts a valid magnet result natively and preserves the selected file index', () => {
 const hash='0123456789abcdef0123456789abcdef01234567';
 expect(normalizeStreams([{url:`magnet:?xt=urn:btih:${hash}&tr=udp%3A%2F%2Ftracker.example.com%3A80`,fileIdx:0}],{addonKey:'a',runtimeName:'apk',torrentSupported:true})[0]).toMatchObject({type:'torrent',status:'RESOLVED',infoHash:hash,fileIdx:0});
});
