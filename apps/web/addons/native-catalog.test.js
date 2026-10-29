import { afterEach, expect, it, vi } from 'vitest';
import { parseHTML } from 'linkedom';
import { createNativeCatalog, diagnoseManagedAddon } from './native-catalog.js';
import { sourceWorkModel } from './work-view.js';
import { renderSourceMode } from '../v35/source-mode.js';

afterEach(()=>vi.unstubAllGlobals());

it('routes CloudStream seasons through its actual optional bridge and gives each selection a distinct local work identity',async()=>{
 const id='addon|cs3|cs3_123|source',url='https://source.test/work';
 const plugins={VantaraRuntime:{capabilities:async()=>({cloudstream:true,platform:'android'}),seasons:async()=>({seasons:[{sourceId:id,url,title:'Work · 1',requestedSeason:1,hasSeasons:false},{sourceId:id,url,title:'Work · 2',requestedSeason:2,hasSeasons:false}]})},
  AnimeEngine:{sources:async()=>({sources:[{id,pkg:'cs3_123',name:'Source',content:'anime'}]}),page:async()=>{},details:async()=>{},episodes:async()=>({episodes:[]})}};
 const result=await createNativeCatalog({pkg:'cs3_123',protocol:'cloudstream',_store:{kind:'anime'}},{plugins});
 expect(typeof result.adapter.seasons).toBe('function');
 const seasons=await result.adapter.seasons({sourceId:id,url,title:'Work',hasSeasons:true});
 expect(seasons.map(x=>x.url)).toEqual([url,url]);
 const works=seasons.map(item=>sourceWorkModel(item,{addon:result.addon}));
 expect(works[0].id).not.toBe(works[1].id);
 expect(works[1]._sourceCopy).toMatchObject({url,requestedSeason:2});
});

it('admits CloudStream only after Android measures a real runtime and declares this installed package source',async()=>{
  const id='addon|cs3|cs3_123|provider';
  const record={pkg:'cs3_123',protocol:'cloudstream',_store:{kind:'anime'}};
  const engine={sources:async()=>({sources:[{id,pkg:'cs3_123',name:'Actual provider',content:'anime'}]}),
    page:async()=>({page:{items:[{sourceId:id,url:'https://source.test/work',title:'Actual work'}],hasNext:false}}),details:async()=>({}),episodes:async()=>({episodes:[]})};
  expect((await createNativeCatalog(record,{plugins:{AnimeEngine:engine}})).status).toBe('incompatible');
  const result=await createNativeCatalog(record,{plugins:{AnimeEngine:engine,VantaraRuntime:{capabilities:async()=>({cloudstream:true,platform:'android'})}}});
  expect(result.status).toBe('ready');
  expect((await result.adapter.catalogue(1)).items[0].sourceId).toBe(id);
  expect((await createNativeCatalog(record,{plugins:{AnimeEngine:engine,VantaraRuntime:{capabilities:async()=>({cloudstream:true,platform:'desktop'})}}})).status).toBe('incompatible');
});

