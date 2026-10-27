import { afterEach, expect, it, vi } from 'vitest';
import { parseHTML } from 'linkedom';
import { renderV7Addons } from './addons-v7.js';

afterEach(() => { vi.unstubAllGlobals(); });
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

it('shows real existing direct addons and saved manga sites; starts on repositories without presets', async () => {
  const d=setup();
  const sites={list:vi.fn(async()=>[{id:'site-9',label:'My Manga',domain:'reader.example',engine:'madara'}]),remove:vi.fn(async()=>{})};
  const existing={key:'addon-k',name:'My Cinemeta',enabled:true,capabilities:['catalog'],contentTypes:['movie']};
  const view=renderV7Addons({registry:registry([existing]),sites});
  d.body.append(view);await tick();
  expect(view.querySelector('.v7-body').textContent).toContain('ابدأ بإضافة');
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
    {key:'first',name:'Catalog',enabled:true,capabilities:['catalog'],contentTypes:['anime']},
    {key:'second',name:'Torrent only',enabled:true,capabilities:['streams'],contentTypes:['movie']}
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
