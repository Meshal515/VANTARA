import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDesktopServices, selectTorrentFile, validateCandidate, resolvePublicURL, validateTorrentStorage } from './services.mjs';

const hash = 'a'.repeat(40);
test('HTTPS يرفض الأهداف الداخلية وكل DNS يحتوي عنوانًا داخليًا', async () => {
  for (const url of ['http://example.com/', 'https://127.0.0.1/', 'https://[::1]/', 'https://user:pass@example.com/', 'https://localhost/']) {
    await assert.rejects(resolvePublicURL(url), /رابط|داخلي/);
  }
  await assert.rejects(resolvePublicURL('https://example.com/', async () => [{address:'93.184.216.34',family:4},{address:'10.0.0.1',family:4}]), /داخلي/);
  const result = await resolvePublicURL('https://example.com/token?secret=1', async () => [{address:'93.184.216.34',family:4}]);
  assert.equal(result.address, '93.184.216.34');
  assert.equal(result.url.search, '?secret=1');
});
test('اختيار fileIdx صفر دقيق ولا يخمّن أكبر ملف', () => {
  const files = [{name:'small.mp4',length:10},{name:'large.mkv',length:999}];
  assert.equal(selectTorrentFile(files,{fileIdx:0}),0);
  assert.equal(selectTorrentFile(files,{filename:'large.mkv'}),1);
  assert.equal(selectTorrentFile([files[0]],{}),0);
  assert.throws(() => selectTorrentFile(files,{}), /small.mp4.*large.mkv/);
  assert.throws(() => selectTorrentFile(files,{fileIdx:2}), /fileIdx/);
});
test('لا يقبل hashes أو headers أو magnets مخالفة للعقد', () => {
  assert.equal(validateCandidate({infoHash:hash,fileIdx:0,sources:['tracker:https://example.com/announce']}).fileIdx,0);
  for (const candidate of [{infoHash:'bad'},{infoHash:hash,fileIdx:-1},{infoHash:hash,magnet:`magnet:?xt=urn:btih:${'b'.repeat(40)}`},{url:'https://example.com/',headers:{Host:'private'}},{url:'https://example.com/',headers:{Authorization:'line\nbreak'}}]) {
    assert.throws(() => validateCandidate(candidate));
  }
});

