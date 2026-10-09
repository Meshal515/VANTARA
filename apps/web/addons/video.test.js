import { expect, it } from "vitest";
import { addonCopies } from "./video.js";
const m = {
  key: "x",
  name: "Streams",
  enabled: true,
  bundled: false,
  contentTypes: ["series"],
  capabilities: ["streams"],
  resources: [{ name: "stream", types: ["series"], idPrefixes: ["tt"] }],
  types: ["series"],
  idPrefixes: [],
  protocol: "stremio",
};
it("adds only explicitly compatible episode-ID providers, never a guessed anime title", () => {
  const registry = { list: () => [m] };
  const out = addonCopies(registry, {
    kind: "series",
    externalIds: { imdb: "tt1196946" },
    season: 1,
    episode: 1,
  });
  expect(out[0]).toMatchObject({
    sourceId: "addon|x",
    url: "tt1196946",
    episode: 1,
    requestedSeason: 1,
  });
  expect(
    addonCopies(registry, { kind: "anime", title: "Mentalist", episode: 1 }),
  ).toEqual([]);
});
it('uses the same resource matching semantics and does not assign unknown work IDs to new providers',()=>{
 const identity={kind:'series',externalIds:{imdb:'tt1196946'},season:1,episode:1};
 expect(addonCopies({list:()=>[{...m,resources:[{name:'stream',types:['series'],idPrefixes:[]}]}]},identity)).toEqual([]);
 expect(addonCopies({list:()=>[{...m,idPrefixes:['different'],resources:[{name:'stream',types:['series']}]}]},identity)).toHaveLength(1);
 expect(addonCopies({list:()=>[{...m,configuration:{required:true,configured:false}}]},identity)).toEqual([]);
 expect(addonCopies({list:()=>[m]},{kind:'series',addonKey:'x',videoId:'custom:one',season:1,episode:1})).toEqual([]);
});
it('fans out exact Kitsu anime IDs and leaves the AniList season out of the video ID', () => {
 const anime={...m,resources:[{name:'stream',types:['series','movie'],idPrefixes:['kitsu:']}]};
 const identity={kind:'anime',format:'TV',externalIds:{anilist:'21',kitsu:'12'},season:3,episode:1101};
 expect(addonCopies({list:()=>[anime]},identity,'apk')[0]).toMatchObject({url:'kitsu:12',id:'kitsu:12',type:'series',identity});
 expect(addonCopies({list:()=>[m]},identity,'apk')).toEqual([]);
 expect(addonCopies({list:()=>[anime]},{...identity,format:'MOVIE'},'apk')[0].type).toBe('movie');
});
