import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const { changed } = vi.hoisted(() => ({ changed: new Set() }));
vi.mock('../lib/extension-engine.js',()=>({default:{isAvailable:()=>true,sources:vi.fn(),search:vi.fn(),chapters:vi.fn(),series:vi.fn(),onSourcesChanged:(fn)=>{changed.add(fn);return()=>changed.delete(fn);}}}));
vi.mock('../lib/chapter-store.js',()=>({readWork:vi.fn(),writeWork:vi.fn(),readKv:vi.fn(),writeKv:vi.fn()}));
import engine from '../lib/extension-engine.js';
import { readWork, writeWork } from '../lib/chapter-store.js';
import { loadWork, resetSources } from './works.js';

// بلاغ المالك (21 نوفمبر): إضافة مثبّتة تعمل (Manga Million وغيرها) ولا تظهر في «المصادر» لعمل موجود فيها.
const A='eu.kanade.tachiyomi.extension.ar.teamx';
const M='eu.kanade.tachiyomi.extension.all.mangamillion#8929911308540155494';
const title='Solo Leveling';
const chapter=n=>({url:`/c/${n}`,chapterNumber:n,name:`الفصل ${n}`});
const work=()=>({id:'ext:solo',title:{english:title},_work:{key:'solo leveling',title,editions:[{sourceId:A,label:'Team X',manga:{title,url:'/a'}}]}});
let stored=null, slowFirst=true;
beforeEach(()=>{
  vi.clearAllMocks();resetSources();stored=null;slowFirst=true;
  readWork.mockImplementation(async()=>stored);
  writeWork.mockImplementation(async(_id,value)=>{stored={...value,at:Date.now()};});
  engine.chapters.mockResolvedValue([chapter(1),chapter(2)]);
  engine.series.mockImplementation(async(id)=>({manga:{title},chapters:[chapter(1),chapter(2)]}));
  engine.search.mockImplementation(async(id)=>{
    // أول بحث في إضافة لم تُحمَّل بعد: تنزيل الحزمة وفك DEX ثم الموقع (أطول من مهلة البحث)
    if(id===M&&slowFirst){slowFirst=false;await new Promise(r=>setTimeout(r,16_000));}
    return {mangas:[{title,url:id===M?'/m':'/a'}],hasNextPage:false};
  });
});
afterEach(()=>vi.useRealTimers());
const ids=full=>full._sources.map(s=>s.sourceId);

it('a source installed while the app is open is asked about the work without restarting the app',async()=>{
  slowFirst=false;
  engine.sources.mockResolvedValue([{id:A,label:'Team X',lang:'ar'}]);
  await loadWork(work());
  engine.sources.mockResolvedValue([{id:A,label:'Team X',lang:'ar'},{id:M,label:'Manga Million',lang:'ar',user:true}]);
  // التثبيت من صفحة الإضافات يبلّغ المحرك (onSourcesChanged)؛ لا مزامنة ولا إعادة تشغيل
  for(const fn of changed)fn();
  const second=await loadWork(work());
  expect(ids(second)).toContain(M);
});

it('a source too slow on its first search (cold extension load) still shows on the same open',async()=>{
  vi.useFakeTimers({shouldAdvanceTime:true});
  // عنوان عربي له صيغة واحدة: سؤال واحد للمصدر في كل جولة
  const arabic='سولو ليفلينج';
  const arWork=()=>({id:'ext:solo-ar',title:{english:arabic},_work:{key:arabic,title:arabic,editions:[{sourceId:A,label:'Team X',manga:{title:arabic,url:'/a'}}]}});
  engine.series.mockImplementation(async()=>({manga:{title:arabic},chapters:[chapter(1),chapter(2)]}));
  engine.search.mockImplementation(async(id)=>{
    if(id===M&&slowFirst){slowFirst=false;await new Promise(r=>setTimeout(r,16_000));}
    return {mangas:[{title:arabic,url:id===M?'/m':'/a'}],hasNextPage:false};
  });
  engine.sources.mockResolvedValue([{id:A,label:'Team X',lang:'ar'},{id:M,label:'Manga Million',lang:'ar',user:true}]);
  const first=loadWork(arWork());
  await vi.advanceTimersByTimeAsync(40_000);
  expect(ids(await first)).toContain(M);
  expect(stored.discoveredSources).toContain(M);
});