async function fixture(t, mode='normal') {
  const dir=await mkdtemp(join(tmpdir(),'vantara-services-test-'));
  t.after(() => rm(dir,{recursive:true,force:true}));
  const rqbit=join(dir,'rqbit'), mpv=join(dir,'mpv');
  await writeFile(rqbit, `#!${process.execPath}\nimport http from 'node:http';import fs from 'node:fs';
const args=process.argv.slice(2),port=Number(args[args.indexOf('--http-api-listen-addr')+1].split(':').pop());
fs.writeFileSync(${JSON.stringify(join(dir,'rqbit-log'))},JSON.stringify({args,pid:process.pid,auth:process.env.RQBIT_HTTP_BASIC_AUTH_USERPASS}));
const server=http.createServer((req,res)=>{if(req.headers.authorization!=='Basic '+Buffer.from(process.env.RQBIT_HTTP_BASIC_AUTH_USERPASS).toString('base64')){res.writeHead(401);return res.end();}let body='';req.on('data',x=>body+=x);req.on('end',()=>{fs.appendFileSync(${JSON.stringify(join(dir,'requests'))},JSON.stringify({url:req.url,body})+'\\n');res.setHeader('content-type','application/json');if(req.method==='POST'&&req.url.startsWith('/torrents?')){if(${JSON.stringify(mode)}==='slow')return;const u=new URL(req.url,'http://local');if(!u.searchParams.has('list_only')&&u.searchParams.get('only_files')!=='0'){res.writeHead(400);return res.end('{}');}return res.end(JSON.stringify({id:u.searchParams.has('list_only')?null:0,details:{info_hash:${JSON.stringify(hash)},files:[{name:'clip.mp4',length:${mode==='oversize'?3*1024**3:mode==='unknown'?JSON.stringify('unknown'):20}},{name:'other.mkv',length:900}]}}));}if(req.url.includes('stats'))return res.end(JSON.stringify({live:{download_speed:{mbps:1},snapshot:{peer_stats:{live:3}}}}));res.end('{}');});});server.listen(port,'127.0.0.1');`);
  await writeFile(mpv, `#!${process.execPath}\nimport net from 'node:net';import fs from 'node:fs';const args=process.argv.slice(2);fs.writeFileSync(${JSON.stringify(join(dir,'mpv-log'))},JSON.stringify(args));const socket=args.find(x=>x.startsWith('--input-ipc-server=')).split('=').slice(1).join('=');net.createServer(c=>{let pending='';c.on('data',b=>{pending+=b;while(pending.includes('\\n')){const i=pending.indexOf('\\n'),m=JSON.parse(pending.slice(0,i));pending=pending.slice(i+1);fs.appendFileSync(${JSON.stringify(join(dir,'commands'))},JSON.stringify(m)+'\\n');c.write(JSON.stringify({request_id:m.request_id,error:'success',data:m.command[0]==='get_property'?{w:320,h:180}:undefined})+'\\n');if(m.command[0]==='observe_property')c.write(JSON.stringify({event:'property-change',name:m.command[2],data:m.command[2]==='duration'?60:m.command[2]==='time-pos'?2:m.command[2]==='video-out-params'?{w:320,h:180}:false})+'\\n');if(m.command[0]==='loadfile'){c.write(JSON.stringify({event:'file-loaded'})+'\\n');c.write(JSON.stringify({event:'playback-restart'})+'\\n');}}});c.write(JSON.stringify({event:'file-loaded'})+'\\n');}).listen(socket);`);
  const {chmod}=await import('node:fs/promises');await chmod(rqbit,0o755);await chmod(mpv,0o755);
  const events=[];const services=createDesktopServices({userData:dir,binaries:{rqbit,mpv},onEvent:e=>events.push(e),platform:process.platform});
  t.after(()=>services.close());return {dir,services,events,binaries:{rqbit,mpv}};
}
test('عمليات حقيقية: rqbit خاص وملف واحد ثم mpv IPC وتقدم وأوامر وتنظيف',async t=>{
  const {dir,services,events}=await fixture(t);
  assert.deepEqual(await services.startPlayback({session:'one',candidate:{type:'torrent',infoHash:hash,fileIdx:0},title:'عنوان عربي',position:5000}),{started:true});
  await new Promise(r=>setTimeout(r,150));
  const rq=JSON.parse(await readFile(join(dir,'rqbit-log'),'utf8'));
  assert.ok(rq.args.includes('--disable-upnp-port-forward'));
  assert.ok(rq.args.includes('--disable-lsd'));
  assert.ok(rq.args.includes('--disable-persistence'));
  assert.match(rq.auth,/^vantara:[a-f0-9]{48}$/);
  const requests=(await readFile(join(dir,'requests'),'utf8')).trim().split('\n').map(JSON.parse);
  assert.ok(requests.some(r=>r.url.includes('list_only=true')));
  assert.ok(requests.some(r=>r.url.includes('only_files=0')));
  const mpv=JSON.parse(await readFile(join(dir,'mpv-log'),'utf8'));
  assert.ok(mpv.includes('--no-config'));assert.ok(mpv.includes('--start=5'));
  assert.ok(mpv.includes('--title=عنوان عربي'));
  assert.ok(!mpv.join(' ').includes(rq.auth));
  assert.ok(events.some(e=>e.type==='playback/ready'));
  assert.ok(events.some(e=>e.type==='playback/progress'&&e.position===2000&&e.duration===60000));
  await services.playbackCommand({session:'one',command:'pause',value:true});
  await services.playbackCommand({session:'one',command:'seek',value:9000});
  await assert.rejects(services.playbackCommand({session:'old',command:'pause',value:true}),/جلسة/);
  const commands=(await readFile(join(dir,'commands'),'utf8')).trim().split('\n').map(JSON.parse);
  assert.ok(commands.some(m=>JSON.stringify(m.command)==='["set_property","pause",true]'));
  assert.ok(commands.some(m=>JSON.stringify(m.command)==='["seek",9,"absolute"]'));
  await services.stopPlayback({session:'one'});
  assert.equal(events.filter(e=>e.type==='playback/closed').length,1);
  assert.throws(()=>process.kill(rq.pid,0),{code:'ESRCH'});
  await services.close();await assert.rejects(services.startPlayback({session:'two',candidate:{infoHash:hash,fileIdx:0}}),/أغلقت/);
});
test('الإغلاق أثناء metadata يلغي الطلب ولا يترك عملية أو حدث جلسة قديمة',async t=>{
  const {services,events}=await fixture(t,'slow');
  const start=services.startPlayback({session:'slow',candidate:{infoHash:hash,fileIdx:0}});
  const rejected=assert.rejects(start,/ألغيت|جلسة/);
  await new Promise(r=>setTimeout(r,150));await services.close();await rejected;
  assert.ok(!events.some(e=>e.type==='playback/ready'||e.type==='playback/error'));
});

