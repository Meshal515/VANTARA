import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('../lib/extension-engine.js',()=>({default:{isAvailable:()=>true,sources:vi.fn(),search:vi.fn(),chapters:vi.fn(),series:vi.fn()}}));
vi.mock('../lib/chapter-store.js',()=>({readWork:vi.fn(),writeWork:vi.fn(),readKv:vi.fn(),writeKv:vi.fn()}));
import engine from '../lib/extension-engine.js';
import { readWork } from '../lib/chapter-store.js';
import { loadWork, resetSources } from './works.js';

// عمل عُرفت نسخه من جهاز آخر: مصدر لا يملكه هذا الجهاز (Hijala على ويندوز) كان يُسأل فيرمي فورًا،
// ويظهر في «المصادر المتوفرة» بـ«لم يرد في الوقت» مع أن موقعه يعمل. ومصدر ردّ بـ403 كان يظهر بنفس العبارة.
const A='eu.kanade.tachiyomi.extension.ar.teamx',GONE='eu.kanade.tachiyomi.extension.ar.hijala',BLOCKED='eu.kanade.tachiyomi.extension.ar.mangadar';
const title='The Long Way Of The Warrior';
const chapter=n=>({url:`/chapter/${n}`,chapterNumber:n,name:`الفصل ${n}`});
const edition=(sourceId,url)=>({sourceId,label:sourceId,manga:{title,url}});
const work=()=>({id:'ext:lww',title:{english:title},_work:{key:'lww',title,editions:[edition(A,'/a'),edition(GONE,'/g'),edition(BLOCKED,'/b')]}});
beforeEach(()=>{
  vi.clearAllMocks();resetSources();
  engine.sources.mockResolvedValue([{id:A,label:'Team X'},{id:BLOCKED,label:'MangaDar'}]);
  engine.chapters.mockImplementation(async id=>{
    if(id===BLOCKED)throw new Error('HTTP error 403');
    if(id===GONE)throw new Error('المصدر غير متاح في نسخة الويب');
    return [chapter(10)];
  });
  engine.series.mockImplementation(async id=>({manga:{title},chapters:await engine.chapters(id)}));
  readWork.mockResolvedValue({at:Date.now(),discoveredAt:Date.now(),discoveredSources:[A,BLOCKED],detail:{title},editions:[{...edition(A,'/a'),chapters:[chapter(9)]},{...edition(GONE,'/g'),chapters:[chapter(8)]}]});
});

it('does not ask a source this device cannot run, and does not list it as failed',async()=>{
  const full=await loadWork(work(),{discover:false});
  expect(engine.chapters).not.toHaveBeenCalledWith(GONE,expect.anything());
  expect(engine.series).not.toHaveBeenCalledWith(GONE,expect.anything());
  expect(full._failedSources.map(f=>f.sourceId)).not.toContain(GONE);
  // فصوله المحفوظة من آخر مرة تبقى
  expect(full._chapters.some(r=>r.number===8)).toBe(true);
});

it('shows the real reason of a failing source instead of a blanket timeout',async()=>{
  const full=await loadWork(work(),{discover:false});
  const blocked=full._failedSources.find(f=>f.sourceId===BLOCKED);
  expect(blocked).toMatchObject({state:'SOURCE_ERROR',reason:'ردّ بخطأ 403'});
});