it('diagnoses an installed native package through its actual canonical source, never its display name',async()=>{
 const diagnose=vi.fn(async key=>({checks:[{capability:'home',state:'passed',message:key}]}));
 const runtime={registry:{list:()=>[{key:'core|wrong',name:mangaRecord.name,sourceId:'unrelated'},{key:'core|actual',sourceId:'org.native.reader#123'}]},diagnose,reloadSources:async()=>{}};
 const result=await diagnoseManagedAddon(mangaRecord,{runtime,plugins:{ExtensionEngine:mangaPlugin()}});
 expect(result.checks).toContainEqual(expect.objectContaining({capability:'home',state:'passed',message:'core|actual'}));
 expect(diagnose.mock.calls.map(x=>x[0])).toEqual(['core|actual']);
});
it('reports an unresolved native binding without pretending its network functions passed',async()=>{
 const diagnose=vi.fn();
 const result=await diagnoseManagedAddon(mangaRecord,{runtime:{registry:{list:()=>[]},diagnose},plugins:{ExtensionEngine:mangaPlugin()}});
 expect(result.checks).toEqual([expect.objectContaining({capability:'integration',state:'failed'})]);expect(diagnose).not.toHaveBeenCalled();
});
it('retains existing remote diagnosis and cancels before native discovery',async()=>{
 const diagnose=vi.fn(async()=>({checks:[{capability:'catalog',state:'empty'}]}));
 const runtime={registry:{list:()=>[{key:'installed'}]},diagnose};
 expect((await diagnoseManagedAddon({key:'installed'},{runtime})).checks[0].state).toBe('empty');
 const c=new AbortController();c.abort();
 await expect(diagnoseManagedAddon(mangaRecord,{runtime,signal:c.signal})).rejects.toMatchObject({name:'AbortError'});
});
const mangaRecord={pkg:'org.native.reader',name:'Installed Reader',_store:{kind:'manga'}};
const mangaPlugin=(extra={})=>({
  sources:async()=>({sources:[{id:'org.native.reader#123',pkg:'org.native.reader',label:'Actual Source'}]}),
  prepare:async()=>({}),catalogue:async()=>({mangas:[{url:'/work/1',title:'Native Manga',memo:{token:'preserved'}}],hasNextPage:true}),
  latest:async()=>({mangas:[],hasNextPage:false}),search:async()=>({mangas:[],hasNextPage:false}),
  series:async({manga})=>({manga,chapters:[{url:'/chapter/1',name:'One'}]}),chapters:async()=>({chapters:[]}),pages:async()=>({pages:[]}),...extra,
});
const animeRecord={pkg:'org.native.video',name:'Installed Video',_store:{kind:'anime'}};
it('does not relabel the full catalogue as latest when an older native bridge has no latest method',async()=>{
 const out=await createNativeCatalog(mangaRecord,{plugins:{ExtensionEngine:mangaPlugin({latest:undefined})}});
 expect(out.adapter.home).toBeUndefined();
 expect(out.adapter.latest).toBeUndefined();
 expect(out.addon.capabilities).not.toContain('home');
 expect((await out.adapter.catalogue(1)).items[0].title).toBe('Native Manga');
});
it('opens the Team X full catalogue and paginates while leaving latest as a separate empty listing',async()=>{
 const {document,window}=parseHTML('<html><body></body></html>');vi.stubGlobal('document',document);vi.stubGlobal('window',window);
 const engine=mangaPlugin({catalogue:vi.fn(async({page})=>({mangas:[{url:'/series/work-'+page,title:'Catalogue '+page,memo:'preserved'}],hasNextPage:page===1})),latest:vi.fn(async()=>({mangas:[],hasNextPage:false}))});
 const out=await createNativeCatalog(mangaRecord,{plugins:{ExtensionEngine:engine}});
 const view=renderSourceMode(out);document.body.append(view);await new Promise(r=>setTimeout(r,0));
 expect(view.querySelector('.up-title')?.textContent).toBe('Catalogue 1');
 expect(engine.latest).not.toHaveBeenCalled();
 view.querySelector('.addon-source-more').click();await new Promise(r=>setTimeout(r,0));
 expect([...view.querySelectorAll('.up-title')].map(x=>x.textContent)).toEqual(['Catalogue 1','Catalogue 2']);
 expect(engine.catalogue).toHaveBeenLastCalledWith({sourceId:'org.native.reader#123',page:2});
 expect(view.querySelector('.addon-source-more').hidden).toBe(true);
 view.querySelector('[data-tab="home"]').click();await new Promise(r=>setTimeout(r,0));
 expect(engine.latest).toHaveBeenCalledTimes(1);
 expect(view.querySelectorAll('.up-card')).toHaveLength(0);
 expect(view.querySelector('.addon-source-note').textContent).toContain('بلا أعمال');
 view.close();
});
const animePlugin=(extra={})=>({sources:async()=>({sources:[{id:'real-video-id',pkg:'org.native.video',name:'Actual Video',content:'anime',enabled:true}]}),page:async()=>({page:{items:[{sourceId:'real-video-id',url:'/video/1',title:'Native Anime'}],hasNext:true}}),details:async({anime})=>({anime}),episodes:async()=>({episodes:[{url:'/episode/1',name:'One',number:1}]}),...extra});

