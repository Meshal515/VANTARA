import { expect, it } from 'vitest';
import { createDesktopEngine } from './engine.js';
import { createDesktopRuntime } from './runtime.js';

function fixture({ startError = null, replayClose = false } = {}) {
  let event;
  const starts = [], stops = [];
  const bridge = { platform: 'windows', requestResource: async () => ({ text: '{}', status: 200 }), startPlayback: async args => { starts.push(args); if (replayClose && starts.length > 1) event({ type: 'playback/closed', session: args.session }); if (startError) throw new Error(startError); return { started: true }; }, stopPlayback: async args => { stops.push(args); }, playbackCommand: async () => {}, onEvent: fn => { event = fn; return () => {}; } };
  let release = 0;
  const stream = { id: 'torrentio|0', status: 'RESOLVED', type: 'torrent', infoHash: 'a'.repeat(40), fileIdx: 0, quality: 1080, headers: {}, sources: [] };
  const source = { episodes: async () => [{ number: 1, season: 2, url: 'tt123:2:1', type: 'series' }], servers: async ep => [{ name: 'Torrentio', url: ep.url }], streams: async () => [stream] };
  const addons = { ready: Promise.resolve(), registry: { snapshot: () => ({ release: () => release++ }), list: () => [] }, sources: { source: () => source, def: () => ({ label: 'Torrentio' }), list: () => [] } };
  const engine = createDesktopEngine({ bridge, getRuntime: () => ({ addons, ready: Promise.resolve() }) });
  return { engine, bridge, starts, stops, stream, emit: e => event(e), release: () => release };
}
async function prepared(f) {
  const done = new Promise(resolve => f.engine.addListener('prepared', resolve));
  await f.engine.prepare({ session: 's', copies: [{ sourceId: 'addon|torrentio', id: 'tt123', requestedSeason: 2 }], episode: 1 });
  await done;
}
it('جلسة الغرفة تجهز المشغل متوقفًا وتعرض الجاهزية حتى يبدأ المضيف',async()=>{
  const f=fixture(),reports=[],lobbies=[];
  const room={status:'live',info:{mode:'sync'},isHost:true,canControl:true,roster:[{name:'صديق',state:'ready'}],clock:{serverNow:()=>Date.now()},timeline:{started:false,playing:false,pos:0,at:Date.now(),media:{key:'anime:owned#1'}},on:()=>()=>{},report:report=>reports.push(report),command() {}};
  f.engine.addListener('desktopTogether',lobby=>lobbies.push(lobby));
  await prepared(f);const choice=await f.engine.best({session:'s'});
  try{
    await f.engine.play({session:'s',candidate:choice.candidate,episode:1,together:{mediaPrefix:'anime:owned',session:{room,mode:'sync'},hub:{openPanel(){}}}});
    expect(f.starts[0].pause).toBe(true);
    f.emit({type:'playback/ready',session:'s'});
    expect(reports.some(report=>report.state==='ready')).toBe(true);
    expect(lobbies.some(lobby=>lobby.visible&&lobby.prepared)).toBe(true);
  }finally{await f.engine.closeSession({session:'s'});}
});
it('يجهز route دون autoplay ثم يمرر normalized candidate المختار كاملًا', async () => {
  const f = fixture();
  await prepared(f);
  const snap = await f.engine.routes({ session: 's' });
  expect(snap.routes).toMatchObject([{ state: 'READY', runtimeReady: true, sourceName: 'Torrentio', quality: 1080 }]);
  expect(f.starts).toEqual([]);
  const choice = await f.engine.pick({ session: 's', route: snap.routes[0].id });
  expect(await f.engine.best({ session: 's' })).toMatchObject(choice);
  await f.engine.play({ session: 's', candidate: choice.candidate, title: 'عنوان', animeId: 'tt123:2', episode: 1, position: 12500 });
  expect(f.starts[0]).toMatchObject({ session: 's', candidate: { ...f.stream, id: choice.candidate }, position: 12500, title: 'عنوان' });
});
it('يربط تقدم ms بالسياق وينظف الجلسة مرة واحدة ويمنع الأحداث المتأخرة', async () => {
  const f = fixture(), progress = [];
  f.engine.addListener('playback', e => progress.push(e));
  await prepared(f);
  const best = await f.engine.best({ session: 's' });
  await f.engine.play({ session: 's', candidate: best.candidate, animeId: 'tt123:2', episode: 1 });
  f.emit({ type: 'playback/progress', session: 's', position: 15000, duration: 900000 });
  expect(progress[0]).toMatchObject({ animeId: 'tt123:2', episode: 1, position: 15000, duration: 900000 });
  await f.engine.closeSession({ session: 's' });
  f.emit({ type: 'playback/progress', session: 's', position: 20000 });
  await f.engine.closeSession({ session: 's' });
  expect(f.release()).toBe(1);
  expect(f.stops).toEqual([{ session: 's' }]);
  expect(progress).toHaveLength(2);
  expect(progress[1]).toMatchObject({ final: true });
  await expect(f.engine.play({ session: 's', candidate: best.candidate })).rejects.toThrow('الجلسة');
});
it('يعرض خطأ native start في حدث واضح ويعيد الخطأ للمنادي', async () => {
  const f = fixture({ startError: 'تعذر إقلاع المشغل' }), errors = [];
  f.engine.addListener('playerError', e => errors.push(e));
  await prepared(f);
  const best = await f.engine.best({ session: 's' });
  await expect(f.engine.play({ session: 's', candidate: best.candidate })).rejects.toThrow('تعذر إقلاع المشغل');
  expect(errors).toMatchObject([{ session: 's', message: 'تعذر إقلاع المشغل' }]);
  await expect(f.engine.play({ session: 's', candidate: 'unknown' })).rejects.toThrow('الجلسة');
});
it('يبقي تورنت خارج core Android ويستعيد registry من التخزين الدائم', async () => {
  const data = new Map(), urls = [];
  const storage = { getItem: key => data.get(key) ?? null, setItem: (key, val) => data.set(key, val), removeItem: key => data.delete(key) };
  const bridge = { requestResource: async args => { urls.push(args); return { status: 200, text: JSON.stringify({ id: 'org.torrentio', name: 'Torrentio', version: '1.0.0', resources: ['stream'], types: ['movie'], catalogs: [] }) }; } };
  const one = createDesktopRuntime({ bridge, storage }); await one.addons.ready;
  await one.addons.registry.install(await one.addons.registry.inspect('https://torrentio.test/token?key=secret'));
  const two = createDesktopRuntime({ bridge, storage }); await two.addons.ready;
  expect(two.registry.list()).toEqual([]);
  expect(two.addons.registry.list()).toMatchObject([{ name: 'Torrentio', enabled: true }]);
  expect(urls[0]).toMatchObject({ url: 'https://torrentio.test/token/manifest.json?key=secret', json: true });
});

