import { afterEach, describe, expect, it, vi } from 'vitest';
const { kv }=vi.hoisted(()=>({kv:new Map()}));
vi.mock('./chapter-store.js',()=>({readKv:async key=>kv.get(key)??null,writeKv:async(key,value)=>{kv.set(key,{value});return key;}}));
import { translatePage } from './translate.js';
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