it('resolves the real manga package source and preserves memo through catalogue, details and work model',async()=>{
 const engine=mangaPlugin();engine.catalogue=vi.fn(engine.catalogue);engine.series=vi.fn(engine.series);
 const out=await createNativeCatalog(mangaRecord,{plugins:{ExtensionEngine:engine}});
 expect(out.status).toBe('ready');expect(out.addon.sourceId).toBe('org.native.reader#123');expect(out.addon.key).toBe('core|org.native.reader#123');
 const page=await out.adapter.catalogue(2);expect(page.hasNextPage).toBe(true);expect(engine.catalogue).toHaveBeenCalledWith({sourceId:'org.native.reader#123',page:2});
 const item=page.items[0];await out.adapter.series(item);expect(engine.series).toHaveBeenCalledWith({sourceId:'org.native.reader#123',manga:item});
 const work=sourceWorkModel(item,{addon:out.addon});expect(work._work.editions[0]).toMatchObject({sourceId:'org.native.reader#123',manga:{memo:{token:'preserved'}}});
});

it('requires explicit selection when a package exposes multiple native source IDs',async()=>{
 const plugin=mangaPlugin({sources:async()=>({sources:[{id:'one',pkg:mangaRecord.pkg,label:'First'},{id:'two',pkg:mangaRecord.pkg,label:'Second'}]})});
 const result=await createNativeCatalog(mangaRecord,{plugins:{ExtensionEngine:plugin}});expect(result.status).toBe('select-source');expect(result.sources.map(x=>x.sourceId)).toEqual(['one','two']);
 expect((await createNativeCatalog(mangaRecord,{plugins:{ExtensionEngine:plugin},sourceId:'two'})).addon.sourceId).toBe('two');
 expect((await createNativeCatalog(mangaRecord,{plugins:{ExtensionEngine:plugin},sourceId:'unrelated'})).status).toBe('incompatible');
});

it('never resolves a source from a matching display name or a guessed anime user ID',async()=>{
 const out=await createNativeCatalog(animeRecord,{plugins:{AnimeEngine:animePlugin({sources:async()=>({sources:[{id:'user-video',name:animeRecord.name,content:'anime',enabled:true}]})})}});
 expect(out).toMatchObject({status:'incompatible',code:'SOURCE_NOT_DECLARED'});
});

it('accepts declared legacy manga IDs with exact package boundaries only',async()=>{
 const plugin=mangaPlugin({sources:async()=>({sources:[{id:mangaRecord.pkg+'Extra#123',label:'Wrong'},{id:mangaRecord.pkg+'#9',label:'Actual'}]})});
 expect((await createNativeCatalog(mangaRecord,{plugins:{ExtensionEngine:plugin}})).addon.sourceId).toBe(mangaRecord.pkg+'#9');
});

it('uses the anime page bridge for source-scoped search and episodes',async()=>{
 const engine=animePlugin();engine.page=vi.fn(engine.page);engine.episodes=vi.fn(engine.episodes);
 const out=await createNativeCatalog(animeRecord,{plugins:{AnimeEngine:engine}});expect(out.status).toBe('ready');
 const page=await out.adapter.search('query',3);expect(engine.page).toHaveBeenCalledWith({sourceId:'real-video-id',listing:'search',page:3,query:'query'});expect(page.hasNextPage).toBe(true);
 const item=page.items[0];expect(item.type).toBe('anime');const episodes=await out.source.episodes(item);
 expect(engine.episodes).toHaveBeenCalledWith({anime:expect.objectContaining({sourceId:'real-video-id',url:'/video/1'})});expect(sourceWorkModel(item,{addon:out.addon,episodes})._sourceCopy.sourceId).toBe('real-video-id');
});

