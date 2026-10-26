import { afterEach, expect, it, vi } from 'vitest';
import { createDesktopRuntime, getRuntime } from './runtime.js';
import { loadDesktopSources } from '../pwa/platform.js';
import { createRegistry } from '../pwa/sources/registry.js';
import { createStore } from '../lib/idb-store.js';

vi.mock('../pwa/platform.js', async original => ({
  ...await original(), loadDesktopSources: vi.fn(),
}));
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const definition = (version, works = true) => ({id:'demo',label:'Demo',content:'manga',engine:'demo',version,domain:'source.test',config:{works}});
const engines = {demo:{content:'manga',create(def){
  const check = () => { if (!def.config.works) throw new Error('broken selectors'); };
  return {
    search:async()=>{check();return {mangas:[{url:'1',title:'One'}],hasNextPage:false};},
    popular:async()=>({mangas:[{url:'1',title:'One'}],hasNextPage:false}),
    series:async()=>({manga:{url:'1',title:'One'},chapters:[{url:'c1',name:'1'}]}),
    pages:async()=>[{index:0,url:'x',imageUrl:'https://images.test/1.jpg'}],
  };
}}};

async function dependencies(works = true) {
  const store = createStore({indexedDB:null});
  const previous = createRegistry({engines,store,ctx:{}});
  await previous.init([definition(1)]);
  vi.mocked(loadDesktopSources).mockResolvedValue({
    createRegistry,engines,createStore:()=>store,createHostResolver:()=>({}),
  });
  const bridge = {platform:'windows',startPlayback:async()=>({started:true}),onEvent:()=>()=>{},requestResource:async()=>({status:200,text:'{}'})};
  return {bridge,storage:null,definitions:[definition(2,works)]};
}
async function fixture(works = true, options = {}) {
  const runtime = createDesktopRuntime({...await dependencies(works),...options});
  await runtime.ready; await runtime.addons.ready;
  return runtime;
}

it('يفحص تعريف المصدر المحدّث في الخلفية ثم يعتمد نسخته ويجدد بطاقة الإضافة', async () => {
  vi.useFakeTimers();
  const visibleAtChange = [];
  const onSourcesChanged = vi.fn(() => { visibleAtChange.push(runtime.addons.registry.list().find(addon=>addon.key==='core|demo')?.version); });
  const runtime = await fixture(true,{onSourcesChanged});
  expect(onSourcesChanged).not.toHaveBeenCalled();
  expect(runtime.registry.def('demo').version).toBe(1);
  expect(runtime.registry.status().demo.candidate).toMatchObject({version:2,status:'pending'});
  await vi.advanceTimersByTimeAsync(15000);
  expect(runtime.registry.def('demo').version).toBe(2);
  expect(runtime.registry.status().demo).toMatchObject({stable:{version:2,verified:true},lkg:{version:1},candidate:null});
  expect(runtime.addons.registry.list()).toMatchObject([{key:'core|demo',version:'2'}]);
  expect(onSourcesChanged).toHaveBeenCalledTimes(1);
  expect(visibleAtChange).toEqual(['2']);
});

it('يبقي نسخة المصدر السابقة وبياناته عند فشل فحص التعريف الأحدث', async () => {
  vi.useFakeTimers();
  const onSourcesChanged = vi.fn();
  const runtime = await fixture(false,{onSourcesChanged});
  await vi.advanceTimersByTimeAsync(15000);
  expect(runtime.registry.def('demo').version).toBe(1);
  expect(runtime.registry.status().demo.candidate).toMatchObject({version:2,status:'failed'});
  expect(runtime.addons.registry.list()).toMatchObject([{key:'core|demo',version:'1'}]);
  const result = await runtime.registry.call('demo',source=>source.search('one'));
  expect(result.mangas[0].title).toBe('One');
  expect(onSourcesChanged).not.toHaveBeenCalled();
});

it('يعزل فشل مستمع الواجهة بعد اعتماد المصدر ولا يعيد النسخة القديمة', async () => {
  vi.useFakeTimers();
  const onSourcesChanged = vi.fn(async()=>{throw new Error('view closed');});
  const runtime = await fixture(true,{onSourcesChanged});
  await vi.advanceTimersByTimeAsync(15000);
  expect(onSourcesChanged).toHaveBeenCalledTimes(1);
  expect(runtime.registry.def('demo').version).toBe(2);
  expect(runtime.addons.registry.list()).toMatchObject([{key:'core|demo',version:'2'}]);
});

it('يربط مستمع boot حتى إذا أنشأت واجهة الإضافات runtime قبله', async () => {
  vi.useFakeTimers();
  const {bridge,definitions} = await dependencies();
  vi.stubGlobal('fetch',async()=>({ok:true,json:async()=>({sources:definitions})}));
  const g = {VantaraDesktop:bridge};
  const runtime = getRuntime(g);
  await runtime.ready; await runtime.addons.ready;
  const onSourcesChanged = vi.fn();
  expect(getRuntime(g,{onSourcesChanged})).toBe(runtime);
  await vi.advanceTimersByTimeAsync(15000);
  expect(runtime.registry.def('demo').version).toBe(2);
  expect(onSourcesChanged).toHaveBeenCalledTimes(1);
});