test('مهلة HTTPS تشمل انتظار DNS ولا تنتظر إلى الأبد',async t=>{
  const {default:dns}=await import('node:dns/promises');
  t.mock.method(dns,'lookup',()=>new Promise(()=>{}));
  const {services}=await fixture(t);
  const outcome=await Promise.race([services.requestResource({url:'https://example.com/',timeout:100}).then(()=>'success',()=>'timeout'),new Promise(r=>setTimeout(()=>r('pending'),400))]);
  assert.equal(outcome,'timeout');
});
test('تبديل جلسة أثناء metadata يترك فقط المشغل الجديد',async t=>{
  const {services,events}=await fixture(t,'slow');
  const old=services.startPlayback({session:'old',candidate:{infoHash:hash,fileIdx:0}});
  const cancelled=assert.rejects(old,/ألغيت|جلسة/);
  await new Promise(r=>setTimeout(r,120));
  assert.deepEqual(await services.startPlayback({session:'new',candidate:{url:'https://example.com/owned.mp4'},title:'جديد'}),{started:true});
  await cancelled;await new Promise(r=>setTimeout(r,30));
  assert.ok(events.some(e=>e.session==='new'&&e.type==='playback/ready'));
  assert.ok(!events.some(e=>e.session==='old'&&['playback/error','playback/ready'].includes(e.type)));
  await services.stopPlayback({session:'old'});
  await services.playbackCommand({session:'new',command:'pause',value:true});
});
test('نقل الإضافات يحد حجم الاستجابة ويرفض إعادة التوجيه ولا يرسل auth',async t=>{
  const {default:https}=await import('node:https'),{default:http}=await import('node:http'),{default:dns}=await import('node:dns/promises');
  const requests=[];
  const server=http.createServer((req,res)=>{requests.push(req.headers);if(req.url==='/redirect'){res.writeHead(302,{location:'https://127.0.0.1/'});return res.end();}res.end(req.url==='/large'?'x'.repeat(1000):'{"fixture":true}');});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
  // Isolate DNS/TLS transport; the real response stream, limits, aborts and
  // redirect policy still run against a local subprocess-independent server.
  t.mock.method(dns,'lookup',async()=>[{address:'93.184.216.34',family:4}]);
  t.mock.method(https,'request',(url,options,callback)=>http.request(`http://127.0.0.1:${server.address().port}${url.pathname}`,{...options,lookup:undefined},callback));
  const {services}=await fixture(t);
  assert.deepEqual(await services.requestResource({url:'https://example.com/json',json:true,limit:100}),{text:'{"fixture":true}',status:200});
  await assert.rejects(services.requestResource({url:'https://example.com/large',limit:20}),/حجم/);
  await assert.rejects(services.requestResource({url:'https://example.com/redirect'}),/توجيه/);
  assert.equal(requests[0].accept,'application/json');assert.equal(requests[0].authorization,undefined);
});

