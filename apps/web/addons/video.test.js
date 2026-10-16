import { expect, it } from "vitest";
import { addonCopies, nextEpisodeCopies } from "./video.js";
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
it('uses canonical episode identity for cross-provider copies even when origin has a private ID', () => {
 const identity={kind:'series',addonKey:'origin',videoId:'private:episode',externalIds:{imdb:'tt123'},season:2,episode:3};
 expect(addonCopies({list:()=>[m]},identity)).toHaveLength(1);
});
it('chooses the declared canonical namespace separately for each anime stream provider',()=>{
 const kitsu={...m,key:'kitsu',resources:[{name:'stream',types:['series'],idPrefixes:['kitsu:']}]};
 const identity={kind:'anime',format:'TV',externalIds:{kitsu:'12',imdb:'tt123'},season:2,episode:3};
 const copies=addonCopies({list:()=>[kitsu,m]},identity);
 expect(copies.map(copy=>copy.url)).toEqual(['kitsu:12','tt123']);
});

it('does not retain a previous episode private video ID when advancing addon copies',()=>{
 const [next]=nextEpisodeCopies([{sourceId:'addon|origin',identity:{kind:'series',addonKey:'origin',videoId:'private:first',episode:1,season:2}}],2,{kind:'series',season:2});
 expect(next.identity.episode).toBe(2);expect(next.identity.videoId).toBeUndefined();
});
it('reaches anime add-ons that declare Kitsu streams only under the anime type', () => {
 const only={...m,resources:[{name:'stream',types:['anime'],idPrefixes:['kitsu:']}]};
 const identity={kind:'anime',format:'TV',externalIds:{kitsu:'12'},episode:3};
 expect(addonCopies({list:()=>[only]},identity,'apk')[0]).toMatchObject({url:'kitsu:12',type:'anime'});
 const both={...m,resources:[{name:'stream',types:['series','anime'],idPrefixes:['kitsu:']}]};
 expect(addonCopies({list:()=>[both]},identity,'apk')[0].type).toBe('series');
 expect(addonCopies({list:()=>[{...m,resources:[{name:'stream',types:['anime'],idPrefixes:['tt']}]}]},{kind:'series',externalIds:{imdb:'tt1'},season:1,episode:1})).toEqual([]);
});
