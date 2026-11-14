import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('../lib/extension-engine.js',()=>({default:{isAvailable:()=>true,sources:vi.fn(),search:vi.fn(),chapters:vi.fn(),series:vi.fn()}}));
vi.mock('../lib/chapter-store.js',()=>({readWork:vi.fn(),writeWork:vi.fn(),readKv:vi.fn(),writeKv:vi.fn()}));
import engine from '../lib/extension-engine.js';
import { readWork } from '../lib/chapter-store.js';
import { loadWork, resetSources } from './works.js';

// قصة العمل (النبذة) كانت تُطلب من أوثق نسخة وحدها: إن فشلت أو انتهت مهلتها بقيت القصة هيكلًا للأبد
// (قيس في تطبيق ويندوز ببيانات حقيقية: Solo Leveling، 200 فصل، والقصة هيكل بعد 120 ث).
const A='eu.kanade.tachiyomi.extension.ar.teamx',B='eu.kanade.tachiyomi.extension.ar.mangalek';
const title='Solo Leveling';
const chapter=n=>({url:`/chapter/${n}`,chapterNumber:n,name:`الفصل ${n}`});
const edition=(sourceId,url)=>({sourceId,label:sourceId,manga:{title,url}});
const work=()=>({id:'ext:solo leveling',title:{english:title},_work:{key:'solo leveling',title,editions:[edition(A,'/series/sl'),edition(B,'/manga/sl')]}});
beforeEach(()=>{
  vi.clearAllMocks();resetSources();
  engine.sources.mockResolvedValue([{id:A,label:'Team X'},{id:B,label:'Mangalek'}]);
  engine.chapters.mockImplementation(async()=>[chapter(200)]);
  readWork.mockResolvedValue(null);
});

it('أوثق نسخة فشلت في التفاصيل: القصة تؤخذ من النسخة التالية، لا هيكل للأبد',async()=>{
  // أول من يُسأل عن التفاصيل (أوثق نسخة أيًّا كانت) يفشل، والتالي يردّ
  let first=null;
  engine.series.mockImplementation(async id=>{ first??=id; if(id===first) throw new Error('timeout'); return {manga:{title,description:'Sung Jinwoo, the weakest hunter.'},chapters:[chapter(200)]}; });
  const full=await loadWork(work(),{discover:false});
  expect(full.description).toBe('Sung Jinwoo, the weakest hunter.');
  expect(full._chapters.length).toBeGreaterThan(0);
});

it('لا نسخة أعادت تفاصيل: بعد أن يرد الجميع تصير القصة نصًا فارغًا (يُعرض «لا توجد نبذة») لا undefined',async()=>{
  engine.series.mockRejectedValue(new Error('down'));
  const updates=[];
  const full=await loadWork(work(),{discover:false,onUpdate:(w,{settled})=>updates.push([w.description,settled])});
  expect(full.description).toBe('');
  expect(updates.at(-1)).toEqual(['',true]);
});
