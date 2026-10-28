import { afterEach, expect, it, vi } from 'vitest';
import { parseHTML } from 'linkedom';
import { renderV7Addons } from './addons-v7.js';
import { createSourcePulse } from '../addons/source-pulse.js';
import { SHELL_HTML } from './markup.js';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
const tick = async () => { for(let i=0;i<8;i++) await new Promise(resolve=>setTimeout(resolve,0)); };
const setup = () => {
  const {document,window}=parseHTML('<html><body></body></html>');
  vi.stubGlobal('document',document);
  vi.stubGlobal('window',window);
  return document;
};
const registry = (items=[]) => ({runtimeName:'apk', list:()=>items});
const installedTab = view => [...view.querySelectorAll('.v7-tab')].find(x=>x.textContent.includes('المثبتة'));
const repositoryTab = view => [...view.querySelectorAll('.v7-tab')].find(x=>x.textContent.includes('المستودعات'));

it('shows real existing direct addons and saved manga sites; starts with the saved additions without presets', async () => {
  const d=setup();
  const sites={list:vi.fn(async()=>[{id:'site-9',label:'My Manga',domain:'reader.example',engine:'madara'}]),remove:vi.fn(async()=>{})};
  const existing={key:'addon-k',name:'My Cinemeta',enabled:true,capabilities:['catalog'],contentTypes:['movie']};
  const view=renderV7Addons({registry:registry([existing]),sites});
  d.body.append(view);await tick();
  expect(view.querySelector('.v7-body').textContent).toContain('My Cinemeta');
  expect(view.querySelector('.v7-body').textContent).toContain('My Manga');
  installedTab(view).click();
  expect(view.querySelector('.v7-body').textContent).toContain('My Manga');
  expect(view.querySelector('.v7-body').textContent).toContain('My Cinemeta');
  expect(sites.list).toHaveBeenCalledOnce();
  view.close();
});

it('does not lose a known manga repository if its API fails on the next refresh',async()=>{
  const d=setup();let fail=false;
  const repositories={list:vi.fn(async()=>{if(fail)throw Error('offline');return {repos:[{url:'https://repo.example/repo.json',name:'Stored Repo'}]};}),extensions:vi.fn(async()=>[])};
  const view=renderV7Addons({registry:registry(),repositories});
  d.body.append(view);await tick();
  expect(view.querySelector('.v7-body').textContent).toContain('Stored Repo');
  fail=true;view.reload();await tick();
  expect(view.querySelector('.v7-body').textContent).toContain('Stored Repo');
  view.close();
});

it('native source shows an installed state for an update and does not reinstall it when opened',async()=>{
  const d=setup();const install=vi.fn(async()=>{});
  const api={list:vi.fn(async()=>({repos:[{url:'https://repo.example/index.min.json',name:'Mihon Repo'}]})),
    extensions:vi.fn(async()=>[{name:'MangaUpdate',pkg:'pkg.test',lang:'en',version:'1.6',update:true,installed:'1.5',nsfw:false}]),install};
  const view=renderV7Addons({registry:registry(),repositories:api});
  d.body.append(view);await tick();
  [...view.querySelectorAll('.v7-simple-btn')].find(x=>x.textContent.includes('استعراض')).click();await tick();
  expect(view.querySelector('.v7-row .v7-flip.installed')).toBeTruthy();
  expect(view.querySelector('.v7-status.visible')).toBeTruthy();
  view.querySelector('.v7-row .v7-flip').click();
  expect(install).not.toHaveBeenCalled();
  expect(view.querySelector('.v7-dialog').textContent).toContain('MangaUpdate');
  view.close();
});

it('preserves safe catalog routing and never advertises direct browsing for a stream-only addon',async()=>{
  const d=setup();const open=vi.fn();
  const items=[
    {key:'first',name:'Catalog',enabled:true,protocol:'stremio',capabilities:['catalog'],contentTypes:['anime']},
    {key:'second',name:'Torrent only',enabled:true,protocol:'stremio',capabilities:['streams'],contentTypes:['movie']}
  ];
  const view=renderV7Addons({registry:registry(items),onOpenSource:open});
  d.body.append(view);await tick();installedTab(view).click();
  const rows=[...view.querySelectorAll('.v7-row')];
  rows.find(x=>x.textContent.includes('Torrent only')).click();
  expect(view.querySelector('.v7-dialog').textContent).toContain('لا تعرض كتالوجًا');
  expect(open).not.toHaveBeenCalled();
  view.querySelector('.v7-dialog .v7-btn').click();
  const catalog=rows.find(x=>x.textContent.includes('Catalog'));
  catalog.querySelector('.v7-simple-btn').click();
  expect(open).toHaveBeenCalledWith(items[0]);
  view.close();
});

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((ok, fail) => { resolve=ok; reject=fail; });
  return {promise,resolve,reject};
};
const browse = view => [...view.querySelectorAll('.v7-simple-btn')].find(x=>x.textContent.includes('استعراض'))?.click();

