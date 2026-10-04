import { expect, it } from "vitest";
import { sourceWorkModel } from "./work-view.js";
it("makes a source-only manga copy with its memo instead of title merging", () => {
  const w = sourceWorkModel(
    { url: "chapter-work", title: "Same title", memo: '{"mangaPath":"a"}' },
    {
      addon: { key: "remote|1", sourceId: "addon|1", contentTypes: ["manga"] },
      episodes: [],
    },
  );
  expect(w._work.editions[0].manga.memo).toContain("mangaPath");
  expect(w.id).toContain("provider");
});
it("preserves real per-season episode identities for a series and its selected source", () => {
  const w = sourceWorkModel(
    { id: "tt1196946", name: "Mentalist", type: "series" },
    {
      addon: { key: "demo", contentTypes: ["series"] },
      episodes: [
        { url: "tt1196946:1:1", number: 1, season: 1 },
        { url: "tt1196946:2:1", number: 1, season: 2 },
      ],
    },
  );
  expect(w.seasons.map((s) => s.n)).toEqual([1, 2]);
  expect(w._sourceCopy.url).toBe("tt1196946");
  expect(w._sourceCopy.type).toBe("series");
  expect(w.externalIds.imdb).toBe("tt1196946");
});
it("uses the existing cinema IMDb reference and keeps provider-local IDs opaque to season parsing", () => {
  const addon = {
    key: "https://addon.test|org.demo",
    contentTypes: ["movie", "series"],
  };
  expect(
    sourceWorkModel(
      { id: "tt1254207", name: "Big Buck Bunny", type: "movie" },
      { addon },
    ).id,
  ).toBe("tt1254207");
  const a = sourceWorkModel(
    { id: "custom:1", name: "Same", type: "movie" },
    { addon },
  );
  const b = sourceWorkModel(
    { id: "custom:2", name: "Same", type: "movie" },
    { addon },
  );
  expect(a.id).not.toContain(":");
  expect(a.id).not.toBe(b.id);
  expect(a.canonicalId).toContain("provider:");
});
it('uses proven bundled movie identity and rejects ambiguous mixed content instead of inventing a series',()=>{
 const addon={bundled:true,key:'core|akwam',sourceId:'akwam',contentTypes:['movie','series']};
 expect(sourceWorkModel({url:'https://akwam.test/movie/123',title:'Dune'},{addon,episodes:[{number:1}]}).type).toBe('movie');
 expect(()=>sourceWorkModel({url:'https://akwam.test/work/123',title:'Unknown'},{addon,episodes:[{number:1}]})).toThrow();
});
it('round-trips local provider IDs and reopens them through the installed provider instead of Cinemeta',async()=>{
 const {restoreSourceWork}=await import('./work-view.js');
 const addon={key:'https://addon.test|org.demo',protocol:'stremio',enabled:true,contentTypes:['movie','series']};
 const original=sourceWorkModel({id:'custom:42',title:'Local film',type:'movie'},{addon});
 const requests=[];const restored=await restoreSourceWork(`cinema:${original.id}`,{addons:{registry:{list:()=>[addon]},adapter:()=>({meta:async x=>{requests.push(x);return {id:x.id,type:'movie',name:'Local film'};}}),sources:{source:()=>({episodes:async()=>[{number:1}]})}}});
 expect(restored.id).toBe(original.id);expect(restored._sourceCopy.id).toBe('custom:42');expect(requests[0].id).toBe('custom:42');
});
it('retains the provider identity when anime has only a MAL ID, and fails clearly if its addon is missing',async()=>{
 const {restoreSourceWork}=await import('./work-view.js');const addon={key:'https://remote.test|demo',enabled:true,contentTypes:['anime']};
 const w=sourceWorkModel({id:'local-42',title:'Anime',externalIds:{mal:'42'}},{addon,episodes:[{number:1}]});
 expect(decodeURIComponent(w.id)).toContain('provider:');expect(w.externalIds.mal).toBe('42');
 await expect(restoreSourceWork(`anime:${w.id}`,{addons:{registry:{list:()=>[]}}})).rejects.toThrow('ثبّت');
});
