import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import dns from 'node:dns/promises';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs, { mkdir, rm } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { tmpdir } from 'node:os';

const secret = () => randomBytes(24).toString('hex');
export function validateResourceRequest({url,method='GET',body=null,headers={},binary=false,follow=true}={}) {
  const checked=publicURL(url);
  if(!['GET','POST'].includes(method)||body!=null&&(typeof body!=='string'||Buffer.byteLength(body)>65536)||method==='GET'&&body!=null)throw new Error('طلب المصدر غير صالح');
  const out=checkedHeaders(headers);
  const allowed=new Set(['accept','accept-language','content-type','referer','user-agent','x-requested-with','x-csrf-token']);
  for(const key of Object.keys(out))if(!allowed.has(key.toLowerCase()))throw new Error('ترويسة المصدر غير مسموحة');
  return {url:checked.href,method,body,headers:out,binary:binary===true,follow:follow!==false};
}
const cancelled = () => new Error('ألغيت جلسة التشغيل');
const plain = v => v && typeof v === 'object' && !Array.isArray(v);
const sleep = (ms, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) return reject(cancelled());
  const timer = setTimeout(done, ms);
  function done() { signal?.removeEventListener('abort', abort); resolve(); }
  function abort() { clearTimeout(timer); reject(cancelled()); }
  signal?.addEventListener('abort', abort, { once: true });
});
function publicAddress(address) {
  const family = net.isIP(address);
  if (family === 4) {
    const [a,b] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || a === 169 && b === 254 ||
      a === 172 && b >= 16 && b <= 31 || a === 192 && (b === 168 || b === 0) ||
      a === 100 && b >= 64 && b <= 127 || a === 198 && (b === 18 || b === 19));
  }
  // IPv6 global unicast only. This excludes mapped IPv4, ULA, link-local,
  // multicast, unspecified, loopback and transition prefixes.
  if (family === 6) {
    const s = address.toLowerCase();
    return /^[23][a-f0-9]{3}:/.test(s) && !/^2001:(?:0:|db8:|10:|20:)/.test(s) && !/^2002:/.test(s);
  }
  return false;
}
function publicURL(input) {
  let url;
  try { if (typeof input !== 'string' || input.length > 16000 || /[\x00-\x20\x7f]/.test(input)) throw 0; url = new URL(input); } catch { throw new Error('رابط HTTPS غير صالح'); }
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (url.protocol !== 'https:' || url.username || url.password || url.port && url.port !== '443' ||
    host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || !host.includes('.') && !net.isIP(host) ||
    net.isIP(host) && !publicAddress(host)) throw new Error('رابط غير مسموح أو هدف داخلي');
  return url;
}
export async function resolvePublicURL(input, lookup = host => dns.lookup(host, { all: true, verbatim: true })) {
  const url = publicURL(input), host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = net.isIP(host) ? [{address:host,family:net.isIP(host)}] : await lookup(host);
  if (!addresses.length || addresses.some(x => !publicAddress(x.address))) throw new Error('رابط يشير إلى هدف داخلي');
  return { url, ...(addresses.find(address=>address.family===4)??addresses[0]) };
}
function checkedHeaders(value = {}) {
  if (!plain(value) || Object.keys(value).length > 32) throw new Error('رؤوس الفيديو غير صالحة');
  const result = {};
  for (const [key,val] of Object.entries(value)) {
    if (!/^[!#$%&'*+.^_`|~0-9a-z-]{1,80}$/i.test(key) || typeof val !== 'string' || val.length > 8192 ||
      /[\x00-\x1f\x7f]/.test(val) || /^(host|connection|content-length|transfer-encoding|proxy-authorization|proxy-connection|accept-encoding|range)$/i.test(key)) throw new Error('رؤوس الفيديو غير صالحة');
    result[key] = val;
  }
  return result;
}
export function validateCandidate(candidate) {
  if (!plain(candidate)) throw new Error('بيانات التشغيل غير صالحة');
  const headers = checkedHeaders(candidate.headers ?? {});
  if (candidate.infoHash != null || candidate.magnet != null) {
    const hash = String(candidate.infoHash ?? '').toLowerCase();
    if (!/^[a-f0-9]{40}$/.test(hash) || candidate.fileIdx != null && (!Number.isSafeInteger(candidate.fileIdx) || candidate.fileIdx < 0)) throw new Error('hash أو fileIdx غير صالح');
    let magnet = candidate.magnet;
    if (magnet != null) {
      let parsed;
      try { parsed = new URL(magnet); } catch { throw new Error('magnet غير صالح'); }
      if (typeof magnet !== 'string' || magnet.length > 16000 || /[\x00-\x1f\x7f]/.test(magnet) || parsed.protocol !== 'magnet:' ||
        parsed.searchParams.getAll('xt').some(x => x.toLowerCase() !== `urn:btih:${hash}`) || !parsed.searchParams.has('xt') ||
        [...parsed.searchParams.keys()].some(x => !['xt','tr','dn'].includes(x))) throw new Error('magnet غير صالح أو يخالف hash');
      // Preserve trackers and display name, never permit xs/as URLs that could
      // make the engine fetch unsolicited resources.
      for (const tracker of parsed.searchParams.getAll('tr')) validateTracker(tracker);
    } else magnet = `magnet:?xt=urn:btih:${hash}`;
    const uri = new URL(magnet);
    for (const source of candidate.sources ?? []) {
      if (typeof source !== 'string' || source.length > 2000) throw new Error('مصدر تورنت غير صالح');
      if (source.startsWith('tracker:')) { const tr = source.slice(8); validateTracker(tr); if (!uri.searchParams.getAll('tr').includes(tr)) uri.searchParams.append('tr',tr); }
      else if (!/^dht:[a-f0-9]{40}$/i.test(source)) throw new Error('مصدر تورنت غير صالح');
    }
    return {...candidate,infoHash:hash,magnet:uri.href,headers};
  }
  const url = publicURL(candidate.url).href;
  if (candidate.type === 'dash' || /\.mpd(?:\?|$)/i.test(url)) throw new Error('DASH غير مدعوم في النسخة التجريبية؛ اختر رابط فيديو أو HLS');
  return {...candidate,url,headers};
}
function validateTracker(input) {
  let u; try { u = new URL(input); } catch { throw new Error('tracker غير صالح'); }
  const host=u.hostname.replace(/^\[|\]$/g,'');
  if (!['https:','http:','udp:'].includes(u.protocol) || u.username || u.password || input.length > 2000 || /[\x00-\x20\x7f]/.test(input) ||
    !host.includes('.') && !net.isIP(host) || host.endsWith('.local') || host.endsWith('.localhost') || net.isIP(host) && !publicAddress(host)) throw new Error('tracker غير صالح');
}
export function selectTorrentFile(files, candidate) {
  if (!Array.isArray(files) || !files.length) throw new Error('لم يعثر المحرك على ملفات التورنت');
  if (candidate.fileIdx != null) {
    if (!Number.isSafeInteger(candidate.fileIdx) || candidate.fileIdx < 0 || candidate.fileIdx >= files.length) throw new Error('fileIdx غير موجود في التورنت');
    return candidate.fileIdx;
  }
  if (candidate.filename) {
    const matches = files.map((f,i) => [f,i]).filter(([f]) => f.name === candidate.filename || basename(f.name.replaceAll('\\','/')) === candidate.filename);
    if (matches.length === 1) return matches[0][1];
  }
  if (files.length === 1) return 0;
  // ملفات subtitles / nfo / screenshots ليست حلقات. اختر تلقائيًا فقط
  // حين يوجد فيديو واحد لا لبس فيه؛ وجود حلقتين يظل يحتاج fileIdx صريحًا.
  const videos = files.map((file,index) => ({file,index})).filter(({file}) =>
    Number.isSafeInteger(file?.length) && file.length > 0 &&
    /\.(?:mkv|mp4|m4v|webm|avi|mov|wmv|mpeg|mpg)$/i.test(String(file.name ?? '')));
  const nonSamples = videos.filter(({file}) => !/(?:^|[/\\])sample(?:s)?(?:[/\\]|[ ._(-])/i.test(String(file.name)));
  const unambiguous = nonSamples.length === 1 ? nonSamples : videos.length === 1 ? videos : [];
  if (unambiguous.length === 1) return unambiguous[0].index;
  throw new Error(`يلزم اختيار ملف محدد: ${files.slice(0,100).map((f,i)=>`${i}: ${String(f.name).slice(0,160)}`).join(' | ')}`);
}
function bounded(value, fallback, low, high) {
  if (value == null) return fallback;
  if (!Number.isSafeInteger(value) || value < low || value > high) throw new Error('حد الطلب غير صالح');
  return value;
}
function readResponse(response, limit) {
  return new Promise((resolve,reject) => {
    const chunks=[];let size=0;
    response.on('data', chunk => { size+=chunk.length; if (size > limit) { reject(new Error('حجم الاستجابة أكبر من الحد')); response.destroy(); } else chunks.push(chunk); });
    response.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    response.on('error',reject);
    response.on('aborted',()=>reject(new Error('انقطع نقل الاستجابة')));
  });
}
async function secureResponse(url, {headers={},signal,timeout=15000,method='GET',body=null}={}) {
  if (signal?.aborted) throw cancelled();
  const pinned = await new Promise((resolve,reject) => {
    const abort = () => reject(cancelled());
    signal?.addEventListener('abort',abort,{once:true});
    resolvePublicURL(url).then(resolve,reject).finally(() => signal?.removeEventListener('abort',abort));
  });
  if (signal?.aborted) throw cancelled();
  return new Promise((resolve,reject) => {
    // Pin the validated DNS answer for this connection to prevent rebinding.
    const request=https.request(pinned.url,{method,headers,signal,agent:false,
      lookup:(_host, options, cb) => options?.all ? cb(null,[{address:pinned.address,family:pinned.family}]) : cb(null,pinned.address,pinned.family)},resolve);
    request.setTimeout(timeout,()=>request.destroy(new Error('انتهت مهلة HTTPS')));
    request.on('error',reject); request.end(body);
  });
}
async function localJSON(base,path,{body,signal,timeout=15000,auth}={}) {
  return new Promise((resolve,reject) => {
    const req=http.request(new URL(path,base),{method:body==null?'GET':'POST',signal,headers:{Authorization:`Basic ${Buffer.from(auth).toString('base64')}`,'content-type':'text/plain','x-req-timeout-ms':String(timeout)}}, async res => {
      try { const text=await readResponse(res,4*1024*1024); if (res.statusCode>=400) {const error=new Error('رفض محرك التورنت الطلب');error.status=res.statusCode;throw error;}resolve(JSON.parse(text)); } catch(e) {reject(e);} });
    req.setTimeout(timeout,()=>req.destroy(new Error('انتهت مهلة بيانات التورنت')));req.on('error',reject);req.end(body);
  });
}
// list_only لا يبدأ تنزيل الفيلم: إعادة محاولة قصيرة ومحدودة تمنع
// سقوط الجلسة بسبب 502/503 أو reset مؤقت أثناء جلب بيانات المغناطيس.
export function retryableMetadataFailure(error) {
  const code=String(error?.code ?? '');
  const status=Number(error?.status);
  // 400/401/403/404 are deterministic failures: never repeat bad requests.
  if (Number.isFinite(status) && status >= 400) return status === 408 || status === 429 || status >= 500;
  return ['ECONNRESET','ECONNREFUSED','EPIPE','ETIMEDOUT','EAI_AGAIN'].includes(code) ||
    /انقطع نقل|مهلة بيانات التورنت/.test(String(error?.message ?? ''));
}
async function getTorrentMetadata(request, sleepFor, isCurrent) {
  let last;
  for(let attempt=0;attempt<3;attempt++) {
    isCurrent();
    try {return await request();} catch(error) {
      last=error;
      if(attempt===2 || !retryableMetadataFailure(error)) throw error;
      await sleepFor((attempt+1)*600);
    }
  }
  throw last;
}

async function port() {
  const server=net.createServer();await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const result=server.address().port;await new Promise(resolve=>server.close(resolve));return result;
}
function cleanEnv() {
  const env={...process.env};
  for (const key of Object.keys(env)) if (key.startsWith('RQBIT_') || ['RUST_LOG','LISTEN_FDS','LISTEN_PID','HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','http_proxy','https_proxy','all_proxy'].includes(key)) delete env[key];
  return env;
}
function child(state, executable, args, env, fail) {
  const processChild=spawn(executable,args,{env,stdio:'ignore',windowsHide:true,shell:false});state.children.add(processChild);
  processChild.once('error',()=>fail('تعذر تشغيل البرنامج المرفق'));
  processChild.once('exit',(code,signal)=>{state.children.delete(processChild); if (!state.stopped) fail('أغلق البرنامج المرفق',code,signal);});
  return processChild;
}
async function kill(processChild) {
  if (processChild.exitCode != null || processChild.signalCode != null) return;
  await new Promise(resolve => {
    let done=false;
    const finish=()=>{if(done)return;done=true;clearTimeout(timer);clearTimeout(deadline);resolve();};
    processChild.once('exit',finish);processChild.once('error',finish);
    const timer=setTimeout(()=>processChild.kill('SIGKILL'),1500);
    const deadline=setTimeout(finish,3000);
    processChild.kill();
  });
}
async function connectIPC(state, path) {
  const deadline=Date.now()+15000;
  while (!state.stopped && Date.now()<deadline) {
    try {
      const socket=await new Promise((resolve,reject)=>{const socket=net.createConnection(path);socket.once('connect',()=>{socket.removeListener('error',reject);resolve(socket);});socket.once('error',reject);});
      if (state.stopped) { socket.destroy();throw cancelled(); } return socket;
    } catch { await sleep(40,state.controller.signal); }
  }
  throw new Error('لم يتصل المشغل بقناة التحكم');
}

export function createDesktopServices({userData,binaries,onEvent=()=>{},platform=process.platform,firstFrameRecoveryMs=45000,firstFrameFailureMs=60000}) {
  if (typeof userData!=='string'||!binaries?.rqbit||!binaries?.mpv) throw new Error('إعداد البرامج المرفقة غير صالح');
  let current=null,closed=false;
  const states=new Set(), resourceControllers=new Set();
  // Electron owns the single-instance lock before constructing services.
  // This directory contains only disposable session downloads.
  const startup=Promise.all(['torrent-cache','subtitle-cache'].map(name=>rm(join(userData,name),{recursive:true,force:true})))
    .then(()=>null,()=>new Error('تعذر تنظيف ملفات التورنت المتروكة؛ أغلق المحركات القديمة ثم حاول مجددًا'));
  const publish = event => { try { onEvent(event); } catch {} };
  function emit(state,event) { if (!state.stopped && current===state) publish({...event,session:state.session}); }
  function playbackState(state) {
    return {position:state.progress.position??0,duration:state.progress.duration??0,paused:state.mediaPaused===true,buffering:state.mediaBuffering===true};
  }
  function emitPlaybackState(state) {if(state.ready)emit(state,{type:'playback/state',...playbackState(state)});}
  function assertSession(state) { if (state.stopped||current!==state||closed) throw cancelled(); }
  async function cleanup(state) {
    if (state.cleanup) return state.cleanup;
    state.stopped=true;state.resolveReady?.(false);state.controller.abort();clearInterval(state.statsTimer);clearTimeout(state.firstFrameWatchdog);
    for(const pending of state.pending.values()) {clearTimeout(pending.timer);pending.reject(cancelled());}state.pending.clear();
    state.socket?.destroy();
    state.cleanup=(async()=>{
      if(state.proxy){state.proxy.closeAllConnections();await new Promise(resolve=>state.proxy.close(resolve));}
      await Promise.all([...state.children].map(kill));
      if(state.ipc&&platform!=='win32')await rm(state.ipc,{force:true}).catch(()=>{});
      if(state.cacheDir)await rm(state.cacheDir,{recursive:true,force:true}).catch(()=>{});
      await state.subtitleQueue;
      if(state.subtitleDir)await rm(state.subtitleDir,{recursive:true,force:true}).catch(()=>{});
      states.delete(state);
    })();
    return state.cleanup;
  }
  async function fail(state,message) {
    if(state.stopped||current!==state)return;
    state.failure=message;emit(state,{type:'playback/error',message});await cleanup(state);if(current===state)current=null;
  }
  async function requestResource({url,json=false,limit,timeout,...options}={}) {
    if(closed)throw new Error('أغلقت الخدمات');
    limit=bounded(limit,4*1024*1024,1,8*1024*1024);timeout=bounded(timeout,15000,100,60000);
    const controller=new AbortController();resourceControllers.add(controller);const timer=setTimeout(()=>controller.abort(),timeout);
    try {
      let request=validateResourceRequest({url,...options});
      request.headers={accept:json?'application/json':'*/*','user-agent':'Mozilla/5.0 VANTARA/Windows',...request.headers};
      for(let redirects=0;redirects<6;redirects++) {
        const response=await secureResponse(request.url,{headers:request.headers,method:request.method,body:request.body,signal:controller.signal,timeout});
        const status=response.statusCode;
        if(status>=300&&status<400&&response.headers.location&&request.follow) {
          response.destroy();
          const next=publicURL(new URL(response.headers.location,request.url).href);
          if(next.origin!==new URL(request.url).origin) {
            if([307,308].includes(status)&&request.body)throw new Error('توجيه بيانات المصدر لمضيف آخر غير مسموح');
            request.headers={accept:request.headers.accept,'user-agent':request.headers['user-agent']};
          }
          if(status===303||[301,302].includes(status)&&request.method==='POST'){request.method='GET';request.body=null;delete request.headers['content-type'];}
          request.url=next.href;continue;
        }
        const headers=Object.fromEntries(['content-type','x-videa-xs','location'].filter(k=>typeof response.headers[k]==='string').map(k=>[k,response.headers[k]]));
        if(request.binary) {
          const chunks=[];let size=0;
          for await(const chunk of response){size+=chunk.length;if(size>limit){response.destroy();throw new Error('حجم الصورة أكبر من الحد');}chunks.push(chunk);}
          const type=String(headers['content-type']??'').split(';')[0];
          if(!/^image\/(png|jpeg|webp|gif|avif)$/.test(type))throw new Error('المورد ليس صورة مدعومة');
          return {base64:Buffer.concat(chunks).toString('base64'),contentType:type,status,url:request.url,headers};
        }
        return {text:await readResponse(response,limit),status,url:request.url,headers,location:response.headers.location??null};
      }
      throw new Error('عدد إعادة التوجيه أكبر من الحد');
    } catch(e) {if(e.message?.includes('رابط')||e.message?.includes('حد')||e.message?.includes('حجم')||e.message?.includes('توجيه'))throw e;throw new Error('تعذر جلب مورد HTTPS أو انتهت المهلة');}
    finally{clearTimeout(timer);resourceControllers.delete(controller);}
  }
  async function makeProxy(state, target, headers={}, torrent=false) {
    const token=secret(),origin=target?new URL(target).origin:null;
    const mapping=new Map();let counter=0;
    function mapped(url) { const id=String(counter++);mapping.set(id,url);return `http://127.0.0.1:${state.proxy.address().port}/${token}/${id}`; }
    const server=http.createServer(async(req,res)=>{
      if(state.stopped||!['GET','HEAD'].includes(req.method)) {res.writeHead(403);return res.end();}
      const match=new RegExp(`^/${token}/(\\d+)$`).exec(req.url);
      if(!match||!mapping.has(match[1])){res.writeHead(404);return res.end();}
      let url=mapping.get(match[1]), upstream;
      const abort=new AbortController();req.once('close',()=>{if(!req.complete)abort.abort();});res.once('close',()=>abort.abort());
      const parentAbort=()=>abort.abort();state.controller.signal.addEventListener('abort',parentAbort,{once:true});
      try {
        let requestHeaders={};
        if(req.headers.range&&/^bytes=\d*-\d*(?:,\d*-\d*)*$/.test(req.headers.range))requestHeaders.Range=req.headers.range;
        if(torrent){
          requestHeaders.Authorization=`Basic ${Buffer.from(state.auth).toString('base64')}`;
          upstream=await new Promise((resolve,reject)=>{const r=http.get(url,{headers:requestHeaders,signal:abort.signal},resolve);r.on('error',reject);r.setTimeout(120000,()=>r.destroy(new Error('مهلة الفيديو')));});
        } else {
          for(let redirects=0;;redirects++){
            const u=new URL(url);requestHeaders={...(u.origin===origin?headers:{}),...requestHeaders,'Accept-Encoding':'identity'};
            // Rebuild each hop: origin-scoped credentials must never persist.
            if(u.origin!==origin)requestHeaders={...(req.headers.range?{Range:req.headers.range}:{}),'Accept-Encoding':'identity'};
            upstream=await secureResponse(url,{headers:requestHeaders,signal:abort.signal,timeout:60000});
            if(upstream.statusCode<300||upstream.statusCode>=400)break;
            if(redirects>=4||!upstream.headers.location){upstream.destroy();throw new Error('إعادة توجيه غير صالحة');}
            const next=new URL(upstream.headers.location,url);upstream.destroy();publicURL(next.href);url=next.href;
          }
        }
        const contentType=String(upstream.headers['content-type']??'application/octet-stream');
        const playlist=!torrent && (/mpegurl/i.test(contentType)||/\.m3u8(?:\?|$)/i.test(url));
        if(playlist){
          const text=await readResponse(upstream,2*1024*1024);
          const remap=value=>mapped(publicURL(new URL(value,url).href).href);
          const rewritten=text.split(/\r?\n/).map(line=>line.startsWith('#')?line.replace(/URI="([^"]+)"/g,(_all,value)=>`URI="${remap(value)}"`):line.trim()?remap(line.trim()):line).join('\n');
          res.writeHead(upstream.statusCode,{'content-type':contentType,'cache-control':'no-store'});res.end(req.method==='HEAD'?undefined:rewritten);
        } else {
          if(!torrent&&/dash\+xml/i.test(contentType))throw new Error('DASH غير مدعوم');
          const responseHeaders={'content-type':contentType,'cache-control':'no-store'};
          for(const key of ['content-length','content-range','accept-ranges'])if(upstream.headers[key])responseHeaders[key]=upstream.headers[key];
          res.writeHead(upstream.statusCode,responseHeaders);
          if(req.method==='HEAD'){upstream.destroy();res.end();}else { upstream.once('error',()=>res.destroy());upstream.once('aborted',()=>res.destroy());upstream.pipe(res); }
        }
      }catch{upstream?.destroy();if(!res.headersSent)res.writeHead(502);res.end();}
      finally{state.controller.signal.removeEventListener('abort',parentAbort);}
    });
    state.proxy=server;
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
    assertSession(state);return mapped(target);
  }
  async function engine(state,candidate) {
    const apiPort=await port();assertSession(state);
    const dir=join(userData,'torrent-cache',secret());state.cacheDir=dir;await mkdir(dir,{recursive:true});assertSession(state);
    state.auth=`vantara:${secret()}`;state.api=`http://127.0.0.1:${apiPort}`;
    const env=cleanEnv();env.RQBIT_HTTP_BASIC_AUTH_USERPASS=state.auth;
    const args=['-v','error','--http-api-listen-addr',`127.0.0.1:${apiPort}`,'--disable-upnp-port-forward','--disable-lsd','--disable-dht-persistence','--listen-port','0','server','start',dir,'--disable-persistence'];
    child(state,binaries.rqbit,args,env,message=>fail(state,message));
    const options={auth:state.auth,signal:state.controller.signal};
    const deadline=Date.now()+15000;
    for(;;){assertSession(state);try{await localJSON(state.api,'/',{...options,timeout:1000});break;}catch(e){if(Date.now()>deadline)throw new Error('لم يبدأ محرك التورنت');await sleep(50,state.controller.signal);}}

    const metadata=await getTorrentMetadata(
      ()=>localJSON(state.api,'/torrents?list_only=true',{...options,body:candidate.magnet,timeout:45000}),
      ms=>sleep(ms,state.controller.signal),()=>assertSession(state));assertSession(state);
    if(metadata.details?.info_hash?.toLowerCase()!==candidate.infoHash)throw new Error('هوية التورنت لا تطابق النتيجة');
    const index=selectTorrentFile(metadata.details.files,candidate);
    let storage;
    try { storage=await fs.statfs(userData,{bigint:true}); }
    catch { throw new Error('تعذر التحقق من المساحة المتاحة لملف التورنت؛ اختر مصدرًا آخر'); }
    assertSession(state);
    validateTorrentStorage(metadata.details.files[index],storage.bavail*storage.bsize);
    // التحقق من المساحة والهوية يسبق بدء التنزيل. هذه أول عملية ذات أثر جانبي
    // ولا نكررها تلقائيًا كي لا يُضاف التورنت مرتين بعد فقدان الرد.
    const added=await localJSON(state.api,`/torrents?only_files=${index}`,{...options,body:candidate.magnet,timeout:120000});assertSession(state);
    if(!Number.isSafeInteger(added.id)||added.id<0)throw new Error('لم يسجل المحرك ملف التورنت');
    state.torrentId=added.id;
    state.statsTimer=setInterval(async()=>{
      if(state.statsPending||state.stopped)return;state.statsPending=true;
      try{const stats=await localJSON(state.api,`/torrents/${added.id}/stats/v1`,{...options,timeout:2000});const speed=stats.live?.download_speed?.mbps,peers=stats.live?.snapshot?.peer_stats?.live;
        emit(state,{type:'playback/progress',...state.progress,...(Number.isFinite(speed)?{downloadSpeed:speed*1024*1024}:{}),...(Number.isFinite(peers)?{peers}:{} )});
      }catch{}finally{state.statsPending=false;}
    },1000);
    return makeProxy(state,`${state.api}/torrents/${added.id}/stream/${index}`,{},true);
  }
  function ipcCommand(state,command) {
    assertSession(state);
    if(!state.socket||state.socket.destroyed) return Promise.reject(new Error('المشغل غير متصل'));
    const request_id=++state.requestId;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{state.pending.delete(request_id);reject(new Error('انتهت مهلة أمر المشغل'));},5000);
      state.pending.set(request_id,{resolve,reject,timer});
      state.socket.write(JSON.stringify({command,request_id})+'\n',error=>{if(error){clearTimeout(timer);state.pending.delete(request_id);reject(new Error('تعذر إرسال أمر المشغل'));}});
    });
  }
  async function player(state,url,title,position,pause) {
    state.ipc=platform==='win32'?`\\\\.\\pipe\\vantara-${secret()}`:join(tmpdir(),`vantara-${secret()}.sock`);
    const args=['--no-config','--idle=yes','--terminal=no','--force-window=yes','--keep-open=no','--cache=yes','--cache-pause-initial=yes','--cache-pause-wait=3','--cache-secs=15','--input-default-bindings=yes','--sub-auto=no','--slang=ar,ara,arabic,en,eng',`--input-ipc-server=${state.ipc}`,`--title=${String(title??'VANTARA').replace(/[\x00-\x1f\x7f]/g,' ').slice(0,300)}`,`--start=${position/1000}`,`--pause=${pause?'yes':'no'}`];
    child(state,binaries.mpv,args,cleanEnv(),(message,code)=>{if(message==='أغلق البرنامج المرفق'&&code===0&&state.ready){emit(state,{type:'playback/closed',...state.progress});cleanup(state).then(()=>{if(current===state)current=null;});}else fail(state,message);});
    state.socket=await connectIPC(state,state.ipc);assertSession(state);
    let buffer='';
    state.socket.on('error',()=>fail(state,'انقطعت قناة التحكم بالمشغل'));
    state.socket.on('close',()=>{if(!state.stopped)fail(state,'انقطعت قناة التحكم بالمشغل');});
    const ready=()=>{if(state.ready)return;state.ready=true;clearTimeout(state.firstFrameWatchdog);state.publishedSeekRevision=state.seekRevision;state.resolveReady(true);emit(state,{type:'playback/ready',...state.progress});emitPlaybackState(state);};
    state.socket.on('data',data=>{
      buffer+=data.toString('utf8');if(buffer.length>1024*1024){state.socket.destroy();return;}
      while(buffer.includes('\n')){
        const end=buffer.indexOf('\n'),line=buffer.slice(0,end);buffer=buffer.slice(end+1);let event;try{event=JSON.parse(line);}catch{continue;}
        if(event.request_id!=null){const pending=state.pending.get(event.request_id);if(pending){state.pending.delete(event.request_id);clearTimeout(pending.timer);event.error==='success'?pending.resolve(event.data):pending.reject(new Error('رفض المشغل الأمر'));}}
        if(event.event==='seek')state.seekRevision=(state.seekRevision??0)+1;
        if(event.event==='playback-restart'&&state.ready&&state.seekRevision!==state.publishedSeekRevision) {
          const revision=state.seekRevision;state.publishedSeekRevision=revision;
          ipcCommand(state,['get_property','time-pos']).then(seconds=>{
            if(Number.isFinite(seconds)&&seconds>=0&&state.seekRevision===revision)emit(state,{type:'playback/seek',position:Math.round(seconds*1000)});
          }).catch(()=>{});
        }
        if(event.event==='playback-restart'&&!state.ready) {
          state.restarted=true;
          ipcCommand(state,['get_property','video-out-params']).then(params=>{
            if(state.stopped)return;
            if(Number.isFinite(params?.w)&&params.w>0&&Number.isFinite(params?.h)&&params.h>0)ready();
            else fail(state,'المصدر لا يوفر إطار فيديو قابلًا للتشغيل؛ قد يكون صوتًا فقط');
          }).catch(()=>{if(!state.stopped)fail(state,'تعذر التحقق من إطار الفيديو في المشغل');});
        }
        if(event.event==='end-file'&&event.reason==='eof') {
          emit(state,{type:'playback/closed',...state.progress});cleanup(state).then(()=>{if(current===state)current=null;});
        }
        if(event.event==='end-file'&&event.reason==='error')fail(state,'تعذر فتح الفيديو في المشغل');
        if(event.event==='property-change'){
          if(event.name==='track-list'&&Array.isArray(event.data)) {
            state.subtitleTracks=event.data.filter(t=>t.type==='sub'&&Number.isSafeInteger(t.id)&&t.id>=0).slice(0,200)
              .map(t=>({id:t.id,lang:subtitleLanguage(t.lang),label:subtitleLabel(t.title??t.lang??'ترجمة'),selected:t.selected===true}));
            const selected=state.subtitleTracks.find(t=>t.selected),selectedId=selected?.id??null;
            const expected=state.subtitleExpectedSelection;
            if(expected&&selected?.lang===expected.lang&&selected?.label===expected.label)state.subtitleExpectedSelection=null;
            else if(!expected&&state.lastSubtitleSelection!=null&&state.lastSubtitleSelection!==selectedId)state.subtitleManual=true;
            state.lastSubtitleSelection=selectedId;
            emit(state,{type:'playback/subtitles',tracks:state.subtitleTracks});
          }
          if(['time-pos','duration'].includes(event.name)&&Number.isFinite(event.data)&&event.data>=0){state.progress[event.name==='time-pos'?'position':'duration']=Math.round(event.data*1000);emit(state,{type:'playback/progress',...state.progress,paused:state.mediaPaused===true,buffering:state.mediaBuffering===true});emitPlaybackState(state);}
          if(event.name==='pause'&&typeof event.data==='boolean'){state.mediaPaused=event.data;if(state.ready)emit(state,{type:'playback/pause',paused:event.data});emitPlaybackState(state);}
          if(event.name==='paused-for-cache'&&typeof event.data==='boolean'){state.mediaBuffering=event.data;emitPlaybackState(state);}

        }
      }
    });
    await Promise.all(['time-pos','duration','video-out-params','track-list','pause','paused-for-cache'].map((name,i)=>ipcCommand(state,['observe_property',i+1,name])));assertSession(state);
    await ipcCommand(state,['loadfile',url]);assertSession(state);
    // تمنع بقاء شاشة سوداء إلى الأبد عندما لا يُنتج المصدر إطارًا.
    // أعد فتح رابط الـproxy الداخلي *مرة واحدة*؛ يحتفظ rqbit بنفس الجلسة
    // والأجزاء التي وصلت، فلا يُعاد حل المغناطيس أو الاختيار أو الإعدادات.
    if(!state.ready) {
      state.firstFrameWatchdog=setTimeout(()=>{
        if(state.stopped||current!==state||state.ready)return;
        emit(state,{type:'playback/retrying',message:'نعيد الاتصال بالفيديو مع إبقاء تنزيل التورنت نشطًا'});
        void ipcCommand(state,['loadfile',url,'replace']).catch(()=>{});
        state.firstFrameWatchdog=setTimeout(()=>{
          if(!state.stopped&&current===state&&!state.ready)
            void fail(state,'لم يصل إطار فيديو بعد إعادة المحاولة؛ يمكنك تجربة سيرفر آخر');
        },firstFrameFailureMs);
      },firstFrameRecoveryMs);
    }
  }
  async function startPlayback({session,candidate,title,position=0,pause=false}={}) {
    if(closed)throw new Error('أغلقت الخدمات');
    if(typeof session!=='string'||!session||session.length>200||!Number.isFinite(position)||position<0||typeof pause!=='boolean')throw new Error('جلسة أو موضع تشغيل غير صالح');
    candidate=validateCandidate(candidate);
    const old=current,state={session,controller:new AbortController(),children:new Set(),pending:new Map(),requestId:0,progress:{},stopped:false};
    state.subtitleTracks=[];state.subtitleFiles=new Map();state.subtitleJobs=new Map();state.subtitleQueue=Promise.resolve();
    state.whenReady=new Promise(resolve=>state.resolveReady=resolve);
    current=state;states.add(state);
    try{
      const startupError=await startup;if(startupError)throw startupError;assertSession(state);
      if(old){publish({type:'playback/closed',session:old.session,...old.progress});await cleanup(old);}assertSession(state);
      emit(state,{type:'playback/preparing'});
      const url=candidate.infoHash?await engine(state,candidate):await makeProxy(state,candidate.url,candidate.headers);
      assertSession(state);await player(state,url,title,position,pause);assertSession(state);
      const embedded=(Array.isArray(candidate.subtitles)?candidate.subtitles:[]).slice(0,100).sort((a,b)=>Number(subtitleLanguage(b?.lang)==='ar')-Number(subtitleLanguage(a?.lang)==='ar'));
      for(const subtitle of embedded)void loadSubtitle(state,subtitle).catch(()=>{});
      return {started:true};
    }catch(e){const wasCancelled=state.stopped||current!==state||closed;if(!wasCancelled)emit(state,{type:'playback/error',message:e.message?.match(/ملف|fileIdx|هوية|DASH|تورنت|المصدر|المساحة|حجم/)?e.message:'تعذر بدء تشغيل الفيديو'});await cleanup(state);if(current===state)current=null;if(state.failure)throw new Error(state.failure);if(wasCancelled)throw cancelled();throw new Error(e.message?.match(/ملف|fileIdx|هوية|DASH|تورنت|المصدر|المساحة|حجم/)?e.message:'تعذر بدء تشغيل الفيديو');}
  }
  async function stopPlayback({session}={}) {
    const state=current;if(!state||state.session!==session)return;
    publish({type:'playback/closed',session:state.session,...state.progress});await cleanup(state);if(current===state)current=null;
  }
  async function downloadSubtitle(state,value) {
    const controller=new AbortController(),abort=()=>controller.abort();
    state.controller.signal.addEventListener('abort',abort,{once:true});
    const timer=setTimeout(abort,15000);let response;
    try {
      let url=value.url;
      for(let redirects=0;;redirects++) {
        response=await secureResponse(url,{headers:{Accept:'text/plain,application/x-subrip,text/vtt,text/x-ssa'},signal:controller.signal,timeout:15000});
        if(response.statusCode<300||response.statusCode>=400)break;
        if(redirects>=4||typeof response.headers.location!=='string')throw new Error('توجيه الترجمة تجاوز الحد أو أعاد رابطًا غير صالح');
        try { url=publicURL(new URL(response.headers.location,url).href).href; }
        catch { throw new Error('توجيه الترجمة إلى عنوان غير مسموح'); }
        response.destroy();
      }
      if(response.statusCode<200||response.statusCode>=300)throw new Error('تعذر تنزيل الترجمة؛ استجابة غير ناجحة');
      const validated=validateSubtitleText(await readResponse(response,2*1024*1024));assertSession(state);
      const storage=await fs.statfs(userData,{bigint:true});assertSession(state);
      if(storage.bavail*storage.bsize<BigInt(Buffer.byteLength(validated.text))+8n*1024n**2n)throw new Error('المساحة لا تكفي لتنزيل الترجمة؛ حرر 8 ميغابايت على الأقل');
      if(!state.subtitleDir){state.subtitleDir=join(userData,'subtitle-cache',secret());await mkdir(state.subtitleDir,{recursive:true});assertSession(state);}
      const path=join(state.subtitleDir,`${secret()}.${validated.extension}`);
      await fs.writeFile(path,validated.text,{encoding:'utf8',flag:'wx',mode:0o600});assertSession(state);
      return path;
    } finally { clearTimeout(timer);state.controller.signal.removeEventListener('abort',abort);response?.destroy(); }
  }
  function loadSubtitle(state,value) {
    assertSession(state);
    if(!plain(value)||typeof value.url!=='string'||value.select!=null&&typeof value.select!=='boolean')return Promise.reject(new Error('طلب ترجمة غير صالح'));
    let url;try{url=publicURL(value.url).href;}catch{return Promise.reject(new Error('رابط ترجمة غير مسموح'));}
    if(state.subtitleJobs.has(url))return state.subtitleJobs.get(url);
    const subtitle={url,lang:subtitleLanguage(value.lang),label:subtitleLabel(value.label??value.lang??'ترجمة'),select:value.select};
    const job=state.subtitleQueue.then(async()=>{
      assertSession(state);
      const loaded=[...state.subtitleFiles.values()];
      if(loaded.length>=8||subtitle.lang!=='ar'&&loaded.filter(s=>s.lang!=='ar').length>=4)throw new Error('وصلت الترجمات إلى الحد؛ يمكن تحميل 8 مسارات منها 4 بغير العربية');
      const path=await downloadSubtitle(state,subtitle);
      try {
        if(!await state.whenReady)throw cancelled();assertSession(state);
        const selected=state.subtitleTracks.find(t=>t.selected);
        const automatic=!state.subtitleManual&&(!selected||subtitle.lang==='ar'&&selected.lang!=='ar');
        const select=subtitle.select===true||subtitle.select!==false&&automatic;
        if(select)state.subtitleExpectedSelection={lang:subtitle.lang,label:subtitle.label};
        await ipcCommand(state,['sub-add',path,select?'select':'auto',subtitle.label,subtitle.lang]);assertSession(state);
        state.subtitleFiles.set(url,{...subtitle,path});
        if(subtitle.select===true)state.subtitleManual=true;
      } catch(error){state.subtitleExpectedSelection=null;await rm(path,{force:true}).catch(()=>{});throw error;}
    }).catch(error=>{
      if(!state.stopped&&current===state)emit(state,{type:'playback/subtitles',tracks:state.subtitleTracks,message:error.message?.match(/ترجمة|ترجمات|المساحة|الحد/)?error.message:'تعذر تحميل الترجمة؛ يستمر الفيديو'});
      throw error;
    });
    state.subtitleJobs.set(url,job);state.subtitleQueue=job.catch(()=>{});
    return job;
  }
  async function playbackCommand({session,command,value}={}) {
    const state=current;if(!state||state.session!==session||state.stopped)throw new Error('جلسة تشغيل قديمة');
    if(command==='pause'&&typeof value==='boolean')await ipcCommand(state,['set_property','pause',value]);
    else if(command==='seek'&&Number.isFinite(value)&&value>=0)await ipcCommand(state,['seek',value/1000,'absolute']);
    else if(command==='rate'&&Number.isFinite(value)&&value>=0.95&&value<=1.05)await ipcCommand(state,['set_property','speed',value]);
    else if(command==='subtitle-load')await loadSubtitle(state,value);
    else if(command==='subtitle-off') {state.subtitleManual=true;await ipcCommand(state,['set_property','sid','no']);}
    else if(command==='subtitle-select'&&Number.isSafeInteger(value)&&state.subtitleTracks.some(t=>t.id===value)) {state.subtitleManual=true;await ipcCommand(state,['set_property','sid',value]);}
    else if(command==='subtitle-delay'&&Number.isFinite(value)&&Math.abs(value)<=60000)await ipcCommand(state,['set_property','sub-delay',value/1000]);
    else if(command==='subtitle-size'&&Number.isFinite(value)&&value>=20&&value<=80)await ipcCommand(state,['set_property','sub-font-size',value]);
    else throw new Error('أمر مشغل غير مسموح');
  }
  async function close(){closed=true;for(const c of resourceControllers)c.abort();await startup;await Promise.all([...states].map(cleanup));current=null;}
  return {requestResource,startPlayback,stopPlayback,playbackCommand,close};
}