it('shows saved repositories before a slow extension index finishes and shares its in-flight request', async()=>{
  const d=setup(), index=deferred();
  const api={list:async()=>({repos:[{url:'https://repo.example/index.json',name:'Slow Repo'}]}),extensions:vi.fn(()=>index.promise)};
  const view=renderV7Addons({registry:registry(),repositories:api});d.body.append(view);await tick();
  expect(view.querySelector('.v7-body').textContent).toContain('Slow Repo');
  browse(view);view.back();browse(view);await tick();
  expect(api.extensions).toHaveBeenCalledOnce();
  index.resolve([{name:'Loaded Source',pkg:'pkg.loaded'}]);await tick();
  expect(view.querySelector('.v7-body').textContent).toContain('Loaded Source');view.close();
});

it('keeps index failure visible with retry instead of a permanent loading message', async()=>{
  const d=setup();let fail=true;
  const api={list:async()=>({repos:[{url:'https://repo.example/index.json',name:'Saved Repo'}]}),extensions:async()=>{if(fail)throw Error('index offline');return [{name:'Recovered Source',pkg:'pkg.recovered'}];}};
  const view=renderV7Addons({registry:registry(),repositories:api});d.body.append(view);await tick();browse(view);await tick();
  expect(view.querySelector('.v7-body').textContent).toContain('index offline');
  expect(view.querySelector('.v7-body').textContent).not.toContain('جارٍ تحميل المصادر');
  fail=false;[...view.querySelectorAll('button')].find(x=>x.textContent==='إعادة المحاولة').click();await tick();
  expect(view.querySelector('.v7-body').textContent).toContain('Recovered Source');view.close();
});

it('preserves refresh errors after drawing and redacts source URLs', async()=>{
  setup();
  const api={list:async()=>{throw Error('offline https://repo.example/private?token=secret');},extensions:async()=>[]};
  const view=renderV7Addons({registry:registry(),repositories:api});await tick();
  expect(view.querySelector('.v7-diagnostic').textContent).toContain('offline');
  expect(view.textContent).not.toContain('token=secret');view.close();
});

it('removes cached installed sources only after their saved repository is actually removed', async()=>{
  setup();let saved=true;
  const api={list:async()=>({repos:saved?[{url:'https://repo.example/index.json',name:'Saved Repo'}]:[]}),extensions:async()=>[{name:'Old Source',pkg:'old',installed:true}]};
  const view=renderV7Addons({registry:registry(),repositories:api});await tick();installedTab(view).click();
  expect(view.textContent).toContain('Old Source');saved=false;view.reload();await tick();
  expect(view.querySelector('.v7-body').textContent).not.toContain('Old Source');view.close();
});

it('ignores stale discovery results after close and reload', async()=>{
  setup();const oldSites=deferred();let calls=0;
  const sites={list:()=>++calls===1?oldSites.promise:Promise.resolve([{id:'current',label:'Current Site'}])};
  const view=renderV7Addons({registry:registry(),sites});await tick();view.close();view.reload();await tick();
  oldSites.resolve([{id:'stale',label:'Stale Site'}]);await tick();installedTab(view).click();
  expect(view.querySelector('.v7-body').textContent).toContain('Current Site');
  expect(view.querySelector('.v7-body').textContent).not.toContain('Stale Site');view.close();
});

it('bounds native index discovery for many saved repositories and stops queued work on close', async()=>{
  setup();const pending=[];
  const api={list:async()=>({repos:Array.from({length:30},(_,i)=>({name:'Repo '+i,url:'https://repo.example/'+i+'.json'}))}),extensions:vi.fn(()=>{const job=deferred();pending.push(job);return job.promise;})};
  const view=renderV7Addons({registry:registry(),repositories:api});await tick();
  expect(api.extensions.mock.calls.length).toBeGreaterThan(0);
  expect(api.extensions.mock.calls.length).toBeLessThanOrEqual(4);
  view.close();const calls=api.extensions.mock.calls.length;pending.forEach(x=>x.resolve([]));await tick();
  expect(api.extensions).toHaveBeenCalledTimes(calls);
});

it('routes installed native open by its real package record and handles asynchronous routing failure', async()=>{
  const d=setup(),open=vi.fn(async()=>{throw Error('native unavailable');});
  const api={list:async()=>({repos:[{name:'Saved Repo',url:'https://repo.example/index.json'}]}),extensions:async()=>[{name:'Installed Native',pkg:'native.pkg',installed:true}]};
  const view=renderV7Addons({registry:registry(),repositories:api,onOpenNativeSource:open});d.body.append(view);await tick();browse(view);await tick();
  view.querySelector('.v7-flip').click();await tick();
  expect(open).toHaveBeenCalledWith(expect.objectContaining({pkg:'native.pkg',_url:'https://repo.example/index.json',_store:expect.objectContaining({kind:'manga'})}));
  expect(view.querySelector('.v7-diagnostic').textContent).toContain('native unavailable');view.close();
});