it('does not guess movie versus series for native cinema items',async()=>{
 const engine=animePlugin({sources:async()=>({sources:[{id:'real-video-id',pkg:animeRecord.pkg,content:'cinema',enabled:true}]})});
 const out=await createNativeCatalog({...animeRecord,content:'cinema'},{plugins:{AnimeEngine:engine}});const page=await out.adapter.home();
 expect(out.addon.contentTypes).toEqual(['movie','series']);expect(page.items[0].type).toBeUndefined();expect(()=>sourceWorkModel(page.items[0],{addon:out.addon})).toThrow('نوع العمل غير مؤكد');
});

it('returns explicit incompatibility for Cloudstream, absent runtime and wrong-engine records',async()=>{
 expect(await createNativeCatalog({pkg:'org.cloud',kind:'cloudstream'},{plugins:{}})).toMatchObject({status:'incompatible',code:'UNSUPPORTED_NATIVE_ENGINE'});
 expect(await createNativeCatalog(mangaRecord,{plugins:{}})).toMatchObject({status:'incompatible',code:'NATIVE_RUNTIME_UNAVAILABLE'});
 expect(await createNativeCatalog({...mangaRecord,anime:true},{plugins:{ExtensionEngine:mangaPlugin()}})).toMatchObject({status:'incompatible',code:'WRONG_NATIVE_ENGINE'});
});

it('does not infer working content from a HTTP-200-shaped or malformed native response',async()=>{
 const out=await createNativeCatalog(mangaRecord,{plugins:{ExtensionEngine:mangaPlugin({catalogue:async()=>({status:200,text:'<html>Challenge</html>'})})}});
 await expect(out.adapter.catalogue()).rejects.toMatchObject({code:'INVALID_NATIVE_RESPONSE'});
});

it('rejects results belonging to a different native source',async()=>{
 const out=await createNativeCatalog(animeRecord,{plugins:{AnimeEngine:animePlugin({page:async()=>({page:{items:[{sourceId:'another-source',url:'/x',title:'Wrong'}],hasNext:false}})})}});
 await expect(out.adapter.home()).rejects.toMatchObject({code:'INVALID_NATIVE_RESPONSE'});
});

it('ignores late native discovery and catalogue completion after cancellation',async()=>{
 const controller=new AbortController();let finish;
 const discovery=createNativeCatalog(mangaRecord,{plugins:{ExtensionEngine:mangaPlugin({sources:()=>new Promise(r=>{finish=r;})})},signal:controller.signal});await Promise.resolve();controller.abort();
 await expect(discovery).rejects.toMatchObject({name:'AbortError'});finish({sources:[]});
 const out=await createNativeCatalog(mangaRecord,{plugins:{ExtensionEngine:mangaPlugin({catalogue:()=>new Promise(r=>{finish=r;})})}});
 const cancel=new AbortController(),request=out.adapter.catalogue(1,{signal:cancel.signal});await Promise.resolve();await Promise.resolve();cancel.abort();await expect(request).rejects.toMatchObject({name:'AbortError'});finish({mangas:[],hasNextPage:false});
});

it('renders the explicitly selected latest screen using real native page results and pagination',async()=>{
 const {document,window}=parseHTML('<html><body></body></html>');vi.stubGlobal('document',document);vi.stubGlobal('window',window);
 const engine=mangaPlugin({latest:async({page})=>({mangas:[{url:'/work/'+page,title:'Real Native '+page}],hasNextPage:page===1})});
 const out=await createNativeCatalog(mangaRecord,{plugins:{ExtensionEngine:engine}});
 const view=renderSourceMode({...out,state:{tab:'home',page:1,query:''}});document.body.append(view);await new Promise(r=>setTimeout(r,0));
 expect(view.querySelector('.up-title').textContent).toBe('Real Native 1');view.querySelector('.addon-source-more').click();await new Promise(r=>setTimeout(r,0));
 expect([...view.querySelectorAll('.up-title')].map(x=>x.textContent)).toEqual(['Real Native 1','Real Native 2']);expect(view.querySelector('.addon-source-more').hidden).toBe(true);view.close();
});