export function validateTorrentStorage(file,availableBytes) {
  const length=file?.length;
  if(!Number.isSafeInteger(length)||length<=0)throw new Error('حجم ملف التورنت غير معروف أو غير صالح؛ اختر مصدرًا آخر');
  if(length>64*1024**3)throw new Error('هذا المصدر أكبر من 64 غيغابايت، وهو حد التخزين في النسخة التجريبية؛ اختر مصدرًا أصغر');
  if(typeof availableBytes!=='bigint'||availableBytes<0n)throw new Error('تعذر التحقق من المساحة المتاحة لملف التورنت');
  if(availableBytes<BigInt(length)+64n*1024n**2n)throw new Error('المساحة لا تكفي لملف التورنت واحتياط 64 ميغابايت؛ حرر مساحة أو اختر مصدرًا أصغر');
  return length;
}

function subtitleLanguage(value) {
  const text=typeof value==='string'?value.slice(0,40):'und';
  return /^(ar|ara|arabic)(?:-|$)/i.test(text)?'ar':/^(en|eng|english)(?:-|$)/i.test(text)?'en':/^[a-z]{2,3}(?:-[a-z0-9]{1,8})*$/i.test(text)?text:'und';
}
function subtitleLabel(value) {return String(value).replace(/[\x00-\x1f\x7f]/g,' ').slice(0,200);}
export function validateSubtitleText(text) {
  if(typeof text!=='string'||Buffer.byteLength(text)>2*1024*1024)throw new Error('ملف الترجمة أكبر من الحد 2 ميغابايت');
  text=text.replace(/^\uFEFF/,'');
  if(/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text)||/^(?:\s*<(?:!doctype|html|\?xml)|#EXTM3U|PK\x03\x04)/i.test(text)||text.includes('\uFFFD'))throw new Error('ملف الترجمة ليس نصًا UTF-8 صالحًا');
  const cues=text.match(/^\s*(?:\d{2}:)?\d{2}:\d{2}[.,]\d{3}\s*-->\s*(?:\d{2}:)?\d{2}:\d{2}[.,]\d{3}/gm)??[];
  if(cues.length>20000)throw new Error('عدد أسطر الترجمة أكبر من الحد');
  if(cues.length)return {text,extension:/^WEBVTT(?:\s|$)/.test(text)?'vtt':'srt'};
  if(/^\[Script Info\]/mi.test(text)&&/^\[Events\]/mi.test(text)&&/^Dialogue:/mi.test(text))return {text,extension:'ass'};
  throw new Error('لا توجد ترجمة SRT/VTT/ASS صالحة في الاستجابة');
}