it('requires confirmation before deleting an installed source', async()=>{
  setup();const remove=vi.fn(async()=>{});
  const view=renderV7Addons({registry:{...registry([{key:'saved',name:'Saved Addon'}]),remove}});await tick();installedTab(view).click();
  view.querySelector('.v7-trash').click();expect(remove).not.toHaveBeenCalled();
  view.querySelector('.v7-confirm-actions .danger').click();await tick();expect(remove).toHaveBeenCalledWith('saved');view.close();
});

it('keeps installed state when switching tabs immediately after native installation', async()=>{
  setup();const changed=vi.fn(async()=>{});
  const api={list:async()=>({repos:[{name:'Saved Repo',url:'https://repo.example/index.json'}]}),extensions:async()=>[{name:'Fresh Native',pkg:'fresh.pkg'}],install:async()=>{}};
  const view=renderV7Addons({registry:registry(),repositories:api,onSourcesChanged:changed});await tick();browse(view);await tick();
  view.querySelector('.v7-flip').click();await tick();installedTab(view).click();
  expect(view.querySelector('.v7-body').textContent).toContain('Fresh Native');
  view.close();await new Promise(resolve=>setTimeout(resolve,420));expect(changed).not.toHaveBeenCalled();
});

it('does not revive a closed install result after reload', async()=>{
  setup();const job=deferred(),changed=vi.fn();
  const api={list:async()=>({repos:[{name:'Saved Repo',url:'https://repo.example/index.json'}]}),extensions:async()=>[{name:'Fresh Native',pkg:'fresh.pkg'}],install:()=>job.promise};
  const view=renderV7Addons({registry:registry(),repositories:api,onSourcesChanged:changed});await tick();browse(view);await tick();
  view.querySelector('.v7-flip').click();view.close();view.reload();await tick();job.resolve();await tick();
  installedTab(view).click();expect(view.querySelector('.v7-body').textContent).not.toContain('Fresh Native');
  view.close();expect(changed).not.toHaveBeenCalled();
});

it('closes the custom type filter before navigating back and clears repository search', async()=>{
  setup();const api={list:async()=>({repos:[{name:'Saved Repo',url:'https://repo.example/index.json'}]}),extensions:async()=>[{name:'Native Source',pkg:'native.pkg'}]};
  const view=renderV7Addons({registry:registry(),repositories:api});await tick();browse(view);await tick();
  view.querySelector('.v7-filter').click();expect(view.querySelector('.v7-menu').hidden).toBe(false);
  expect(view.back()).toBe(true);expect(view.querySelector('.v7-menu').hidden).toBe(true);
  const search=view.querySelector('[data-addon-search]');search.value='Native';search.oninput();
  expect(view.back()).toBe(true);expect(search.value).toBe('');expect(view.querySelector('.v7-body').textContent).toContain('Saved Repo');view.close();
});

it('shows saved installed native metadata even when the repository index is offline', async()=>{
  setup();const api={list:async()=>({repos:[{name:'Saved Repo',url:'https://repo.example/index.json'}],installed:[{name:'Offline Installed',pkg:'offline.pkg',repo:'https://repo.example/index.json',version:'1.0'}]}),extensions:async()=>{throw Error('offline');}};
  const view=renderV7Addons({registry:registry(),repositories:api});await tick();installedTab(view).click();
  expect(view.querySelector('.v7-body').textContent).toContain('Offline Installed');expect(view.querySelector('.v7-flip.installed')).toBeTruthy();view.close();
});

it('prefers bounded real installed APK PNG icons and rejects other data schemes', async()=>{
  setup();const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1QAAAAASUVORK5CYII=';
  const api={list:async()=>({repos:[{name:'Saved Repo',url:'https://repo.example/index.json',iconUrl:'https://repo.example/logo.png'}],installed:[{name:'Native Icon',pkg:'icon.pkg',repo:'https://repo.example/index.json',iconUrl:png}]}),extensions:async()=>[{name:'Native Icon',pkg:'icon.pkg',installed:true,iconUrl:'https://repo.example/old.png'}]};
  const view=renderV7Addons({registry:registry(),repositories:api});await tick();browse(view);await tick();
  expect(view.querySelector('.v7-row img').src).toBe(png);view.close();
  const unsafe=renderV7Addons({registry:registry([{key:'a',name:'Unsafe',iconUrl:'data:image/svg+xml;base64,PHN2Zz4=',logo:'data:image/png;base64,'+'A'.repeat(92161)}])});await tick();installedTab(unsafe).click();
  expect(unsafe.querySelector('.v7-row img')).toBeNull();unsafe.close();
});