it('يبقي الجلسة عند استبدال المشغل بنفس session ولا يقبل إغلاق اللاعب السابق كنهاية الجديدة', async () => {
  const f = fixture({ replayClose: true }), progress = [];
  f.engine.addListener('playback', e => progress.push(e));
  await prepared(f);
  const best = await f.engine.best({ session: 's' });
  await f.engine.play({ session: 's', candidate: best.candidate, position: 1000 });
  await f.engine.play({ session: 's', candidate: best.candidate, position: 2000 });
  f.emit({ type: 'playback/progress', session: 's', position: 3000, duration: 10000 });
  expect((await f.engine.routes({ session: 's' })).routes).toHaveLength(1);
  expect(f.release()).toBe(0);
  expect(progress).toMatchObject([{ position: 3000, final: false }]);
});

function coreFixture({ pendingSearch = null, pendingProvider = null } = {}) {
  const events=[],commands=[],calls=[],starts=[];
  const source={search:async query=>pendingSearch?pendingSearch.promise:[{url:'/work/owned',title:query,thumbnail:'poster'}],episodes:async()=>[{url:'/episode/1',number:1}],servers:async()=>[{name:'Owned',key:'one'}],streams:async(_sv,publish)=>{const result=[{url:'https://video.example.com/owned.mp4',type:'mp4',referer:'https://source.example.com/',quality:720,subtitles:[{url:'https://subs.example.com/embedded.srt',lang:'ar',label:'عربية مضمنة'}]}];publish?.(result);return result;}};
  const def={id:'owned-core',label:'مصدر مملوك',content:'cinema'};
  const providers=[{key:'fixture-subtitles',name:'ترجمة مملوكة',subtitles:async()=>pendingProvider?pendingProvider.promise:[{url:'https://subs.example.com/discovered.srt',lang:'ar'}]}];
  const runtime={ready:Promise.resolve(),addons:{ready:Promise.resolve(),registry:{snapshot:()=>({release(){}})},sources:{list:content=>!content||content===def.content?[def]:[],def:()=>def,source:()=>source,call:async(id,fn)=>{calls.push(id);return fn(source);},cooling:()=>false},subtitleProviders:()=>providers}};
  let event;
  const bridge={onEvent:fn=>event=fn,startPlayback:async args=>{starts.push(args);return {started:true};},stopPlayback:async()=>{},playbackCommand:async args=>commands.push(args)};
  const engine=createDesktopEngine({bridge,getRuntime:()=>runtime});for(const name of ['searchHit','searchDone','prepared','playerError'])engine.addListener(name,data=>events.push({name,...data}));
  return {engine,events,commands,calls,starts,runtime,emit:e=>event(e)};
}
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const tick=()=>new Promise(r=>setTimeout(r,0));
async function episodeRaceFixture() {
  const f = coreFixture(), pending = deferred(), listeners = new Map();
  const source = f.runtime.addons.sources.source();
  source.episodes = async () => [1,2,3].map(number => ({number,url:String(number)}));
  source.servers = async ep => [{name:'Owned',number:ep.number}];
  source.streams = async server => { if(server.number===2)await pending.promise;return [{url:`https://video.example.com/${server.number}.mp4`}]; };
  const room = {status:'live',info:{mode:'sync'},timeline:{media:{key:'anime:owned#1'},started:false,playing:false,pos:0,at:0},roster:[],clock:{serverNow:()=>0},report(){},command(){},on(name,fn){const set=listeners.get(name)??new Set();set.add(fn);listeners.set(name,set);return()=>set.delete(fn);}};
  const handOff={room,mode:'sync'},hub={session:handOff,openPanel(){},onChange(fn){listeners.set('hub-change',new Set([fn]));return()=>listeners.get('hub-change').delete(fn);}};
  await f.engine.prepare({session:'episode-race',copies:[{sourceId:'owned-core',url:'/series'}],episode:1});await tick();
  const best=await f.engine.best({session:'episode-race'});
  await f.engine.play({session:'episode-race',candidate:best.candidate,episode:1,together:{session:handOff,hub,mediaPrefix:'anime:owned'}});
  const emit=(name,value)=>{for(const fn of [...listeners.get(name)??[]])fn(value);};
  const episode=number=>{room.timeline={...room.timeline,media:{key:`anime:owned#${number}`}};emit('state',{state:room.timeline});};
  return {...f,pending,room,hub,episode,roomEmit:emit};
}
it('تبديل 2 ثم 3 يبطل metadata القديمة ولا يعيد المشغل أو ينسب تقدم 3 إلى 2',async()=>{
  const f=await episodeRaceFixture(),progress=[];f.engine.addListener('playback',event=>progress.push(event));
  try {
    f.episode(2);await tick();f.episode(3);await tick();await tick();
    expect(f.starts.map(s=>s.candidate.url)).toEqual(['https://video.example.com/1.mp4','https://video.example.com/3.mp4']);
    expect((await f.engine.routes({session:'episode-race'})).done).toBe(true);
    f.pending.resolve();await tick();await tick();
    expect(f.starts).toHaveLength(2);
    expect((await f.engine.routes({session:'episode-race'})).routes.map(r=>r.id)).toEqual(['owned-core|/series|episode:3']);
    f.emit({type:'playback/progress',session:'episode-race',position:10000});expect(progress.at(-1).episode).toBe(3);
  } finally { await f.engine.closeSession({session:'episode-race'}); }
});
it('مغادرة الغرفة أثناء metadata تمنع إعادة تشغيل الحلقة المتأخرة',async()=>{
  const f=await episodeRaceFixture();
  try {
    f.episode(2);await tick();f.hub.session=null;f.room.status='closed';f.roomEmit('connection','closed');f.roomEmit('hub-change');
    f.pending.resolve();await tick();await tick();
    expect(f.starts).toHaveLength(1);
    expect((await f.engine.routes({session:'episode-race'})).routes.some(r=>r.state==='READY'&&r.id.includes('episode:2'))).toBe(false);
  } finally {await f.engine.closeSession({session:'episode-race'});}
});
it('أمر حلقة أحدث في نفس tick يحتفظ بنسخ العمل ولا ينتظر توقف الحلقة الملغاة',async()=>{
  const f=await episodeRaceFixture();
  try {
    f.episode(2);f.episode(3);await tick();await tick();f.pending.resolve();await tick();
    expect(f.starts.map(s=>s.candidate.url)).toEqual(['https://video.example.com/1.mp4','https://video.example.com/3.mp4']);
    expect((await f.engine.routes({session:'episode-race'})).done).toBe(true);
  } finally {await f.engine.closeSession({session:'episode-race'});}
});
it('يبحث في core cinema عبر sources.call ويعيد works وsearchHit بنفس العقد',async()=>{
  const f=coreFixture();
  expect(await f.engine.search({query:'عمل مملوك',content:'cinema'})).toMatchObject({works:[{title:'عمل مملوك',copies:[{sourceId:'owned-core',url:'/work/owned'}]}]});
  await f.engine.searchStream({query:'عمل مملوك',content:'cinema',searchId:'core-search'});await tick();
  expect(f.events).toContainEqual(expect.objectContaining({name:'searchHit',searchId:'core-search',sourceId:'owned-core',items:[expect.objectContaining({title:'عمل مملوك'})]}));
  expect(f.events).toContainEqual(expect.objectContaining({name:'searchDone',searchId:'core-search'}));expect(f.calls).toEqual(['owned-core','owned-core']);
});
it('يجهز فيلم core episode=-1 ويحفظ referer وينشر callback دون duplicate',async()=>{
  const f=coreFixture();await f.engine.prepare({session:'core-movie',copies:[{sourceId:'owned-core',url:'/work/owned'}],episode:-1});await tick();
  const routes=await f.engine.routes({session:'core-movie'});expect(routes.routes).toHaveLength(1);expect(routes.routes[0]).toMatchObject({state:'READY',sourceName:'مصدر مملوك',quality:720});
  const best=await f.engine.best({session:'core-movie'});expect(best.candidate).toBeTruthy();expect(f.calls.length).toBeGreaterThanOrEqual(3);
  await f.engine.play({session:'core-movie',candidate:best.candidate});expect(f.starts[0].candidate.headers).toEqual({Referer:'https://source.example.com/'});
});
it('يلغي بحث core البطيء ويمنع searchHit المتأخر',async()=>{
  const pendingSearch=deferred(),f=coreFixture({pendingSearch});
  await f.engine.searchStream({query:'عمل',content:'cinema',searchId:'cancelled'});await tick();expect(f.calls).toEqual(['owned-core']);await f.engine.cancelSearch({searchId:'cancelled'});pendingSearch.resolve([{url:'/owned',title:'متأخر'}]);await tick();
  expect(f.events.filter(e=>e.name==='searchHit')).toEqual([]);
});
it('discoverSubtitles يستخدم subtitleIdentity ومزود runtime في الخلفية دون منع الفيديو',async()=>{
  const pendingProvider=deferred(),f=coreFixture({pendingProvider});await f.engine.prepare({session:'subs',copies:[{sourceId:'owned-core',url:'/work/owned'}],episode:-1});await tick();
  const best=await f.engine.best({session:'subs'});
  expect(await f.engine.play({session:'subs',candidate:best.candidate,subtitleIdentity:{kind:'movie',externalIds:{imdb:'tt123'}}})).toEqual({started:true});
  pendingProvider.resolve([{url:'https://subs.example.com/arabic.srt',lang:'ara',label:'العربية'}]);await tick();await tick();
  expect(f.commands).toContainEqual(expect.objectContaining({session:'subs',command:'subtitle-load',value:expect.objectContaining({url:'https://subs.example.com/arabic.srt',lang:'ar'})}));
});
it('نتيجة ترجمة من تشغيل سابق بنفس session لا تلتحق بالتشغيل الجديد',async()=>{
  const pendingProvider=deferred(),f=coreFixture({pendingProvider});await f.engine.prepare({session:'same',copies:[{sourceId:'owned-core',url:'/work/owned'}],episode:-1});await tick();
  const best=await f.engine.best({session:'same'});
  await f.engine.play({session:'same',candidate:best.candidate,subtitleIdentity:{kind:'movie',externalIds:{imdb:'tt123'}}});
  f.runtime.addons.subtitleProviders=()=>[];
  await f.engine.play({session:'same',candidate:best.candidate,subtitleIdentity:{kind:'movie',externalIds:{imdb:'tt456'}}});
  pendingProvider.resolve([{url:'https://subs.example.com/late.srt',lang:'ar'}]);await tick();await tick();
  expect(f.commands.some(c=>c.value?.url?.includes('late.srt'))).toBe(false);
});