test('proxy يمرر Range ويحصر headers بالأصل عبر redirects دون كشفها للمشغل',async t=>{
  const {default:https}=await import('node:https'),{default:http}=await import('node:http'),{default:dns}=await import('node:dns/promises');
  const seen=[];
  const upstream=http.createServer((req,res)=>{seen.push({path:req.url,headers:req.headers});if(req.url==='/origin'){res.writeHead(302,{location:'https://cdn.example.com/clip'});return res.end();}res.writeHead(206,{'content-type':'video/mp4','content-range':'bytes 0-3/10','accept-ranges':'bytes'});res.end('abcd');});
  await new Promise(r=>upstream.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>upstream.close(r)));
  t.mock.method(dns,'lookup',async()=>[{address:'93.184.216.34',family:4}]);
  t.mock.method(https,'request',(url,options,cb)=>http.request(`http://127.0.0.1:${upstream.address().port}${url.pathname}`,{...options,lookup:undefined},cb));
  const {services,dir}=await fixture(t);
  await services.startPlayback({session:'headers',candidate:{url:'https://example.com/origin',headers:{Authorization:'secret-token','X-Foo':'sensitive'}}});
  const args=JSON.parse(await readFile(join(dir,'mpv-log'),'utf8')),commands=(await readFile(join(dir,'commands'),'utf8')).trim().split('\n').map(JSON.parse),local=commands.find(m=>m.command[0]==='loadfile')?.command[1]??args.at(-1);
  assert.ok(!args.join(' ').includes('secret-token'));
  const response=await fetch(local,{headers:{Range:'bytes=0-3'}});assert.equal(response.status,206);assert.equal(await response.text(),'abcd');
  assert.equal(seen[0].headers.authorization,'secret-token');assert.equal(seen[0].headers.range,'bytes=0-3');
  assert.equal(seen[1].headers.authorization,undefined);assert.equal(seen[1].headers['x-foo'],undefined);assert.equal(seen[1].headers.range,'bytes=0-3');
  assert.equal((await fetch(new URL('/wrong/0',local))).status,404);
});
test('HLS يعيد كتابة المراجع النسبية والمطلقة بقنوات خاصة ويحمي أسرار الترويسات',async t=>{
  const {default:https}=await import('node:https'),{default:http}=await import('node:http'),{default:dns}=await import('node:dns/promises');
  const seen=[];
  const upstream=http.createServer((req,res)=>{seen.push({path:req.url,auth:req.headers.authorization});if(req.url==='/folder/index.m3u8'){res.setHeader('content-type','application/vnd.apple.mpegurl');res.end('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="https://keys.example.com/key"\n#EXTINF:1,\nsegment.ts?token=kept\n');}else res.end('fixture');});
  await new Promise(r=>upstream.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>upstream.close(r)));
  t.mock.method(dns,'lookup',async()=>[{address:'93.184.216.34',family:4}]);
  t.mock.method(https,'request',(url,options,cb)=>http.request(`http://127.0.0.1:${upstream.address().port}${url.pathname}${url.search}`,{...options,lookup:undefined},cb));
  const {services,dir}=await fixture(t);
  await services.startPlayback({session:'hls',candidate:{type:'hls',url:'https://example.com/folder/index.m3u8',headers:{Authorization:'token'}}});
  const args=JSON.parse(await readFile(join(dir,'mpv-log'),'utf8'));
  const commands=(await readFile(join(dir,'commands'),'utf8')).trim().split('\n').map(JSON.parse),local=commands.find(m=>m.command[0]==='loadfile')?.command[1]??args.at(-1);
  const playlist=await (await fetch(local)).text(),key=/URI="([^"]+)"/.exec(playlist)[1],segment=playlist.trim().split('\n').at(-1);
  assert.ok(key.startsWith('http://127.0.0.1:'));assert.ok(segment.startsWith('http://127.0.0.1:'));
  await (await fetch(key)).text();await (await fetch(segment)).text();
  assert.deepEqual(seen,[{path:'/folder/index.m3u8',auth:'token'},{path:'/key',auth:undefined},{path:'/folder/segment.ts?token=kept',auth:'token'}]);
});