it('filters native sources using their actual family and installed cinema target', async()=>{
  setup();const api={list:async()=>({repos:[{name:'Saved Repo',url:'https://repo.example/index.json'}],installed:[{name:'Cinema Source',pkg:'cinema.pkg',repo:'https://repo.example/index.json',content:'cinema',version:'1.0'}]}),extensions:async()=>[{name:'Cinema Source',pkg:'cinema.pkg',anime:true},{name:'Anime Source',pkg:'anime.pkg',anime:true}]};
  const view=renderV7Addons({registry:registry(),animeRepositories:api});await tick();browse(view);await tick();view.querySelector('.v7-filter').click();
  const option=[...view.querySelectorAll('.v7-menu button')].find(x=>x.textContent==='سينما');expect(option).toBeTruthy();option.click();
  expect(view.querySelector('.v7-body').textContent).toContain('Cinema Source');expect(view.querySelector('.v7-body').textContent).not.toContain('Anime Source');view.close();
});

it('does not offer removal of a bundled native manga extension', async()=>{
  setup();const api={list:async()=>({repos:[{name:'Saved Repo',url:'https://repo.example/index.json'}]}),extensions:async()=>[{name:'Bundled Manga',pkg:'builtin.pkg',builtin:true}],uninstall:vi.fn()};
  const view=renderV7Addons({registry:registry(),repositories:api});await tick();browse(view);await tick();
  expect(view.querySelector('.v7-trash')).toBeNull();view.close();expect(api.uninstall).not.toHaveBeenCalled();
});


it('reveals delete at 300ms and reports rejected source refresh at 400ms without an unhandled rejection', async()=>{
  const d=setup(),changed=vi.fn(async()=>{throw Error('source refresh failed');});
  const api={list:async()=>({repos:[{name:'Saved Repo',url:'https://repo.example/index.json'}]}),extensions:async()=>[{name:'Fresh Native',pkg:'fresh.pkg'}],install:async()=>{}};
  const view=renderV7Addons({registry:registry(),repositories:api,onSourcesChanged:changed});d.body.append(view);await tick();browse(view);await tick();
  vi.useFakeTimers();view.querySelector('.v7-flip').click();await vi.advanceTimersByTimeAsync(0);
  const slot=view.querySelector('.v7-trash-holder');expect(slot.classList.contains('visible')).toBe(false);
  await vi.advanceTimersByTimeAsync(299);expect(slot.classList.contains('visible')).toBe(false);
  await vi.advanceTimersByTimeAsync(1);expect(slot.classList.contains('visible')).toBe(true);expect(changed).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(100);expect(changed).toHaveBeenCalledOnce();
  expect(view.querySelector('.v7-diagnostic').textContent).toContain('source refresh failed');
  view.close();expect(vi.getTimerCount()).toBe(0);
});

it('keeps verification quiet outside Add-ons and exposes the explicit in-page button',async()=>{
  const d=setup(),begin=vi.fn(async({host})=>({host,state:'verified',ok:true}));
  const verification={
    subscribe:fn=>{fn([{host:'mesh.example',sourceName:'Mesh Manga'}]);return vi.fn();},
    begin:host=>begin({host}),
  };
  const view=renderV7Addons({registry:registry(),verification});d.body.append(view);await tick();
  expect(d.querySelector('[data-source-verification]')).toBeNull();
  const entry=view.querySelector('.v7-verify-entry');
  expect(entry.textContent).toContain('تحتاج تحقق');
  expect(begin).not.toHaveBeenCalled();
  entry.click();await tick();
  expect(begin).not.toHaveBeenCalled();
  const button=[...view.querySelectorAll('.v7-verification-item button')][0];
  button.click();await tick();
  expect(begin).toHaveBeenCalledOnce();
  expect(begin).toHaveBeenCalledWith({host:'mesh.example'});
  view.close();
});

it('offers verification on matching source details without confusing it with installed status',async()=>{
  const d=setup();
  const begin=vi.fn(async()=>({ok:true}));
  const verification={subscribe:fn=>{fn([{host:'mesh.example',sourceName:'Mesh Manga'}]);return()=>{};},begin};
  const api={list:async()=>({repos:[{url:'https://repo.example/index.json',name:'Mihon'}]}),
    extensions:async()=>[{name:'Mesh Manga',pkg:'test.pkg',domain:'mesh.example',installed:true}]};
  const view=renderV7Addons({registry:registry(),repositories:api,verification});d.body.append(view);await tick();
  browse(view);await tick();
  view.querySelector('.v7-row').click();await tick();
  expect(view.querySelector('.v7-dialog').textContent).toContain('لم تُفحص');
  const verify=[...view.querySelectorAll('.v7-dialog button')].find(x=>x.textContent.includes('تحقق من المصدر'));
  expect(verify).toBeTruthy();
  expect(begin).not.toHaveBeenCalled();
  verify.click();await tick();
  expect(begin).toHaveBeenCalledWith('mesh.example');
  view.close();
});