it('a source that does not answer at all is asked again later, not marked as asked for 12 hours, and not hammered',async()=>{
  vi.useFakeTimers({shouldAdvanceTime:true});
  let down=true;
  engine.sources.mockResolvedValue([{id:A,label:'Team X',lang:'ar'},{id:M,label:'Manga Million',lang:'ar',user:true}]);
  engine.search.mockImplementation(async(id)=>{
    if(id===M&&down)throw new Error('HTTP error 503');
    return {mangas:[{title,url:id===M?'/m':'/a'}],hasNextPage:false};
  });
  const opened=loadWork(work());
  await vi.advanceTimersByTimeAsync(40_000);
  expect(ids(await opened)).not.toContain(M);
  expect(stored.discoveredSources).not.toContain(M);
  const asks=engine.search.mock.calls.filter(c=>c[0]===M).length;
  // فتحة ثانية فورًا: لا يُطرق الموقع الساقط مرة أخرى
  await loadWork(work());
  expect(engine.search.mock.calls.filter(c=>c[0]===M).length).toBe(asks);
  // بعد مهلة الإعادة وقد عاد الموقع: يظهر
  down=false;
  await vi.advanceTimersByTimeAsync(11*60_000);
  const later=loadWork(work());
  await vi.advanceTimersByTimeAsync(40_000);
  expect(ids(await later)).toContain(M);
});

it('only new or unanswered sources are asked when a source is added, not every source again',async()=>{
  slowFirst=false;
  engine.sources.mockResolvedValue([{id:A,label:'Team X',lang:'ar'}]);
  await loadWork(work());
  engine.search.mockClear();
  engine.sources.mockResolvedValue([{id:A,label:'Team X',lang:'ar'},{id:M,label:'Manga Million',lang:'ar',user:true}]);
  resetSources();
  await loadWork(work());
  expect(new Set(engine.search.mock.calls.map(c=>c[0]))).toEqual(new Set([M]));
});

it('never lists a source that did not return the work',async()=>{
  slowFirst=false;
  engine.sources.mockResolvedValue([{id:A,label:'Team X',lang:'ar'},{id:M,label:'Manga Million',lang:'ar',user:true}]);
  engine.search.mockImplementation(async(id)=>({mangas:id===M?[{title:'Another Work Entirely',url:'/x'}]:[{title,url:'/a'}],hasNextPage:false}));
  // صفحة تفاصيل حقيقية: عنوان النسخة نفسها (الخطة ب تسأل التفاصيل حين لا دليل في القائمة)
  engine.series.mockImplementation(async(_id,manga)=>({manga:{title:manga.title},chapters:[chapter(1)]}));
  const full=await loadWork(work());
  expect(ids(full)).not.toContain(M);
});

it('The Savior\'s Bucket List: an Arabic-titled result is confirmed by its own detail page and joins the work, and is remembered', async () => {
  slowFirst=false;
  const english="The Savior's Bucket List";
  const arabic='قائمة أمنيات المنقذ';
  const saviors=()=>({id:'ext:the saviors bucket list',title:{english},_work:{key:'the saviors bucket list',title:english,editions:[{sourceId:A,label:'Mangakakalot',manga:{title:english,url:'/k'}}]}});
  engine.sources.mockResolvedValue([{id:A,label:'Mangakakalot',lang:'en'},{id:M,label:'Manga Starz',lang:'ar',user:true}]);
  engine.search.mockImplementation(async(id)=>({mangas:id===M?[{title:arabic,url:'/ar/7731'}]:[{title:english,url:'/k'}],hasNextPage:false}));
  engine.series.mockImplementation(async(_id,manga)=>({manga:manga.url==='/ar/7731'?{title:arabic,altNames:[english,'Guwonjaui Beokit Riseuteu']}:{title:manga.title},chapters:[chapter(1)]}));
  const full=await loadWork(saviors());
  expect(ids(full)).toContain(M);
  const { editionRef } = await import('../lib/manga-alias-store.js');
  const { editionKeyOf } = await import('./works.js');
  expect(editionRef(editionKeyOf({sourceId:M,manga:{url:'/ar/7731'}}))).toBe('ext:the saviors bucket list');
});

it('a detail page that does not name the work keeps the source out', async () => {
  slowFirst=false;
  engine.sources.mockResolvedValue([{id:A,label:'Team X',lang:'ar'},{id:M,label:'Manga Starz',lang:'ar',user:true}]);
  engine.search.mockImplementation(async(id)=>({mangas:id===M?[{title:'سولو ليفلينج: راجناروك',url:'/r'}]:[{title,url:'/a'}],hasNextPage:false}));
  engine.series.mockImplementation(async(_id,manga)=>({manga:manga.url==='/r'?{title:'سولو ليفلينج: راجناروك',altNames:['Solo Leveling: Ragnarok']}:{title:manga.title},chapters:[chapter(1)]}));
  const full=await loadWork(work());
  expect(ids(full)).not.toContain(M);
});

