import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('../lib/extension-engine.js',()=>({default:{isAvailable:()=>true,sources:vi.fn(),search:vi.fn(),chapters:vi.fn(),series:vi.fn()}}));
vi.mock('../lib/chapter-store.js',()=>({readWork:vi.fn(),writeWork:vi.fn(),readKv:vi.fn(),writeKv:vi.fn()}));
import engine from '../lib/extension-engine.js';
import { readWork } from '../lib/chapter-store.js';
import { loadWork, resetSources } from './works.js';

const A='eu.kanade.tachiyomi.extension.ar.teamx',B='eu.kanade.tachiyomi.extension.ar.mangalek';
const title='The Long Way Of The Warrior';
const chapter=n=>({url:`/chapter/${n}`,chapterNumber:n,name:`الفصل ${n}`});
const edition=(sourceId,url)=>({sourceId,label:sourceId,manga:{title,url}});
const work=()=>({id:'ext:the long way of the warrior',title:{english:title},_work:{key:'the long way of the warrior',title,editions:[edition(A,'/series/LWW')]}});
beforeEach(()=>{
  vi.clearAllMocks();resetSources();
  engine.sources.mockResolvedValue([{id:A,label:'Team X'},{id:B,label:'Mangalek'}]);
  engine.chapters.mockImplementation(async id=>[chapter(id===B?251:218)]);
  engine.search.mockResolvedValue({mangas:[{title,url:'/manga/lww'}]});
  readWork.mockResolvedValue({at:Date.now(),discoveredAt:Date.now(),discoveredSources:[A,B],detail:{title},editions:[{...edition(A,'/series/LWW'),chapters:[chapter(218)]}]});
});

it('rechecks other Arabic editions for the clicked chapter even if normal discovery is still fresh',async()=>{
  const full=await loadWork(work(),{requestedChapter:251,arabicOnly:true});
  expect(full._chapters.some(r=>r.number===251&&r.sourceId===B)).toBe(true);
  expect(engine.search).toHaveBeenCalledWith(B,expect.any(String),1);
});

it('does not let saved editions overwrite the updated source URL from the release card',async()=>{
  const w=work();w._updateEditions=[edition(A,'/series/new-LWW')];
  await loadWork(w,{discover:false});
  expect(engine.chapters).toHaveBeenCalledWith(A,expect.objectContaining({url:'/series/new-LWW'}));
});

it('does not substitute an English-only edition for the requested Arabic chapter',async()=>{
  const en='eu.kanade.tachiyomi.extension.all.weebcentral@en';
  engine.sources.mockResolvedValue([{id:A,label:'Team X'},{id:en,label:'English',filler:true}]);
  readWork.mockResolvedValue({at:Date.now(),discoveredAt:Date.now(),discoveredSources:[A,en],detail:{title},editions:[{...edition(A,'/series/LWW'),chapters:[chapter(218)]}]});
  await loadWork(work(),{requestedChapter:251,arabicOnly:true});
  expect(engine.search).not.toHaveBeenCalledWith(en,expect.anything(),expect.anything());
});