it('uses a neutral SVG fallback when no authentic icon is available',async()=>{
  const d=setup(),api={list:async()=>({repos:[{url:'https://repo.example/index.json',name:'Repo'}]}),
    extensions:async()=>[{name:'Missing Icon',pkg:'pkg.noicon'}]};
  const view=renderV7Addons({registry:registry(),repositories:api});d.body.append(view);await tick();
  browse(view);await tick();
  expect(view.querySelector('.v7-row .v7-fallback svg')).toBeTruthy();
  expect(view.querySelector('.v7-row .v7-fallback').textContent).toBe('');
  view.close();
});

it('offers three counted tabs with verification sources retained in installed and no nested back controls',async()=>{
  setup();const items=[{key:'verified',name:'Needs Verify',domain:'verify.example'},{key:'normal',name:'Normal'}];
  const verification={list:()=>[{host:'verify.example'},{host:'unknown.example'}],subscribe:()=>()=>{},begin:vi.fn()};
  const view=renderV7Addons({registry:registry(items),verification});await tick();
  expect([...view.querySelectorAll('.v7-tab')].map(x=>x.textContent)).toEqual(['الإضافات2','المثبتة2','تحتاج تحقق2']);
  expect(view.querySelector('.v7-mast')).toBeNull();expect(view.querySelector('.v7-back')).toBeNull();
  installedTab(view).click();expect(view.querySelectorAll('.v7-row')).toHaveLength(2);
  [...view.querySelectorAll('.v7-tab')].find(x=>x.textContent.includes('تحتاج تحقق')).click();
  expect(view.querySelector('.v7-body').textContent).toContain('Needs Verify');
  expect(view.querySelector('.v7-body').textContent).toContain('unknown.example');
  expect(verification.begin).not.toHaveBeenCalled();expect(view.back()).toBe(false);view.close();
});

it('gates challenged source opens until explicit verification without launching automatically',async()=>{
  setup();const open=vi.fn(),begin=vi.fn();
  const item={key:'verify',name:'Verify',domain:'verify.example',protocol:'stremio',capabilities:['catalog']};
  const view=renderV7Addons({registry:registry([item]),verification:{list:()=>[{host:'verify.example'}],begin},onOpenSource:open});await tick();installedTab(view).click();
  view.querySelector('.v7-row').click();expect(open).not.toHaveBeenCalled();expect(begin).not.toHaveBeenCalled();
  expect(view.querySelector('.v7-dialog').textContent).toContain('تحقق من المصدر');view.close();
});

it('renders functional repeated evidence and confirmed failures distinctly from unknown and transient errors',async()=>{
  setup();const now=Date.now();
  const health={state:'healthy',version:'1',cacheEpoch:'v1',functionalSuccessAt:now,functionalSuccessCount:2,samples:[10,11]};
  const base={version:'1',cacheEpoch:'v1',protocol:'stremio',capabilities:['catalog']};
  const items=[{...base,key:'stable',name:'Stable',health:{catalog:health}},
    {...base,key:'one',name:'One',health:{catalog:{...health,functionalSuccessCount:1,samples:[10]}}},
    {...base,key:'unknown',name:'Unknown'},
    {...base,key:'transient',name:'Transient',health:{catalog:{state:'failed',failures:1,reason:'timeout'}}},
    {...base,key:'gone',name:'Gone',health:{catalog:{state:'failed',failures:3,reason:'HTTP_410',scope:'source'}}}];
  const view=renderV7Addons({registry:registry(items)});await tick();installedTab(view).click();
  const states=[...view.querySelectorAll('.v7-status')];
  expect(states.map(x=>x.textContent)).toEqual(['مثبتة · مستقرة · كتالوج','مثبتة · تعمل · كتالوج','مثبتة · لم تُفحص','مثبتة · تحتاج انتباه','مثبتة · غير متاحة']);
  expect(states.map(x=>x.dataset.state)).toEqual(['stable','working','untested','attention','unavailable']);view.close();
});

it('shows actual diagnostic checklist including untested and unsupported without closing details',async()=>{
  setup();const onCheck=vi.fn(async()=>({checks:[{capability:'catalog',state:'passed',message:'Catalog response'},
    {capability:'streams',state:'untested',message:'No sample identity'},{capability:'subtitles',state:'unsupported',message:'Unsupported platform'},
    {capability:'meta',state:'failed',message:'Actual request failed'}],assessment:{level:'broken',detail:'Actual assessment detail'}}));
  const view=renderV7Addons({registry:registry([{key:'check',name:'Check'}]),onCheck});await tick();installedTab(view).click();view.querySelector('.v7-row').click();
  const action=[...view.querySelectorAll('.v7-dialog button')].find(x=>x.textContent==='فحص الإضافة');expect(action).toBeTruthy();action.click();await tick();
  expect(view.querySelector('.v7-layer').hidden).toBe(false);
  expect([...view.querySelectorAll('.v7-check')].map(x=>x.dataset.state)).toEqual(['passed','untested','unsupported','failed']);
  expect(view.querySelector('.v7-dialog').textContent).toContain('Actual assessment detail');
  expect(view.querySelector('.v7-dialog').textContent).toContain('No sample identity');
  expect(view.querySelector('.v7-dialog').textContent).toContain('غير معروف');view.close();
});

