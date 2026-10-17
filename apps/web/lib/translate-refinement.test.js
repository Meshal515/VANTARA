import { afterEach, describe, expect, it, vi } from 'vitest';
const { kv }=vi.hoisted(()=>({kv:new Map()}));
vi.mock('./chapter-store.js',()=>({readKv:async key=>kv.get(key)??null,writeKv:async(key,value)=>{kv.set(key,{value});return key;}}));
import { createQueue, translatePage } from './translate.js';
const realFetch=globalThis.fetch;
afterEach(()=>{kv.clear();globalThis.fetch=realFetch;delete globalThis.Capacitor;});
function setup(early=false) {
  let callback;const repaired=[];
  globalThis.fetch=async()=>new Response(new Uint8Array([11,12,13]));
  globalThis.Capacitor={convertFileSrc:path=>`file:${path}`,Plugins:{Translation:{
    addListener:async(_name,cb)=>{callback=cb;return{remove(){}};},
    analyzePage:async()=>({width:800,height:1200,thumbnail:'AAAA',regions:[{id:'r1',source:'HELLO',kind:'speech',status:'pending',box:[1,2,3,4]}]}),
    renderPage:async()=>{if(early) callback({previewPath:'/preview.webp',path:'/refined.webp'});return{path:'/preview.webp',translated:1,perf:{counts:{refinementPending:1}}};},
  }}};
  return {callback:()=>callback,repaired,deps:{imagePath:'/source.jpg',onRepaired:result=>repaired.push(result),sync:{translation:async()=>({status:200,body:{engine:'luna:t3',regions:[{id:'r1',source:'HELLO',kind:'speech',arabic:'مرحبًا'}]}})}}};
}
const settle=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
describe('background refinement keeps content-addressed preview until accepted',()=> {
  it('persists a new URL and notifies the reader, including an event arriving before initial cache save',async()=> {
    const test=setup(true);
    const initial=await translatePage(test.deps,'file:/source.jpg',{seriesRef:'work',sourceId:'s',chapterKey:'work#1',pageIndex:0});
    expect(initial.image).toBe('file:/preview.webp');await settle();
    expect(test.repaired).toHaveLength(1);expect(test.repaired[0].image).toBe('file:/refined.webp');
    expect([...kv.values()].every(row=>row.value.image==='file:/refined.webp')).toBe(true);
  });
  it('a stale refinement cannot replace a newer accepted translation',async()=> {
    const test=setup();
    await translatePage(test.deps,'file:/source.jpg',{seriesRef:'work',sourceId:'s',chapterKey:'work#1',pageIndex:0});
    for(const row of kv.values())row.value={...row.value,image:'file:/newer.webp',at:row.value.at+1};
    test.callback()({previewPath:'/preview.webp',path:'/refined.webp'});await settle();
    expect(test.repaired).toHaveLength(0);expect([...kv.values()].every(row=>row.value.image==='file:/newer.webp')).toBe(true);
  });
});

it('background repair registers its refinement and preserves the repaired URL',async()=> {
  const test=setup();
  const meta={seriesRef:'work',sourceId:'s',chapterKey:'work#1',pageIndex:0};
  await translatePage(test.deps,'file:/source.jpg',meta);
  for(const row of kv.values())row.value={...row.value,at:0,incomplete:true};
  await translatePage(test.deps,'file:/source.jpg',meta);
  for(let i=0;i<80;i++)await Promise.resolve();
  expect(test.repaired).toHaveLength(1);
  test.callback()({previewPath:'/preview.webp',path:'/refined.webp'});await settle();
  expect(test.repaired).toHaveLength(2);
  expect(test.repaired.at(-1).image).toBe('file:/refined.webp');
});

it('accepts a complete merged repair without losing either previous source phrase',async()=> {
  const test=setup();
  const meta={seriesRef:'work',sourceId:'s',chapterKey:'work#1',pageIndex:0};
  await translatePage(test.deps,'file:/source.jpg',meta);
  for(const row of kv.values())row.value={...row.value,at:0,incomplete:true,translated:2,regions:[
    {id:'old1',source:'HELLO',arabic:'مرحبًا',status:'pending',kind:'speech',box:[1,2,2,4]},
    {id:'old2',source:'WORLD',arabic:'يا عالم',status:'pending',kind:'speech',box:[2,2,3,4]},
  ]};
  globalThis.Capacitor.Plugins.Translation.analyzePage=async()=>({width:800,height:1200,thumbnail:'AAAA',regions:[{id:'r1',source:'HELLO WORLD',kind:'speech',status:'pending',box:[1,2,3,4]}]});
  test.deps.sync.translation=async()=>({status:200,body:{engine:'luna:t4',regions:[{id:'r1',source:'HELLO WORLD',kind:'speech',arabic:'مرحبًا يا عالم'}]}});
  await translatePage(test.deps,'file:/source.jpg',meta);
  for(let i=0;i<80;i++)await Promise.resolve();
  expect(test.repaired).toHaveLength(1);
  expect(test.repaired[0]).toMatchObject({translated:1,incomplete:false});
});

