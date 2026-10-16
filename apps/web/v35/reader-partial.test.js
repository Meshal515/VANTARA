import { afterEach, expect, it, vi } from 'vitest';
const state=vi.hoisted(()=>({records:[],repair:null,calls:0}));
vi.mock('../lib/translate.js',async original=>({...await original(),
  prepareTranslation:async()=>({src:'page.jpg'}),
  translatePage:async deps=>{state.calls++;state.repair=deps.onRepaired;return {incomplete:true,image:null,translated:0};},
}));
vi.mock('../lib/translate-settings.js',()=>({readTranslateSettings:()=>({enabled:true,mode:'auto',speed:'smart'}),onTranslateSettings:()=>()=>{},setTranslationLocked:()=>{}}));
vi.mock('../lib/capabilities.js',()=>({supports:()=>true}));
vi.mock('../lib/translation-native.js',()=>({nativeTranslationAvailable:()=>false,focusPage:()=>{},formatBytes:()=>'',modelsStatus:async()=>({installed:true}),downloadModels:async()=>{}}));
vi.mock('../lib/translate-perf.js',async original=>({...await original(),recordPerf:entry=>state.records.push(entry)}));
import {createReaderTranslation} from './reader-translate.js';
afterEach(()=>{vi.clearAllTimers();vi.useRealTimers();state.records=[];state.calls=0;state.repair=null;});

it('a partial page stays waiting, retries, then ends the stall only when a complete repair arrives',async()=>{
  vi.useFakeTimers();
  const reader=createReaderTranslation({ref:'partial-reader',title:'test',root:{classList:{toggle(){}}},toast(){},getImage:async()=> 'page.jpg',keyOf:()=> 'partial-chapter'});
  const seg={row:{sourceId:'s',lang:'en'},slots:[{frame:{querySelector:()=>null}}]};
  reader.attach(seg);reader.focus(seg,0,[seg]);
  await vi.advanceTimersByTimeAsync(0);
  expect(state.calls).toBe(1);
  expect(seg.tl.results.get(0)?.incomplete).toBe(true);
  expect(state.records.filter(e=>e.from==='stall')).toHaveLength(0);
  await vi.advanceTimersByTimeAsync(3000);
  expect(state.calls).toBe(2);
  state.repair({incomplete:false,image:'arabic.webp',translated:1});
  expect(state.records.filter(e=>e.from==='stall')).toEqual([expect.objectContaining({outcome:'ready',stallMs:3000})]);
  await vi.advanceTimersByTimeAsync(10000);
  expect(state.calls).toBe(2);
  reader.destroy();
});