it.each([{changed:true},{changed:false},{error:'Update request failed'}])('shows real stage result %j inside details',async result=>{
  setup();const stage=async()=>{if(result.error)throw Error(result.error);return result;};
  const view=renderV7Addons({registry:{...registry([{key:'update',name:'Update'}]),stage}});await tick();installedTab(view).click();view.querySelector('.v7-row').click();
  [...view.querySelectorAll('.v7-dialog button')].find(x=>x.textContent==='فحص تحديث').click();await tick();
  expect(view.querySelector('.v7-layer').hidden).toBe(false);
  expect(view.querySelector('.v7-update-result').dataset.state).toBe(result.error?'error':result.changed?'update':'noUpdate');
  if(result.error)expect(view.querySelector('.v7-update-result').textContent).toContain(result.error);view.close();
});

it('restores repository/search/type and reports a snapshot without turning tab changes into back history',async()=>{
  setup();const api={list:async()=>({repos:[{name:'Saved Repo',url:'https://repo.example/index.json'}]}),extensions:async()=>[{name:'Native Source',pkg:'native.pkg'}]};
  const view=renderV7Addons({registry:registry(),repositories:api,initialState:{tab:'repos',openedKey:'manga:https://repo.example/index.json',search:'NaTiVe',type:'مانجا',scrollTop:42,scrollY:99}});await tick();
  expect(view.querySelector('[data-addon-search]').value).toBe('NaTiVe');expect(view.querySelector('.v7-body').textContent).toContain('Native Source');
  expect(view.snapshot()).toMatchObject({tab:'repos',openedKey:'manga:https://repo.example/index.json',search:'NaTiVe',type:'مانجا'});
  expect(view.querySelector('.v7-body .v7-back')).toBeNull();view.back();installedTab(view).click();expect(view.back()).toBe(false);view.close();
});

it('does not infer repeated functional success from timing samples or require observing timestamps inside the manager',async()=>{
  setup();const now=Date.now();
  const h={state:'healthy',version:'1',cacheEpoch:'v1',functionalSuccessAt:now-100,samples:[20,30]};
  const item={key:'observed',name:'Observed',version:'1',cacheEpoch:'v1',protocol:'stremio',capabilities:['catalog','streams'],health:{catalog:h}};
  const view=renderV7Addons({registry:registry([item])});await tick();installedTab(view).click();
  expect(view.querySelector('.v7-status').dataset.state).toBe('working');
  h.functionalSuccessCount=2;view.reload();await tick();
  expect(view.querySelector('.v7-status').dataset.state).toBe('stable');
  view.querySelector('.v7-row').click();expect(view.querySelector('.v7-evidence-detail').textContent).toContain('روابط التشغيل');
  h.cacheEpoch='v2';item.cacheEpoch='v3';view.reload();await tick();
  expect(view.querySelector('.v7-status').dataset.state).toBe('untested');view.close();
});

it('keeps native configuration inside VANTARA and refreshes the manager after Install',async()=>{
  const d=setup(),changed=vi.fn();
  const configure=vi.fn(async()=>({url:'https://addon.example/configured/manifest.json'}));
  vi.stubGlobal('Capacitor',{isNativePlatform:()=>true,Plugins:{AddonEngine:{configure}}});
  const preview={manifest:{key:'configured',name:'Configured Addon'}};
  const install=vi.fn(async()=>preview),inspect=vi.fn(async()=>preview);
  const view=renderV7Addons({registry:{...registry([{key:'configured',name:'Configured Addon',configuration:{configurable:true}}]),configurationUrl:()=> 'https://addon.example/configure',inspect,install},onSourcesChanged:changed});
  d.body.append(view);await tick();installedTab(view).click();view.querySelector('.v7-row').click();view.querySelector('[data-configure]').click();await tick();
  expect(configure).toHaveBeenCalledWith({url:'https://addon.example/configure'});
  expect(inspect).toHaveBeenCalledWith('https://addon.example/configured/manifest.json');
  expect(install).toHaveBeenCalledWith(preview);expect(changed).toHaveBeenCalledOnce();view.close();
});

it('retains one verification subscription after reload and releases it on close',async()=>{
  setup();const listeners=new Set();
  const subscribe=fn=>{listeners.add(fn);return()=>listeners.delete(fn);};
  const view=renderV7Addons({registry:registry(),verification:{subscribe}});await tick();
  view.reload();await tick();view.close();expect(listeners.size).toBe(0);
});