it('a work opened before the fix (old record that counted a timed-out source as asked) is asked again once, not trusted for 12 hours', async () => {
  slowFirst=false;
  engine.sources.mockResolvedValue([{id:A,label:'Team X',lang:'ar'},{id:M,label:'Manga Starz',lang:'ar',user:true}]);
  // سجل الإصدار السابق: كل المصادر «سُئلت» قبل دقيقة، بلا حقل discoveryRetryAt
  stored={at:Date.now(),discoveredAt:Date.now()-60_000,discoveredSources:[A,M],detail:{title},editions:[{sourceId:A,label:'Team X',manga:{title,url:'/a'},chapters:[chapter(1),chapter(2)]}]};
  const full=await loadWork(work());
  expect(ids(full)).toContain(M);
  // وبعد إعادة السؤال صار السجل بالصيغة الجديدة: لا يُعاد كل مرة
  engine.search.mockClear();
  await loadWork(work());
  expect(engine.search).not.toHaveBeenCalled();
});

it('the owner’s Zoro case: a stored One Piece edition (1152 chapters) leaves the spin-off, and search cannot bring it back even with a wrongly learned alias', async () => {
  slowFirst=false;
  const { normalizeTitle } = await import('../lib/catalog.js');
  const { learnAliases } = await import('../lib/manga-alias-store.js');
  const zoroTitle='One Piece: Roronoa Zoro, Umi ni Chiru';
  const zoroKey=normalizeTitle(zoroTitle);
  const zoro=()=>({id:`ext:${zoroKey}`,title:{english:zoroTitle},_work:{key:zoroKey,title:zoroTitle,editions:[{sourceId:A,label:'Team X',manga:{title:zoroTitle,url:'/zoro'}}]}});
  const many=Array.from({length:1152},(_,i)=>chapter(i+1));
  // سجل فتحة سابقة (قبل الخطة ب): نسخة ون بيس أُلصقت بالقصة الجانبية
  stored={at:Date.now(),discoveredAt:Date.now(),discoveryRetryAt:{},discoveredSources:[A,M],detail:{title:zoroTitle},
    editions:[{sourceId:A,label:'Team X',manga:{title:zoroTitle,url:'/zoro'},chapters:[chapter(1),chapter(2)]},{sourceId:M,label:'Manga Starz',manga:{title:'One Piece',url:'/one-piece'},chapters:many}]};
  // والجهاز تعلّم «One Piece» اسمًا بديلًا للقصة الجانبية من وصف مصدر
  learnAliases(zoroKey,['One Piece']);
  engine.sources.mockResolvedValue([{id:A,label:'Team X',lang:'ar'},{id:M,label:'Manga Starz',lang:'ar',user:true}]);
  engine.search.mockImplementation(async(id)=>({mangas:id===M?[{title:'One Piece',url:'/one-piece'}]:[{title:zoroTitle,url:'/zoro'}],hasNextPage:false}));
  engine.series.mockImplementation(async(_id,manga)=>({manga:{title:manga.title,altNames:manga.url==='/one-piece'?['ون بيس','ワンピース']:[]},chapters:manga.url==='/one-piece'?many:[chapter(1),chapter(2)]}));
  engine.chapters.mockImplementation(async(_id,manga)=>(manga.url==='/one-piece'?many:[chapter(1),chapter(2)]));
  const full=await loadWork(zoro());
  expect(ids(full)).not.toContain(M);
  expect(full.chapters).toBe(2);
  // والسجل نفسه نُظّف: الفتحة التالية لا تعيدها
  expect(stored.editions.map((e)=>e.manga.url)).toEqual(['/zoro']);
});

it('a known official id different from the work’s keeps the result out before any detail request', async () => {
  slowFirst=false;
  const { noteOfficialIds } = await import('../lib/manga-alias-store.js');
  noteOfficialIds([['solo leveling',105398],['solo leveling ragnarok',176009]]);
  engine.sources.mockResolvedValue([{id:A,label:'Team X',lang:'ar'},{id:M,label:'Manga Starz',lang:'ar',user:true}]);
  engine.search.mockImplementation(async(id)=>({mangas:id===M?[{title:'Solo Leveling: Ragnarok',url:'/rag',altNames:['Solo Leveling']}]:[{title,url:'/a'}],hasNextPage:false}));
  engine.series.mockClear();
  const full=await loadWork(work());
  expect(ids(full)).not.toContain(M);
  expect(engine.series.mock.calls.filter((c)=>c[0]===M)).toEqual([]);
});