it('episodes واجهة core تمر عبر مصدر السياسة نفسه',async()=>{
  const f=coreFixture();expect(await f.engine.episodes({anime:{sourceId:'owned-core',url:'/work/owned'}})).toEqual({episodes:[{url:'/episode/1',number:1}]});expect(f.calls).toEqual(['owned-core']);
});
it('تعطل مزود الترجمة لا يطلق playerError ولا يغلق مسار الفيديو',async()=>{
  const f=coreFixture();f.runtime.addons.subtitleProviders=()=>[{key:'failed-provider',subtitles:async()=>{throw new Error('provider offline');}}];
  await f.engine.prepare({session:'provider-failure',copies:[{sourceId:'owned-core',url:'/work/owned'}],episode:-1});await tick();const best=await f.engine.best({session:'provider-failure'});
  expect(await f.engine.play({session:'provider-failure',candidate:best.candidate,subtitleIdentity:{kind:'movie',externalIds:{imdb:'tt123'}}})).toEqual({started:true});await tick();
  expect(f.events.some(e=>e.name==='playerError')).toBe(false);expect((await f.engine.routes({session:'provider-failure'})).routes[0].state).toBe('READY');
});
it('cooling core لا يرسل طلب بحث ويصدر skipped واضحًا',async()=>{
  const f=coreFixture();f.runtime.addons.sources.cooling=()=>true;await f.engine.searchStream({searchId:'cooled',query:'عمل',content:'cinema'});await tick();expect(f.calls).toEqual([]);expect(f.events).toContainEqual(expect.objectContaining({name:'searchHit',searchId:'cooled',skipped:true,items:[]}));
});

it('مغادرة الغرفة قبل أول إطار تتيح مشاهدة الفيديو المختار فرديًا دون انتظار المضيف',async()=>{
 const f=fixture(),commands=[],listeners=new Map();f.bridge.playbackCommand=async command=>commands.push(command);
 const room={status:'live',info:{mode:'sync'},isHost:true,canControl:true,roster:[],clock:{serverNow:()=>Date.now()},timeline:{started:false,playing:false,pos:0,at:Date.now(),media:{key:'anime:owned#1'}},on:(name,fn)=>{listeners.set(name,fn);return()=>listeners.delete(name);},report(){},command(){}};
 await prepared(f);const best=await f.engine.best({session:'s'});
 try {await f.engine.play({session:'s',candidate:best.candidate,episode:1,together:{mediaPrefix:'anime:owned',session:{room,mode:'sync'},hub:{openPanel(){}}}});room.status='closed';listeners.get('connection')();f.emit({type:'playback/ready',session:'s'});expect(commands).toContainEqual({session:'s',command:'pause',value:false});}finally{await f.engine.closeSession({session:'s'});}
});