test('فشل callback الأحداث لا يمنع إنهاء العمليات وتنظيف ملفات التحميل',async t=>{
  const {dir,services:unused,binaries}=await fixture(t);await unused.close();
  const events=[];
  const services=createDesktopServices({userData:dir,binaries,onEvent:event=>{events.push(event);if(event.type==='playback/closed')throw new Error('callback failed');}});
  t.after(()=>services.close());
  await services.startPlayback({session:'callback',candidate:{infoHash:hash,fileIdx:0}});
  const rq=JSON.parse(await readFile(join(dir,'rqbit-log'),'utf8'));
  await services.stopPlayback({session:'callback'});
  assert.throws(()=>process.kill(rq.pid,0),{code:'ESRCH'});
  const {readdir}=await import('node:fs/promises');assert.deepEqual(await readdir(join(dir,'torrent-cache')),[]);
});

test('فشل mpv قبل الفيديو يطلق error واضحًا دون ready أو closed ناجح',async t=>{
  const {services,events,binaries}=await fixture(t);
  await writeFile(binaries.mpv,`#!${process.execPath}\nprocess.exit(2);`);
  await assert.rejects(services.startPlayback({session:'broken-player',candidate:{url:'https://example.com/owned.mp4'}}),/تعذر|أغلق/);
  assert.equal(events.filter(e=>e.type==='playback/error').length,1);
  assert.equal(events.filter(e=>e.type==='playback/ready'||e.type==='playback/closed').length,0);
});

test('file-loaded وtime-pos لا يكفيان لإعلان فيديو جاهز قبل playback-restart وإطار ذي أبعاد',async t=>{
  const {services,events,binaries}=await fixture(t);
  let source=await readFile(binaries.mpv,'utf8');
  source=source.replace("c.write(JSON.stringify({event:'playback-restart'})+'\\n');",'');
  await writeFile(binaries.mpv,source);
  await services.startPlayback({session:'not-decoded',candidate:{url:'https://example.com/clip.mp4'}});
  await new Promise(r=>setTimeout(r,60));
  assert.equal(events.filter(e=>e.type==='playback/ready').length,0);
});

test('مصدر صوت فقط لا يعلن ready ويقدم خطأ إطار الفيديو',async t=>{
  const {services,events,binaries}=await fixture(t);
  const source=(await readFile(binaries.mpv,'utf8')).replace("m.command[0]==='get_property'?{w:320,h:180}:undefined", "m.command[0]==='get_property'?null:undefined");
  await writeFile(binaries.mpv,source);
  await services.startPlayback({session:'audio-only',candidate:{url:'https://example.com/audio.mp4'}});
  await new Promise(r=>setTimeout(r,60));
  assert.equal(events.filter(e=>e.type==='playback/ready').length,0);
  assert.ok(events.some(e=>e.type==='playback/error'&&e.message.includes('إطار فيديو')));
});

test('انقطاع upstream أثناء الفيديو ينهي النقل دون إسقاط عملية Node',async t=>{
  const {default:https}=await import('node:https'),{default:http}=await import('node:http'),{default:dns}=await import('node:dns/promises');
  const source=http.createServer((_req,res)=>{res.writeHead(200,{'content-type':'video/mp4','content-length':'10000'});res.write('owned partial fixture');setTimeout(()=>res.destroy(),25);});
  await new Promise(r=>source.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>source.close(r)));
  t.mock.method(dns,'lookup',async()=>[{address:'93.184.216.34',family:4}]);
  t.mock.method(https,'request',(url,options,cb)=>http.request(`http://127.0.0.1:${source.address().port}${url.pathname}`,{...options,lookup:undefined},cb));
  const {services,dir}=await fixture(t);await services.startPlayback({session:'broken-stream',candidate:{url:'https://example.com/owned.mp4'}});
  const commands=(await readFile(join(dir,'commands'),'utf8')).trim().split('\n').map(JSON.parse),url=commands.find(m=>m.command[0]==='loadfile').command[1];
  const response=await fetch(url,{signal:AbortSignal.timeout(500)});await assert.rejects(response.text(),/terminated/i);
  await services.playbackCommand({session:'broken-stream',command:'pause',value:true});
});