it('checks installed native addons using the actual diagnostic result with Arabic capability names and omitted capabilities untested',async()=>{
  setup();const onCheck=vi.fn(async()=>({checks:[{capability:'home',state:'passed',message:'Native catalog responded'}]}));
  const api={list:async()=>({repos:[{name:'Native Repo',url:'https://repo.example/index.json'}]}),extensions:async()=>[{name:'Native Check',pkg:'native.check',installed:true,capabilities:['home','search']}]};
  const view=renderV7Addons({registry:registry(),repositories:api,onCheck});await tick();browse(view);view.querySelector('.v7-row').click();
  const check=[...view.querySelectorAll('.v7-dialog button')].find(x=>x.textContent==='فحص الإضافة');expect(check).toBeTruthy();check.click();await tick();
  expect(onCheck).toHaveBeenCalledWith(expect.objectContaining({pkg:'native.check'}),expect.objectContaining({signal:expect.any(AbortSignal)}));
  expect([...view.querySelectorAll('.v7-check')].map(x=>x.dataset.state)).toEqual(['passed','untested']);
  expect(view.querySelector('.v7-checks').textContent).toContain('آخر التحديثات');expect(view.querySelector('.v7-checks').textContent).toContain('بحث');view.close();
});

it('aborts the actual diagnostic when details are dismissed and ignores late results',async()=>{
  setup();const pending=deferred();let signal;
  const view=renderV7Addons({registry:registry([{key:'abort',name:'Abort'}]),onCheck:(_a,options)=>{signal=options.signal;return pending.promise;}});await tick();installedTab(view).click();view.querySelector('.v7-row').click();
  [...view.querySelectorAll('.v7-dialog button')].find(x=>x.textContent==='فحص الإضافة').click();
  expect(view.back()).toBe(true);expect(signal.aborted).toBe(true);expect(view.querySelector('.v7-layer').hidden).toBe(true);
  pending.resolve({checks:[{capability:'catalog',state:'passed',message:'Late result'}]});await tick();
  expect(view.textContent).not.toContain('Late result');expect(view.querySelector('.v7-diagnostic').textContent).toBe('');view.close();
});

it('never routes a native package to a different addon sharing its display name',async()=>{
  setup();const open=vi.fn();
  const api={list:async()=>({repos:[{name:'Repo',url:'https://repo.example/index.json'}]}),extensions:async()=>[{name:'Same Name',pkg:'native.actual',installed:true}]};
  const view=renderV7Addons({registry:registry([{key:'remote.unrelated',name:'Same Name',protocol:'stremio',capabilities:['catalog']}]),repositories:api,onOpenSource:open});await tick();browse(view);view.querySelector('.v7-row').click();
  [...view.querySelectorAll('.v7-dialog button')].find(x=>x.textContent==='فتح في VANTARA').click();
  expect(open).not.toHaveBeenCalled();expect(view.querySelector('.v7-diagnostic').textContent).toContain('المحرك الأصلي');view.close();
});


it('shows direct manifest additions and sites on the root tab with accurate counts, kinds and search',async()=>{
  setup();const items=[{key:'direct',name:'Direct Manifest',contentTypes:['movie']},{key:'builtin',name:'Core',bundled:true}];
  const view=renderV7Addons({registry:registry(items),sites:{list:async()=>[{id:'site',label:'Saved Site',domain:'reader.example'}]}});await tick();
  expect(view.querySelector('.v7-tab').textContent).toBe('الإضافات2');
  expect(view.querySelector('.v7-body').textContent).toContain('Direct Manifest');expect(view.querySelector('.v7-body').textContent).toContain('Saved Site');
  expect(view.querySelector('.v7-body').textContent).not.toContain('Core');expect(view.querySelector('.v7-filter-wrap').hidden).toBe(false);
  view.querySelector('.v7-filter').click();[...view.querySelectorAll('.v7-menu button')].find(x=>x.textContent==='سينما').click();
  expect(view.querySelectorAll('.v7-row')).toHaveLength(1);expect(view.querySelector('.v7-body').textContent).toContain('Direct Manifest');
  const search=view.querySelector('[data-addon-search]');search.value='missing';search.oninput();expect(view.querySelectorAll('.v7-row')).toHaveLength(0);view.close();
});

it.each(['remote','native'])('renders one challenged %s source card with Verify instead of Open',async mode=>{
  setup();const begin=vi.fn(async()=>({ok:true})),open=vi.fn();
  const item={name:'Challenged',key:'challenge',pkg:'native.challenge',installed:true,domain:'verify.example',protocol:'stremio',capabilities:['catalog']};
  const api={list:async()=>({repos:[{name:'Repo',url:'https://repo.example/index.json'}]}),extensions:async()=>[item]};
  const view=renderV7Addons({registry:registry(mode==='remote'?[item]:[]),repositories:mode==='native'?api:null,verification:{list:()=>[{host:'verify.example'}],begin},onOpenSource:open,onOpenNativeSource:open});await tick();
  [...view.querySelectorAll('.v7-tab')].find(x=>x.textContent.includes('تحتاج تحقق')).click();
  expect(view.querySelectorAll('.v7-row')).toHaveLength(1);expect(view.querySelectorAll('.v7-verification-item')).toHaveLength(0);
  const buttons=[...view.querySelectorAll('.v7-row button')];expect(buttons.some(x=>x.textContent.includes('فتح'))).toBe(false);
  const verify=buttons.find(x=>x.textContent==='تحقق');expect(verify).toBeTruthy();expect(begin).not.toHaveBeenCalled();verify.click();await tick();
  expect(begin).toHaveBeenCalledWith('verify.example');expect(open).not.toHaveBeenCalled();view.close();
});