it('deduplicates the immediate partial repair with a simultaneous cache revisit',async()=>{
 const test=setup(); const meta={seriesRef:'repair-race',sourceId:'s',chapterKey:'repair-race#1',pageIndex:0};
 let analyses=0;let releaseRepair;const held=new Promise(resolve=>{releaseRepair=resolve;});
 globalThis.Capacitor.Plugins.Translation.analyzePage=async()=>{
  analyses++;
  if(analyses>1) await held;
  return {width:800,height:1200,thumbnail:'AAAA',regions:[{id:'r1',source:'HELLO',kind:'speech',status:'pending',box:[1,2,3,4]}]};
 };
 globalThis.Capacitor.Plugins.Translation.renderPage=async()=>({path:'/partial.webp',translated:0,perf:{counts:{noFit:1}}});
 await translatePage(test.deps,'file:/repair-race.jpg',meta);
 await settle();
 await translatePage(test.deps,'file:/repair-race.jpg',meta);
 await settle();releaseRepair();
 for(let i=0;i<100;i++) await Promise.resolve();
 expect(analyses).toBe(2);
});

it('a reader revisiting the last allowed repair still receives its result',async()=>{
 const test=setup();const meta={seriesRef:'last-repair',sourceId:'s',chapterKey:'last-repair#1',pageIndex:0};
 await translatePage(test.deps,'file:/last-repair.jpg',meta);
 for(const row of kv.values()) row.value={...row.value,incomplete:true,tries:2};
 let release;const held=new Promise(resolve=>{release=resolve;});
 const analyze=globalThis.Capacitor.Plugins.Translation.analyzePage;
 globalThis.Capacitor.Plugins.Translation.analyzePage=async()=>{await held;return analyze();};
 await translatePage(test.deps,'file:/last-repair.jpg',meta);await settle();
 const newcomer=[];
 await translatePage({...test.deps,onRepaired:r=>newcomer.push(r)},'file:/last-repair.jpg',meta);
 release();for(let i=0;i<150;i++)await Promise.resolve();
 expect(newcomer).toHaveLength(1);expect(newcomer[0].incomplete).toBe(false);
});

it('partial repair re-enters native analysis rather than inheriting stale prepared analysis',async()=>{
 const test=setup();let analyses=0;const analyze=globalThis.Capacitor.Plugins.Translation.analyzePage;
 globalThis.Capacitor.Plugins.Translation.analyzePage=async()=>{analyses++;return analyze();};
 globalThis.Capacitor.Plugins.Translation.renderPage=async()=>({path:'/partial.webp',translated:0,perf:{counts:{noFit:1}}});
 const old=await analyze();
 await translatePage({...test.deps,analysis:old},'file:/stale-analysis.jpg',{chapterKey:'stale-analysis'});
 for(let i=0;i<150;i++)await Promise.resolve();
 expect(analyses).toBe(1);
});

it('bounds cached repairs and counts them inside a one-page resident window',async()=>{
 const test=setup();
 const analyze=globalThis.Capacitor.Plugins.Translation.analyzePage;let analyses=0;
 const metas=Array.from({length:4},(_,i)=>({seriesRef:'repair-bound',sourceId:'s',chapterKey:'repair-bound',pageIndex:i}));
 // Distinct bytes make distinct repair identities.
 let byte=0;globalThis.fetch=async()=>new Response(new Uint8Array([201,byte++,77]));
 for(let i=0;i<4;i++) await translatePage(test.deps,`file:/repair-bound-${i}.jpg`,metas[i]);
 for(const row of kv.values()) row.value={...row.value,incomplete:true,tries:0};
 let release;const held=new Promise(resolve=>{release=resolve;});
 globalThis.Capacitor.Plugins.Translation.analyzePage=async()=>{analyses++;return analyze();};
 test.deps.sync.translation=async()=>{await held;return {status:200,body:{regions:[{id:'r1',kind:'speech',arabic:'مرحبًا'}]}};};
 const q=createQueue({maxInFlight:1,concurrency:1,prepareConcurrency:1,maxPrepared:2});
 const work=metas.map((meta,i)=>q.add({key:`repair-bound#${i}`,chapterKey:'repair-bound',index:i,run:()=>translatePage(test.deps,`file:/repair-bound-${i}.jpg`,meta)}));
 await Promise.all(work);for(let i=0;i<80;i++)await Promise.resolve();
 const waiting=analyses;release();for(let i=0;i<300;i++)await Promise.resolve();
 expect(waiting).toBe(1);
});

it('queued repairs use live reader distance after completing the current repair',async()=>{
 const test=setup();let byte=0;globalThis.fetch=async()=>new Response(new Uint8Array([91,byte++,82]));
 const indices=[1,8,9,10];const meta=i=>({seriesRef:'repair-order',sourceId:'s',chapterKey:'repair-order',pageIndex:i});
 for(const i of indices) await translatePage(test.deps,`file:/repair-order-${i}.jpg`,meta(i));
 for(const row of kv.values()) row.value={...row.value,incomplete:true,tries:0};
 let release;const held=new Promise(resolve=>{release=resolve;});const order=[];
 const analyze=globalThis.Capacitor.Plugins.Translation.analyzePage;
 globalThis.Capacitor.Plugins.Translation.analyzePage=async args=>{order.push(args.pageIndex);if(order.length===1)await held;return analyze();};
 for(const i of indices) await translatePage({...test.deps,isInteractive:()=>i===9,schedulingPriority:()=>i===9?0:i>9?i-9:1000+9-i},`file:/repair-order-${i}.jpg`,meta(i));
 release();for(let i=0;i<400;i++)await Promise.resolve();
 expect(order).toEqual([1,9,10,8]);
});