test('سياسة التخزين ترفض أكبر من 2GiB وحجمًا مجهولًا ومساحة بلا احتياط 64MiB',()=>{
  const cap=2*1024**3,overhead=64*1024**2;
  assert.equal(validateTorrentStorage({length:cap},BigInt(cap+overhead)),cap);
  assert.throws(()=>validateTorrentStorage({length:cap+1},BigInt(9*cap)),/أكبر من 2 غيغابايت.*أصغر/);
  for(const length of [undefined,null,'200',0,-1,Infinity,Number.MAX_SAFE_INTEGER+1])assert.throws(()=>validateTorrentStorage({length},BigInt(9*cap)),/حجم.*غير/);
  assert.throws(()=>validateTorrentStorage({length:100},BigInt(100+overhead-1)),/المساحة لا تكفي/);
  assert.equal(validateTorrentStorage({length:100},BigInt(100+overhead)),100);
});
test('رفض الحجم الكبير أو المجهول قبل أي POST تنزيل أو تشغيل mpv',async t=>{
  for(const [mode,message] of [['oversize',/أكبر من 2 غيغابايت/],['unknown',/حجم.*غير/]]){
    const {services,events,dir}=await fixture(t,mode);
    await assert.rejects(services.startPlayback({session:mode,candidate:{infoHash:hash,fileIdx:0}}),message);
    const requests=(await readFile(join(dir,'requests'),'utf8')).trim().split('\n').map(JSON.parse);
    assert.ok(requests.some(r=>r.url.includes('list_only=true')));
    assert.ok(!requests.some(r=>r.url.includes('only_files=')));
    await assert.rejects(readFile(join(dir,'mpv-log')),{code:'ENOENT'});
    assert.ok(!events.some(e=>e.type==='playback/ready'));
  }
});
test('statfs مساحة منخفضة يمنع POST تنزيل ويعرض الخطأ المحدد',async t=>{
  const {default:fs}=await import('node:fs/promises');
  t.mock.method(fs,'statfs',async()=>({bavail:1n,bsize:4096n}));
  const {services,events,dir}=await fixture(t);
  await assert.rejects(services.startPlayback({session:'no-space',candidate:{infoHash:hash,fileIdx:0}}),/المساحة لا تكفي/);
  const requests=(await readFile(join(dir,'requests'),'utf8')).trim().split('\n').map(JSON.parse);
  assert.ok(!requests.some(r=>r.url.includes('only_files=')));
  assert.ok(events.some(e=>e.type==='playback/error'&&e.message.includes('المساحة لا تكفي')));
});

test('تهيئة العميل تنظف cache المتروك قبل تشغيل جديد ولا تمس بيانات المستخدم الأخرى',async t=>{
  const {dir,services:unused,binaries}=await fixture(t);await unused.close();
  const {mkdir,readdir}=await import('node:fs/promises');
  const stale=join(dir,'torrent-cache','a'.repeat(48));await mkdir(stale,{recursive:true});await writeFile(join(stale,'partial.mp4'),'owned stale fixture');
  await writeFile(join(dir,'user-preferences.json'),'keep');
  const services=createDesktopServices({userData:dir,binaries});t.after(()=>services.close());
  await services.startPlayback({session:'after-crash',candidate:{infoHash:hash,fileIdx:0}});
  const entries=await readdir(join(dir,'torrent-cache'));assert.equal(entries.length,1);assert.notEqual(entries[0],'a'.repeat(48));
  assert.equal(await readFile(join(dir,'user-preferences.json'),'utf8'),'keep');
});