it('uses only the actual shell heading and keeps the manager add action',async()=>{
 const d=setup();d.body.innerHTML='<div class="v35">'+SHELL_HTML+'</div>';d.querySelector('#utilityTitle').textContent='الإضافات';
 const view=renderV7Addons({registry:registry()});d.querySelector('#utilityBody').append(view);await tick();
 expect([...d.querySelectorAll('#utility h1,#utility h2')].filter(x=>x.textContent==='الإضافات').length).toBe(1);
 expect(view.querySelector('h2')).toBeNull();expect(view.querySelector('.v7-plus').textContent).toBe('أضف');view.close();
});

it('keeps unknown and unsupported sources neutral while actual errors, configuration and verification need attention',async()=>{
 setup();const items=[{key:'unknown',name:'Unknown'},{key:'unsupported',name:'Unsupported',assessment:{level:'unsupported',detail:'Unavailable platform'}},
 {key:'disabled',name:'Disabled',enabled:false},{key:'config',name:'Config',configuration:{required:true,configured:false}},
 {key:'error',name:'Error',loadError:'Actual runtime error'},{key:'verify',name:'Verify',domain:'verify.example'}];
 const view=renderV7Addons({registry:registry(items),verification:{list:()=>[{host:'verify.example'}]}});await tick();installedTab(view).click();
 expect([...view.querySelectorAll('.v7-status')].map(x=>x.dataset.state)).toEqual(['untested','untested','attention','attention','attention','attention']);view.close();
});

it('uses persisted actual bundled browsing evidence without claiming untested playback functions work',async()=>{
 setup();const memory=new Map();const storage={getItem:key=>memory.get(key)||null,setItem:(key,value)=>memory.set(key,value)};
 const pulse=createSourcePulse({storage});const identity={version:'1',cacheEpoch:'core:1',capability:'home'};
 await pulse.measure('core|actual',async()=>({items:[{url:'/work',title:'Work'}]}),identity);
 await pulse.measure('core|actual',async()=>({items:[{url:'/work',title:'Work'}]}),identity);
 const restored=createSourcePulse({storage});const addon={key:'core|actual',name:'Actual',bundled:true,version:'1',capabilities:['home','search','streams']};
 const view=renderV7Addons({registry:registry([addon]),pulse:restored});await tick();installedTab(view).click();
 expect(view.querySelector('.v7-status').textContent).toBe('مثبتة · مستقرة · آخر التحديثات');
 view.querySelector('.v7-row').click();expect(view.querySelector('.v7-evidence-detail').textContent).toContain('روابط التشغيل');
 restored.record('core|actual','failed',{error:'Actual timeout',...identity});expect(view.querySelector('.v7-status').dataset.state).toBe('attention');
 view.close();restored.record('core|actual','ok',{items:1,...identity});expect(view.querySelector('.v7-layer').hidden).toBe(true);
});

it('maps installed native package status through actual package identity rather than display name',async()=>{
 setup();const pulse=createSourcePulse({storage:null});const identity={version:'1',cacheEpoch:'core:1',capability:'catalog'};
 pulse.record('core|real','ok',{items:2,...identity});pulse.record('core|real','ok',{items:2,...identity});
 const records=[{key:'core|real',name:'Real source',pkg:'native.actual',bundled:true,version:'1',capabilities:['home']},{key:'core|wrong',name:'Native package',pkg:'different',bundled:true,version:'1'}];
 const api={list:async()=>({repos:[],installed:[{name:'Native package',pkg:'native.actual',version:'1'}]}),extensions:async()=>[]};
 const view=renderV7Addons({registry:registry(records),repositories:api,pulse});await tick();installedTab(view).click();
 const row=[...view.querySelectorAll('.v7-row')].find(x=>x.querySelector('.v7-native-actions')&&x.querySelector('.v7-name').textContent==='Native package');expect(row.querySelector('.v7-status').textContent).toBe('مثبتة · مستقرة · كتالوج');view.close();
});

it('shows the recorded verification failure only inside source management',async()=>{
 const d=setup();const message='توقفت صفحة التحقق. تقدر تعيد المحاولة يدويًا.';
 const verification={list:()=>[{host:'mesh.example',message}],subscribe:()=>()=>{},begin:vi.fn()};
 const view=renderV7Addons({registry:registry(),verification});d.body.append(view);await tick();
 expect(view.querySelector('.v7-verification-item')).toBeNull();
 view.querySelector('.v7-verify-entry').click();await tick();
 expect(view.querySelector('.v7-verification-item').textContent).toContain(message);
 expect(verification.begin).not.toHaveBeenCalled();view.close();
});
