import http from 'node:http';
import { createPlaybackBudget } from './playback-budget.mjs';
import { createStartupTrace } from './startup-trace.mjs';
import { createTorrentReplayCache } from './torrent-replay-cache.mjs';
import { createReplayRecorder, sendReplayPrefix } from './torrent-replay-http.mjs';
import { inspectMp4Index } from './mp4-bootstrap.mjs';
import https from 'node:https';
import net from 'node:net';
import dns from 'node:dns/promises';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs, { mkdir, rm } from 'node:fs/promises';
import { join, basename, resolve, sep } from 'node:path';
import { tmpdir, freemem } from 'node:os';
import { selectTorrentCacheRoot, prepareTorrentCache, cacheFreeBytes, validateStreamingHeadroom } from './torrent-cache.mjs';
import { planWindow, readNeedsRebuild, rangeStart, createHolePuncher, safeEvictionEnd } from './torrent-window.mjs';
import { createUnblockingLookup, FragmentingAgent, looksLikeSniReset, describeNetError } from './net-unblock.mjs';

// DoH أولًا ثم DNS النظام، مثل الـAPK (AnimeDns): حجب DNS عند المزوّد لا يُسقط المصادر ولا الإضافات.
const unblockingLookup = createUnblockingLookup();
const systemLookup = host => dns.lookup(host, { all: true, verbatim: true });
/** مضيفات نجحت بتقسيم ClientHello: طلباتها التالية تذهب بالتقسيم مباشرة (AnimeHostRouter.fragmentHosts). */
const fragmentHosts = new Set();

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
export async function resolvePublicURL(input, lookup = unblockingLookup) {
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
    // متتبّعات الإضافة أولًا ثم القائمة العامة (نفس أندرويد): إضافة بلا متتبّعات لا تُترك لـDHT وحده
    const present = uri.searchParams.getAll('tr');
    for (const tr of mergeTrackers(present).slice(present.length)) uri.searchParams.append('tr',tr);
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
/**
 * متتبّعات عامة معروفة وثابتة (نفس TorrentPolicy.PUBLIC_TRACKERS في أندرويد): مجالات عامة لا عناوين
 * رقمية، وتمرّ بـvalidateTracker نفسه مثل أي متتبّع من الإضافة. rqbit يعلن لها كلها بالتوازي.
 */
export const PUBLIC_TRACKERS = Object.freeze([
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://open.demonii.com:1337/announce',
  'udp://open.stealth.si:80/announce',
  'udp://tracker.torrent.eu.org:451/announce',
  'udp://exodus.desync.com:6969/announce',
  'udp://explodie.org:6969/announce',
  'udp://tracker.theoks.net:6969/announce',
  'udp://opentracker.io:6969/announce',
  'udp://tracker.dler.org:6969/announce',
  'udp://tracker-udp.gbitt.info:80/announce',
  // شبكات تحجب UDP: نسخة HTTP/HTTPS
  'http://tracker.opentrackr.org:1337/announce',
  'https://tracker.gbitt.info:443/announce',
]);
export const MAX_ANNOUNCE = 48;
/** متتبّعات الإضافة كما هي وبترتيبها، ثم العامة غير المكررة حتى MAX_ANNOUNCE. */
export function mergeTrackers(addon, defaults = PUBLIC_TRACKERS) {
  const key = value => String(value).trim().replace(/\/+$/,'').toLowerCase();
  const seen = new Set(addon.map(key)), out = [...addon];
  for (const tracker of defaults) {
    if (out.length >= MAX_ANNOUNCE) break;
    if (seen.has(key(tracker))) continue;
    validateTracker(tracker);seen.add(key(tracker));out.push(tracker);
  }
  return out;
}
/**
 * المشاركون الذين رآهم rqbit أثناء جلب بيانات المغناطيس (list_only) يُمرَّرون كـinitial_peers
 * لإضافة التنزيل الفعلية، فلا يعيد rqbit البحث في DHT والمتتبّعات من الصفر قبل أول قطعة.
 * عناوين عامة فقط، وبصيغة SocketAddr التي يقبلها rqbit حرفيًا (عنوان واحد خاطئ = رفض الطلب كله).
 */
export const MAX_INITIAL_PEERS = 50;
export function initialPeers(seen) {
  if (!Array.isArray(seen)) return [];
  const out = new Set();
  for (const value of seen) {
    if (out.size >= MAX_INITIAL_PEERS) break;
    if (typeof value !== 'string' || value.length > 64) continue;
    const m = /^(?:(\d{1,3}(?:\.\d{1,3}){3})|\[([0-9a-fA-F:]{2,39})\]):(\d{1,5})$/.exec(value);
    if (!m) continue;
    const port = Number(m[3]);
    if (!(port >= 1 && port <= 65535)) continue;
    if (m[1]) {
      const octets = m[1].split('.').map(Number);
      if (octets.some(x => x > 255)) continue;
      const ip = octets.join('.');
      if (publicAddress(ip)) out.add(`${ip}:${port}`);
    } else if (net.isIPv6(m[2]) && publicAddress(m[2])) out.add(`[${m[2].toLowerCase()}]:${port}`);
  }
  return [...out];
}
/** سطر أوامر rqbit (خيارات rqbit 9.0.1 كما في crates/rqbit/src/main.rs لذلك الإصدار). */
export function engineArgs({apiPort,listenPort,dir,dhtPersistence=true}) {
  if (!Number.isSafeInteger(apiPort) || !Number.isSafeInteger(listenPort) || listenPort < 1 || listenPort > 65535 || typeof dir !== 'string') throw new Error('إعداد محرك التورنت غير صالح');
  // LSD يبقى معطلًا (لا إعلان في الشبكة المحلية، مثل أندرويد). UPnP مفعّل: rqbit يطلب من الراوتر
  // فتح منفذ الاستماع بعقد 60 ث يجدده كل 30 ث، فيصل إلينا مشاركون خلف NAT؛ وينتهي العقد بعد الإغلاق.
  // --listen-port صريح: القيمة 0 يحوّلها «server start» إلى 4240 الثابت، فيتعارض مع أي rqbit آخر.
  return ['-v','error','--http-api-listen-addr',`127.0.0.1:${apiPort}`,'--disable-lsd','--listen-port',String(listenPort),
    ...(dhtPersistence ? [] : ['--disable-dht-persistence']),'server','start',dir,'--disable-persistence'];
}
export function selectTorrentFile(files, candidate) {
  if (!Array.isArray(files) || !files.length) throw new Error('لم يعثر المحرك على ملفات التورنت');
  if (candidate.fileIdx != null) {
    if (!Number.isSafeInteger(candidate.fileIdx) || candidate.fileIdx < 0 || candidate.fileIdx >= files.length) throw new Error('fileIdx غير موجود في التورنت');
    return candidate.fileIdx;
  }
  if (candidate.filename) {
    const target=String(candidate.filename).replaceAll('\\','/');
    const exact=files.map((f,i)=>[f,i]).filter(([f])=>String(f.name).replaceAll('\\','/')===target);
    if(exact.length===1)return exact[0][1];
    const matches = files.map((f,i) => [f,i]).filter(([f]) => !target.includes('/')&&basename(String(f.name).replaceAll('\\','/')) === target);
    if (matches.length === 1) return matches[0][1];
    throw new Error('اسم ملف الفيديو المطلوب غير موجود أو يطابق أكثر من ملف؛ اختر fileIdx محددًا');
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
function readResponse(response, limit, decode=data=>data.toString('utf8')) {
  return new Promise((resolve,reject) => {
    const chunks=[];let size=0;
    response.on('data', chunk => { size+=chunk.length; if (size > limit) { reject(new Error('حجم الاستجابة أكبر من الحد')); response.destroy(); } else chunks.push(chunk); });
    response.on('end', () => {try{resolve(decode(Buffer.concat(chunks)));}catch(error){reject(error);}});
    response.on('error',reject);
    response.on('aborted',()=>reject(new Error('انقطع نقل الاستجابة')));
  });
}
async function secureResponse(url, {headers={},signal,timeout=15000,method='GET',body=null,lookup=unblockingLookup}={}) {
  if (signal?.aborted) throw cancelled();
  const pinned = await new Promise((resolve,reject) => {
    const abort = () => reject(cancelled());
    signal?.addEventListener('abort',abort,{once:true});
    resolvePublicURL(url,lookup).then(resolve,reject).finally(() => signal?.removeEventListener('abort',abort));
  });
  if (signal?.aborted) throw cancelled();
  const host=pinned.url.hostname;
  // Pin the validated DNS answer for this connection to prevent rebinding.
  const attempt=fragment=>new Promise((resolve,reject) => {
    const agent=fragment?new FragmentingAgent({address:pinned.address}):false;
    const request=https.request(pinned.url,{method,headers,signal,agent,servername:host,
      lookup:(_host, options, cb) => options?.all ? cb(null,[{address:pinned.address,family:pinned.family}]) : cb(null,pinned.address,pinned.family)},resolve);
    request.setTimeout(timeout,()=>request.destroy(Object.assign(new Error('انتهت مهلة HTTPS'),{code:'ETIMEDOUT'})));
    request.on('error',reject); request.end(body);
  });
  if(pinned.url.protocol!=='https:')return attempt(false);
  if(fragmentHosts.has(host))return attempt(true);
  try { return await attempt(false); }
  catch(error) {
    // نمط حجب SNI: أعد مرة واحدة بتقسيم ClientHello (نفس الـAPK)، وتذكّر المضيف إن نجحت.
    if(signal?.aborted||!looksLikeSniReset(error))throw error;
    const response=await attempt(true).catch(again=>{throw Object.assign(again,{first:error});});
    fragmentHosts.add(host);
    return response;
  }
}
async function localJSON(base,path,{body,signal,timeout=15000,auth}={}) {
  return new Promise((resolve,reject) => {
    const req=http.request(new URL(path,base),{method:body==null?'GET':'POST',signal,headers:{Authorization:`Basic ${Buffer.from(auth).toString('base64')}`,'content-type':'text/plain','x-req-timeout-ms':String(timeout)}}, async res => {
      try { const text=await readResponse(res,4*1024*1024); if (res.statusCode>=400) {const error=new Error('رفض محرك التورنت الطلب');error.status=res.statusCode;throw error;}resolve(JSON.parse(text)); } catch(e) {reject(e);} });
    req.setTimeout(timeout,()=>req.destroy(new Error('انتهت مهلة بيانات التورنت')));req.on('error',reject);req.end(body);
  });
}
/** حقل القطع المنزّلة من rqbit (Msb0). */
async function localBitfield(base,path,{signal,timeout=5000,auth}={}) {
  return new Promise((resolve,reject) => {
    const req=http.request(new URL(path,base),{method:'GET',signal,headers:{Authorization:`Basic ${Buffer.from(auth).toString('base64')}`,Accept:'application/octet-stream'}},res=>{
      const chunks=[];let size=0;
      res.on('data',c=>{size+=c.length;if(size>8*1024*1024){res.destroy();reject(new Error('حقل القطع كبير'));}else chunks.push(c);});
      res.on('end',()=>res.statusCode>=400?reject(new Error('رفض محرك التورنت الطلب')):resolve({bits:Buffer.concat(chunks),length:Number(res.headers['x-bitfield-len'])}));
      res.on('error',reject);
    });
    req.setTimeout(timeout,()=>req.destroy(new Error('انتهت مهلة حقل القطع')));req.on('error',reject);req.end();
  });
}
/** هل المسار داخل المجلد فعلًا (بعد التطبيع)؟ */
export function insideDir(file,dir,platform=process.platform) {
  const norm=v=>{const r=resolve(String(v));return platform==='win32'?r.toLowerCase():r;};
  const f=norm(file),d=norm(dir);
  return f.startsWith(d.endsWith(sep)?d:d+sep);
}
const hasPiece=(bits,i)=>i>=0&&(i>>3)<bits.length&&((bits[i>>3]>>(7-(i&7)))&1)===1;
/** نهاية المنزّل المتصل من موضع المشاهدة (بايت داخل الملف)، أو null. */
export function contiguousEndFrom(bits,{fileOffset,fileLength,pieceLength,totalPieces},fromByte) {
  if(!(pieceLength>0)||!Number.isFinite(fromByte))return null;
  let piece=Math.floor((fileOffset+fromByte)/pieceLength);
  const last=Math.min(totalPieces-1,Math.floor((fileOffset+fileLength-1)/pieceLength));
  while(piece<=last&&hasPiece(bits,piece))piece++;
  return Math.min(fileLength,Math.max(0,piece*pieceLength-fileOffset));
}
/** طول القطعة من عددها وحجم التورنت: قوة اثنين (المعيار)؛ وإلا القسمة المقرّبة لأعلى. */
export function pieceLengthOf(totalBytes,totalPieces) {
  if(!(totalPieces>0)||!(totalBytes>0))return 0;
  const raw=Math.ceil(totalBytes/totalPieces);
  const power=2**Math.ceil(Math.log2(raw));
  return Math.ceil(totalBytes/power)===totalPieces?power:raw;
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

export function createDesktopServices({userData,binaries,onEvent=()=>{},platform=process.platform,videoHost=null,inputConf=null,firstFrameRecoveryMs=45000,firstFrameFailureMs=60000,windowTickMs=2000,windowLimits,holePuncher=null,dnsOverHttps=true,torrentMetadataStrategy='direct-index',torrentWarmup='container',replayCache=true}) {
  if (typeof userData!=='string'||!binaries?.rqbit||!binaries?.mpv) throw new Error('إعداد البرامج المرفقة غير صالح');
  let current=null,closed=false;
  // DoH أولًا كالـAPK؛ الاختبارات التي تحاكي DNS النظام تطفئه صراحة.
  const lookup=dnsOverHttps?unblockingLookup:systemLookup;
  const puncher=holePuncher??createHolePuncher(platform);
  const states=new Set(), resourceControllers=new Set();
  const replayCaches=new Map();
  const replayFor=ownerId=>{
    if(!replayCache)return null;
    if(!replayCaches.has(ownerId)){
      const cache=createTorrentReplayCache({userData,ownerId});replayCaches.set(ownerId,cache);
      void cache.cleanup();
    }
    return replayCaches.get(ownerId);
  };
  // Electron owns the single-instance lock before constructing services.
  // This directory contains only disposable session downloads.
  const startup=Promise.all(['torrent-cache','subtitle-cache'].map(name=>rm(join(userData,name),{recursive:true,force:true})))
    .then(()=>null,()=>new Error('تعذر تنظيف ملفات التورنت المتروكة؛ أغلق المحركات القديمة ثم حاول مجددًا'));
  const publish = event => { try { onEvent(event); } catch {} };
  function emit(state,event) { if (!state.stopped && current===state) publish({...event,session:state.session}); }
  function playbackState(state) {
    return {position:state.progress.position??0,duration:state.progress.duration??0,paused:state.mediaPaused===true,buffering:state.mediaBuffering===true};
  }
  function emitPlaybackState(state) {if(state.ready){const value=playbackState(state);state.budget?.update(value);emit(state,{type:'playback/state',...value});}}
  function assertSession(state) { if (state.stopped||current!==state||closed) throw cancelled(); }
  async function cleanup(state) {
    if (state.cleanup) return state.cleanup;
    state.trace?.stop();state.stopped=true;state.budget?.dispose();state.resolveReady?.(false);state.resolveCommands?.(false);state.controller.abort();clearInterval(state.statsTimer);clearInterval(state.windowTimer);clearTimeout(state.firstFrameWatchdog);
    for(const pending of state.pending.values()) {clearTimeout(pending.timer);pending.reject(cancelled());}state.pending.clear();
    state.socket?.destroy();
    state.cleanup=(async()=>{
      if(state.proxy){state.proxy.closeAllConnections();await new Promise(resolve=>state.proxy.close(resolve));}
      await state.engineTask?.catch(()=>{});
      await state.bootstrapTask?.catch(()=>{});
      await Promise.all([...state.children].map(kill));
      await Promise.all([...state.cacheRecorders??[]].map(recorder=>recorder.finish()));
      await state.videoSurface?.close();
      if(state.ipc&&platform!=='win32')await rm(state.ipc,{force:true}).catch(()=>{});
      if(state.cacheDir)await rm(state.cacheDir,{recursive:true,force:true}).catch(()=>{});
      if(state.cacheParent)await rm(state.cacheParent,{recursive:true,force:true}).catch(()=>{});
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
      // JSON:API (Kitsu لربط الأنمي بـTorrentio) يرفض application/json وحده بـ406؛ نقبل +json وأي نوع احتياطًا
      request.headers={accept:json?'application/json, application/*+json;q=0.9, */*;q=0.8':'*/*','user-agent':'Mozilla/5.0 VANTARA/Windows',...request.headers};
      for(let redirects=0;redirects<6;redirects++) {
        const response=await secureResponse(request.url,{headers:request.headers,method:request.method,body:request.body,signal:controller.signal,timeout,lookup});
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
    } catch(e) {if(e.message?.includes('رابط')||e.message?.includes('حد')||e.message?.includes('حجم')||e.message?.includes('توجيه'))throw e;throw new Error(`تعذر جلب مورد HTTPS: ${describeNetError(e)}`);}
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
      // التورنت: الرابط الحالي للمحرك (يتغيّر بعد إعادة البناء). قراءة من منطقة فُرّغت من القرص
      // تنتظر إعادة بناء التورنت من تلك النقطة، فلا تصل للمشغّل أصفار أبدًا.
      let start=rangeStart(req.headers.range),replay;
      const reader=torrent?{cursor:start,requestId:++state.rangeSequence,at:performance.now()}:null;
      if(reader)state.trace.record('http-range',{requestId:reader.requestId,rangeStart:start});
      if(reader){state.torrentReaders.set(reader,reader);state.latestDemand=reader;}
      const abort=new AbortController();req.once('close',()=>{if(!req.complete)abort.abort();});res.once('close',()=>abort.abort());
      if(reader)res.once('close',()=>{state.torrentReaders.delete(reader);if(state.latestDemand===reader)state.latestDemand=[...state.torrentReaders.values()].at(-1);});
      const demandBytes=(size,cursor)=>{
        if(!reader)return;reader.cursor=cursor;
        const mode=reader.source??'torrent';
        state.trace.once('http-first-byte',{bytes:size,waitMs:performance.now()-reader.at,mode});
        if(!reader.firstByte){reader.firstByte=true;const waitMs=performance.now()-reader.at;state.rangeWaitMs=(state.rangeWaitMs??0)+waitMs;state.trace.record('range-first-byte',{requestId:reader.requestId,cursor,waitMs,mode});}
        if(mode==='cache')state.cacheBytesRead=(state.cacheBytesRead??0)+size;
        else state.trace.once('first-useful-piece',{requestedPiece:Math.floor(((state.win?.fileOffset??0)+cursor-size)/(state.win?.pieceLength||1))});
        if(state.latestDemand===reader){state.demandFlowAt=Date.now();if(state.win)state.win.readPos=cursor;}
      };
      const parentAbort=()=>abort.abort();state.controller.signal.addEventListener('abort',parentAbort,{once:true});
      try {
        if(torrent){
          if(state.replayEntry){
            reader.source='cache';
            replay=await sendReplayPrefix({entry:state.replayEntry,req,res,signal:abort.signal,onBytes:demandBytes});
            if(replay.complete)return;
            start=replay.cursor;reader.cursor=start;
          }
          await state.engineTask;
          assertSession(state);
          if(state.evictionBarrier)await state.evictionBarrier;
          if(readNeedsRebuild(start,state.win?.evictedTo??0))await rebuild(state);
          url=state.streamUrl;
          reader.source='torrent';
        }
        let requestHeaders={};
        if(req.headers.range&&/^bytes=\d*-\d*(?:,\d*-\d*)*$/.test(req.headers.range))requestHeaders.Range=req.headers.range;
        if(torrent){
          if(replay?.sent)requestHeaders.Range=`bytes=${start}-${replay.range.end}`;
          requestHeaders.Authorization=`Basic ${Buffer.from(state.auth).toString('base64')}`;
          upstream=await new Promise((resolve,reject)=>{const r=http.get(url,{headers:requestHeaders,signal:abort.signal},resolve);r.on('error',reject);r.setTimeout(120000,()=>r.destroy(new Error('مهلة الفيديو')));});
          if(replay?.sent&&(upstream.statusCode!==206||!String(upstream.headers['content-range']??'').startsWith(`bytes ${start}-`)))throw new Error('Invalid torrent continuation');
        } else {
          for(let redirects=0;;redirects++){
            const u=new URL(url);requestHeaders={...(u.origin===origin?headers:{}),...requestHeaders,'Accept-Encoding':'identity'};
            // Rebuild each hop: origin-scoped credentials must never persist.
            if(u.origin!==origin)requestHeaders={...(req.headers.range?{Range:req.headers.range}:{}),'Accept-Encoding':'identity'};
            upstream=await secureResponse(url,{headers:requestHeaders,signal:abort.signal,timeout:60000,lookup});
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
          if(!res.headersSent){
            res.writeHead(upstream.statusCode,responseHeaders);
            if(torrent){
              // rqbit can describe a Range before its first piece is ready.
              // Node otherwise buffers these headers until the first body byte.
              res.flushHeaders();
              const end=/^bytes \d+-(\d+)\//.exec(String(upstream.headers['content-range']??''));
              state.trace.record('http-headers',{requestId:reader.requestId,rangeStart:start,...(end?{rangeEnd:Number(end[1])}:{}),waitMs:performance.now()-reader.at});
            }
          }
          if(req.method==='HEAD'){upstream.destroy();res.end();}else {
            if(torrent&&state.win){let sent=0;upstream.on('data',c=>{sent+=c.length;demandBytes(c.length,start+sent);});}
            if(torrent&&state.replayEntry&&[200,206].includes(upstream.statusCode)){
              const actual=upstream.statusCode===206?Number(/^bytes (\d+)-/.exec(String(upstream.headers['content-range']??''))?.[1]):0;
              if(Number.isSafeInteger(actual)&&actual===start){
                const recorder=createReplayRecorder(state.replayEntry,actual);state.cacheRecorders.add(recorder);
                upstream.on('data',bytes=>recorder.append(bytes));
                const finish=()=>{void recorder.finish().finally(()=>state.cacheRecorders.delete(recorder));};
                upstream.once('end',finish);upstream.once('close',finish);res.once('close',finish);
              }
            }
            upstream.once('error',()=>res.destroy());upstream.once('aborted',()=>res.destroy());upstream.pipe(res);
          }
        }
      }catch{upstream?.destroy();if(!res.headersSent){res.writeHead(502);res.end();}else res.destroy();}
      finally{state.controller.signal.removeEventListener('abort',parentAbort);}
    });
    state.proxy=server;
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
    assertSession(state);return mapped(target);
  }
  async function engine(state,candidate) {
    state.trace.record('engine-start');
    emit(state,{type:'playback/stage',stage:'engine-start'});
    // An owned replay descriptor already identifies the previous usable volume.
    // Check its current headroom first; avoid a PowerShell drive enumeration on
    // every replay or app restart. A removed/full volume still uses normal selection.
    let chosen;
    if(state.replayEntry){
      try{const root=state.replayEntry.descriptor.root,available=await cacheFreeBytes(root);if(available>=512n*1024n*1024n)chosen={root,available};}catch{}
    }
    chosen??=await selectTorrentCacheRoot({userData,platform});assertSession(state);
    state.cacheParent=await prepareTorrentCache(chosen.root,userData);assertSession(state);
    const dir=join(state.cacheParent,secret());state.cacheDir=dir;await mkdir(dir,{recursive:true});assertSession(state);
    emit(state,{type:'playback/stage',stage:'cache-selected',volume:chosen.root,availableBytes:Number(chosen.available)});
    state.auth=`vantara:${secret()}`;
    const env=cleanEnv();env.RQBIT_HTTP_BASIC_AUTH_USERPASS=state.auth;
    // جدول DHT المحفوظ (مثل dht.state في أندرويد): rqbit يحفظه كل 60 ث ويحمّله عند البدء، فلا يبدأ
    // كل تشغيل ببحث بارد من عقد الإقلاع. ويندوز: %LOCALAPPDATA%\rqbit\dht\cache\dht.json (مسار rqbit الثابت).
    // غير ويندوز (الاختبارات): داخل بيانات التطبيق لا في ~/.cache.
    if(platform!=='win32')env.XDG_CACHE_HOME=join(userData,'engine-state');
    const options={auth:state.auth,signal:state.controller.signal};
    await launchEngine(state,dir,env,options);
    state.trace.record('engine-ready');

    emit(state,{type:'playback/stage',stage:'metadata'});
    state.trace.record('magnet-metadata-start');
    // rqbit validates only_files against the resolved metadata BEFORE opening
    // storage. A known index can therefore use one managed add: resolving a
    // list_only magnet first would throw away its metadata peer receiver.
    let added=null,metadata;
    if(torrentMetadataStrategy==='direct-index'&&candidate.fileIdx!=null){
      state.win={index:candidate.fileIdx,magnet:candidate.magnet,peers:[]};
      added=await addTorrent(state,options,'');
      metadata=added;
    }else{
      metadata=await getTorrentMetadata(
        ()=>localJSON(state.api,'/torrents?list_only=true',{...options,body:candidate.magnet,timeout:45000}),
        ms=>sleep(ms,state.controller.signal),()=>assertSession(state));
    }
    assertSession(state);
    state.trace.record('magnet-metadata-complete');
    if(metadata.details?.info_hash?.toLowerCase()!==candidate.infoHash)throw new Error('هوية التورنت لا تطابق النتيجة');
    const index=selectTorrentFile(metadata.details.files,candidate);
    state.trace.record('file-selected',{fileIdx:index,fileBytes:Number(metadata.details.files[index]?.length)});
    emit(state,{type:'playback/stage',stage:'file-selected',fileIdx:index,bytes:metadata.details.files[index]?.length});
    let storage;
    try { storage=await fs.statfs(dir,{bigint:true}); }
    catch { throw new Error('تعذر التحقق من المساحة المتاحة لملف التورنت؛ اختر مصدرًا آخر'); }
    assertSession(state);
    validateTorrentStorage(metadata.details.files[index],storage.bavail*storage.bsize);
    // نافذة متحركة: قدّام بقدر المساحة، 50 ث ورا، والباقي يُفرّغ من القرص (torrent-window.mjs)
    const files=metadata.details.files;
    const fileOffset=files.slice(0,index).reduce((sum,f)=>sum+(Number(f.length)||0),0);
    const totalBytes=files.reduce((sum,f)=>sum+(Number(f.length)||0),0);
    const totalPieces=Number(metadata.details.total_pieces)||0;
    state.win={index,magnet:candidate.magnet,peers:initialPeers(metadata.seen_peers),fileLength:Number(files[index].length),fileOffset,totalPieces,pieceLength:pieceLengthOf(totalBytes,totalPieces),evictedTo:0,paused:false,readPos:null,filePath:null};
    // التحقق من المساحة والهوية يسبق بدء التنزيل. هذه أول عملية ذات أثر جانبي
    // ولا نكررها تلقائيًا كي لا يُضاف التورنت مرتين بعد فقدان الرد.
    if(!added)added=await addTorrent(state,options,'');assertSession(state);
    if(!Number.isSafeInteger(added.id)||added.id<0)throw new Error('لم يسجل المحرك ملف التورنت');
    adopt(state,added);
    if(state.replayStore){
      state.replayEntry??=await state.replayStore.remember({root:chosen.root,infoHash:candidate.infoHash,fileIdx:index,fileLength:Number(files[index].length),filename:basename(String(files[index].name).replaceAll('\\','/'))});
      assertSession(state);
    }
    // Every rqbit HTTP reader contributes a 32 MiB priority window. Let mpv's
    // actual container Range requests drive demand rather than competing with
    // speculative head/tail readers. Retain the old strategy for measured A/B.
    if(torrentWarmup==='both')warmEdges(state);
    if(torrentWarmup==='container')state.bootstrapTask=warmContainerIndex(state,files[index].name);
    emit(state,{type:'playback/stage',stage:'downloading'});
    state.statsTimer=setInterval(async()=>{
      if(state.statsPending||state.stopped||state.rebuilding)return;state.statsPending=true;
      try{const stats=await localJSON(state.api,`/torrents/${state.torrentId}/stats/v1`,{...options,timeout:2000});const speed=stats.live?.download_speed?.mbps,peers=stats.live?.snapshot?.peer_stats?.live;
        const snapshot=stats.live?.snapshot,range=state.latestDemand;
        state.trace.record('torrent-sample',{knownPeers:snapshot?.peer_stats?.seen,connectedPeers:peers,speedBytes:Number.isFinite(speed)?speed*1024*1024:undefined,checkedBytes:snapshot?.downloaded_and_checked_bytes,checkedPieces:snapshot?.downloaded_and_checked_pieces,requestedPiece:range?Math.floor((state.win.fileOffset+range.cursor)/(state.win.pieceLength||1)):undefined,cursor:range?.cursor,cacheBytesRead:state.cacheBytesRead??0});
        if(peers>0)state.trace.once('peer-connected');
        emit(state,{type:'playback/progress',...state.progress,...(Number.isFinite(speed)?{downloadSpeed:speed*1024*1024}:{}),...(Number.isFinite(peers)?{peers}:{} )});
      }catch{}finally{state.statsPending=false;}
    },1000);
    state.windowTimer=setInterval(()=>{void windowTick(state);},windowTickMs);
    return state.streamUrl;
  }
  /**
   * يشغّل rqbit وينتظر واجهته. المحاولة الأولى بجدول DHT المحفوظ؛ إن خرج rqbit قبل أن يجيب (منفذ DHT
   * المحفوظ مشغول بـrqbit آخر، أو ملف الحفظ غير مقروء — rqbit 9.0.1 يتوقف حينها ولا يتجاهل) نعيد مرة
   * واحدة بلا حفظ DHT وبمنافذ جديدة، أي كما كان المحرك قبل هذا التعديل.
   */
  async function launchEngine(state,dir,env,options) {
    for(const dhtPersistence of [true,false]) {
      const apiPort=await port();let listenPort=await port();
      while(listenPort===apiPort)listenPort=await port();
      assertSession(state);
      state.api=`http://127.0.0.1:${apiPort}`;
      let exited=false;
      child(state,binaries.rqbit,engineArgs({apiPort,listenPort,dir,dhtPersistence}),env,message=>{if(state.engineReady)void fail(state,message);else exited=true;});
      const deadline=Date.now()+15000;
      while(!exited){
        assertSession(state);
        try{await localJSON(state.api,'/',{...options,timeout:1000});if(exited)break;state.engineReady=true;return;}
        catch{if(Date.now()>deadline)throw new Error('لم يبدأ محرك التورنت');if(!exited)await sleep(50,state.controller.signal);}
      }
    }
    throw new Error('لم يبدأ محرك التورنت');
  }
  /**
   * إضافة التنزيل الفعلية. rqbit لا يحتفظ بنتيجة list_only فيحل المغناطيس مرة ثانية؛ مع initial_peers
   * يتصل فورًا بمن أعطوه البيانات قبل ثوانٍ بدل بحث DHT/متتبّعات جديد. رفض 400 مع المشاركين يعاد مرة
   * واحدة بدونهم: خطأ صيغة الاستعلام يُرفض قبل تسجيل أي تورنت، وإن سُجّل فـrqbit يرد بنفس الرقم.
   */
  async function addTorrent(state,options,extra) {
    const w=state.win,base=`/torrents?only_files=${w.index}${extra}`;
    const request=peers=>localJSON(state.api,peers.length?`${base}&initial_peers=${encodeURIComponent(peers.join(','))}`:base,{...options,body:w.magnet,timeout:120000});
    if(!w.peers.length)return request([]);
    try{return await request(w.peers);}
    catch(error){if(error?.status!==400)throw error;assertSession(state);w.peers=[];return request([]);}
  }
  /**
   * مثل الـAPK (TorrentEngine: «Container index lives at the head or the tail»): فهرس الحاوية في أول
   * الملف أو آخره، وmpv لا يعرض أول إطار قبل قراءته. نطلب الطرفين فور إضافة التورنت فيعطيهما rqbit
   * أولوية القارئ، بدل أن ينتظر المشغل حتى يطلب آخر الملف ثم يبدأ تنزيله من الصفر.
   */
  function warmEdges(state) {
    const w=state.win,size=w.fileLength;if(!(size>0)||!state.streamUrl)return;
    const span=Math.min(8*1024*1024,Math.max(1024*1024,Math.ceil(size*0.002)));
    const ranges=[`bytes=0-${Math.min(size,span)-1}`];
    if(size>span*2)ranges.push(`bytes=${size-span}-${size-1}`);
    for(const range of ranges){
      const req=http.get(state.streamUrl,{headers:{Range:range,Authorization:`Basic ${Buffer.from(state.auth).toString('base64')}`},signal:state.controller.signal},res=>{res.on('data',()=>{});res.on('error',()=>{});});
      req.on('error',()=>{});req.setTimeout(180000,()=>req.destroy());
    }
  }
  async function warmContainerIndex(state,filename) {
    const w=state.win;
    if(!/\.mp4$/i.test(String(filename))||!w.filePath)return;
    const deadline=performance.now()+8000;
    try{
      while(!state.stopped&&!state.ready&&performance.now()<deadline){
        let file,hint;
        try{
          const stat=await fs.lstat(w.filePath);
          if(stat.isSymbolicLink()||!stat.isFile())return;
          file=await fs.open(w.filePath,'r');
          hint=await inspectMp4Index(async(position,length)=>{
            const bytes=Buffer.alloc(length);const result=await file.read(bytes,0,length,position);return bytes.subarray(0,result.bytesRead);
          },w.fileLength,w.pieceLength);
        }catch(error){if(error.code!=='ENOENT')return;}
        finally{await file?.close();}
        if(state.stopped||state.ready)return;
        if(hint?.state==='none')return;
        if(hint?.state==='index'){
          state.trace.once('container-index-request',{rangeStart:hint.offset});
          const req=http.get(state.streamUrl,{headers:{Range:`bytes=${hint.offset}-${hint.offset}`,Authorization:`Basic ${Buffer.from(state.auth).toString('base64')}`},signal:state.controller.signal},res=>{res.resume();res.on('error',()=>{});});
          state.bootstrapRequest=req;req.on('error',()=>{});req.setTimeout(30000,()=>req.destroy());
          return;
        }
        await sleep(100,state.controller.signal);
      }
    }catch{ /* Hints are optional; normal verified HTTP reads remain authoritative. */ }
  }
  /** يسجّل تورنتًا مضافًا: رقمه ورابط بثه ومسار ملفه على القرص. */
  function adopt(state,added) {
    const w=state.win;
    state.torrentId=added.id;
    state.streamUrl=`${state.api}/torrents/${added.id}/stream/${w.index}`;
    const folder=added.details?.output_folder??added.output_folder;
    const file=added.details?.files?.[w.index];
    const parts=Array.isArray(file?.components)&&file.components.length?file.components:file?.name?[file.name]:null;
    w.filePath=folder&&parts?join(String(folder).replace(/^\\\\\?\\/,''),...parts.map(String)):null;
    // لا نفرّغ خارج مجلد الجلسة أبدًا (ويندوز: لا فرق بين الحروف الكبيرة والصغيرة)
    if(w.filePath&&!insideDir(w.filePath,state.cacheDir,platform))w.filePath=null;
    w.evictedTo=0;w.paused=false;w.readPos=null;
  }
  /**
   * رجوع لجزء فُرّغ: نحذف التورنت (وملفه) ونضيفه من جديد، فيبدأ rqbit من موضع القراءة
   * بأولوية البث. يُستدعى من الوكيل قبل الرد على الطلب؛ طلبات متزامنة تنتظر نفس البناء.
   */
  function rebuild(state) {
    if(state.rebuilding)return state.rebuilding;
    const options={auth:state.auth,signal:state.controller.signal};
    state.rebuilding=(async()=>{
      emit(state,{type:'playback/retrying',message:'رجعت لجزء حُذف من الكاش لتوفير المساحة؛ نعيد تنزيله من هنا'});
      await localJSON(state.api,`/torrents/${state.torrentId}/delete`,{...options,body:'',timeout:15000}).catch(()=>{});
      assertSession(state);
      const added=await addTorrent(state,options,'&overwrite=true');
      assertSession(state);
      if(!Number.isSafeInteger(added.id)||added.id<0)throw new Error('لم يسجل المحرك ملف التورنت');
      adopt(state,added);
    })().finally(()=>{state.rebuilding=null;});
    return state.rebuilding;
  }
  /** نبضة النافذة: تفريغ ما خلف المشاهدة، وإيقاف/استئناف التنزيل حسب المساحة الحرة. */
  async function windowTick(state) {
    const w=state.win;
    if(!w||state.stopped||state.windowBusy||state.rebuilding)return;
    state.windowBusy=true;
    const options={auth:state.auth,signal:state.controller.signal};
    try {
      const freeBytes=Number(await cacheFreeBytes(state.cacheDir));
      let forwardCacheBytes=null;
      if(state.ready&&state.socket&&!state.socket.destroyed){
        try{const cache=await ipcCommand(state,['get_property','demuxer-cache-state']);const fw=Number(cache?.['fw-bytes']);if(Number.isFinite(fw))forwardCacheBytes=fw;}catch{}
      }
      const positionSeconds=Number.isFinite(state.progress.position)?state.progress.position/1000:null;
      const durationSeconds=Number.isFinite(state.progress.duration)?state.progress.duration/1000:null;
      let contiguousEnd=null;
      try{
        const {bits}=await localBitfield(state.api,`/torrents/${state.torrentId}/haves`,options);
        const from=w.readPos!=null&&forwardCacheBytes!=null?Math.max(0,w.readPos-forwardCacheBytes):positionSeconds!=null&&durationSeconds>0?positionSeconds/durationSeconds*w.fileLength:null;
        contiguousEnd=contiguousEndFrom(bits,w,from);
      }catch{}
      if(state.stopped||state.rebuilding||state.seekTarget!=null)return;
      const plan=planWindow({fileLength:w.fileLength,fileOffset:w.fileOffset,pieceLength:w.pieceLength,durationSeconds,positionSeconds,
        readPos:w.readPos,forwardCacheBytes,contiguousEnd,evictedTo:w.evictedTo,freeBytes,paused:w.paused,buffering:state.mediaBuffering===true,limits:windowLimits});
      if(plan.evictTo!=null&&w.filePath){
        // Publish the barrier before awaiting disk I/O. A new Range must see
        // the committed eviction boundary before using rqbit's old have bits.
        let finish;state.evictionBarrier=new Promise(resolve=>finish=resolve);
        try{
          const end=safeEvictionEnd(plan.evictTo,state.torrentReaders.values(),w.pieceLength,w.fileOffset);
          if(end>w.evictedTo&&await puncher.punch(w.filePath,0,end))w.evictedTo=end;
        }finally{finish();state.evictionBarrier=null;}
      }
      if(plan.action==='pause'&&!w.paused){await localJSON(state.api,`/torrents/${state.torrentId}/pause`,{...options,body:'',timeout:5000});w.paused=true;}
      else if(plan.action==='resume'&&w.paused){await localJSON(state.api,`/torrents/${state.torrentId}/start`,{...options,body:'',timeout:5000});w.paused=false;}
      if(plan.fail)return void fail(state,plan.fail);
      emit(state,{type:'playback/cache',freeBytes,evictedBytes:w.evictedTo,downloadPaused:w.paused,...(plan.aheadSeconds!=null?{aheadSeconds:Math.round(plan.aheadSeconds)}:{})});
    } catch { /* نبضة فاشلة لا تُسقط المشاهدة؛ التالية تحاول */ }
    finally {state.windowBusy=false;}
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
    state.trace.record('player-start');
    if(videoHost){state.videoSurface=await videoHost.acquire(state.session,state.controller.signal);assertSession(state);}
    if(state.videoSurface&&!/^\d{1,20}$/.test(state.videoSurface.windowId))throw new Error('مقبض نافذة الفيديو غير صالح');
    state.ipc=platform==='win32'?`\\\\.\\pipe\\vantara-${secret()}`:join(tmpdir(),`vantara-${secret()}.sock`);
    // Keep MPV's *packet* cache in RAM, separate from rqbit's disk cache.
    // Target about a minute ahead, but cap bytes to protect low-memory PCs.
    const freeMemory=freemem();
    const aheadMiB=freeMemory<2*1024**3?128:freeMemory<6*1024**3?256:512;
    const behindMiB=freeMemory<2*1024**3?32:freeMemory<6*1024**3?64:128;
    const args=['--no-config','--idle=yes','--terminal=no','--force-window=yes','--keep-open=no','--cache=yes','--cache-on-disk=no','--cache-pause-initial=yes','--cache-pause-wait=3','--cache-secs=60',`--demuxer-max-bytes=${aheadMiB}MiB`,`--demuxer-max-back-bytes=${behindMiB}MiB`,'--hwdec=auto-safe','--input-default-bindings=yes','--sub-auto=no','--slang=ar,ara,arabic,en,eng',`--input-ipc-server=${state.ipc}`,`--title=${String(title??'VANTARA').replace(/[\x00-\x1f\x7f]/g,' ').slice(0,300)}`,`--start=${position/1000}`,`--pause=${pause?'yes':'no'}`];
    if(state.videoSurface)args.push(`--wid=${state.videoSurface.windowId}`,'--osc=no','--input-cursor=no');
    if(state.videoSurface&&inputConf)args.push(`--input-conf=${inputConf}`);
    emit(state,{type:'playback/stage',stage:'player-start',embedded:!!state.videoSurface});
    child(state,binaries.mpv,args,cleanEnv(),(message,code)=>{if(message==='أغلق البرنامج المرفق'&&code===0&&state.ready){emit(state,{type:'playback/closed',...state.progress});cleanup(state).then(()=>{if(current===state)current=null;});}else fail(state,message);});
    state.socket=await connectIPC(state,state.ipc);assertSession(state);
    state.trace.record('player-ipc-ready');
    let buffer='';
    state.socket.on('error',()=>fail(state,'انقطعت قناة التحكم بالمشغل'));
    state.socket.on('close',()=>{if(!state.stopped)fail(state,'انقطعت قناة التحكم بالمشغل');});
    const ready=()=>{if(state.ready)return;state.ready=true;state.bootstrapRequest?.destroy();state.stableSince=performance.now();state.firstPosition=state.progress.position??0;state.trace.once('decoder-output',{mode:'render-unmeasured'});state.budget?.ready(playbackState(state));clearTimeout(state.firstFrameWatchdog);state.publishedSeekRevision=state.seekRevision;state.resolveReady(true);emit(state,{type:'playback/ready',...state.progress,embedded:!!state.videoSurface});emitPlaybackState(state);};
    state.socket.on('data',data=>{
      buffer+=data.toString('utf8');if(buffer.length>1024*1024){state.socket.destroy();return;}
      while(buffer.includes('\n')){
        const end=buffer.indexOf('\n'),line=buffer.slice(0,end);buffer=buffer.slice(end+1);let event;try{event=JSON.parse(line);}catch{continue;}
        if(event.request_id!=null){const pending=state.pending.get(event.request_id);if(pending){state.pending.delete(event.request_id);clearTimeout(pending.timer);event.error==='success'?pending.resolve(event.data):pending.reject(new Error('رفض المشغل الأمر'));}}
        if(event.event==='client-message'&&['vantara-fullscreen','vantara-back'].includes(event.args?.[0]))emit(state,{type:'playback/action',action:event.args[0]==='vantara-fullscreen'?'fullscreen':'close'});
        if(event.event==='seek'){state.seekRevision=(state.seekRevision??0)+1;state.stableSince=performance.now();}
        if(event.event==='file-loaded')state.trace.once('container-metadata-ready');
        if(event.event==='playback-restart'&&state.ready&&state.seekRevision!==state.publishedSeekRevision) {
          const revision=state.seekRevision;state.publishedSeekRevision=revision;state.seekTarget=null;
          ipcCommand(state,['get_property','time-pos']).then(seconds=>{
            if(Number.isFinite(seconds)&&seconds>=0&&state.seekRevision===revision){state.budget?.seekReady({position:Math.round(seconds*1000),paused:state.mediaPaused});emit(state,{type:'playback/seek',position:Math.round(seconds*1000)});}
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
            state.audioTracks=event.data.filter(t=>t.type==='audio'&&Number.isSafeInteger(t.id)&&t.id>=0).slice(0,100)
              .map(t=>({id:t.id,lang:subtitleLanguage(t.lang),label:subtitleLabel(t.title??t.lang??'صوت'),selected:t.selected===true}));
            emit(state,{type:'playback/audio',tracks:state.audioTracks});
            state.subtitleTracks=event.data.filter(t=>t.type==='sub'&&Number.isSafeInteger(t.id)&&t.id>=0).slice(0,200)
              .map(t=>({id:t.id,lang:subtitleLanguage(t.lang),label:subtitleLabel(t.title??t.lang??'ترجمة'),selected:t.selected===true}));
            const selected=state.subtitleTracks.find(t=>t.selected),selectedId=selected?.id??null;
            const expected=state.subtitleExpectedSelection;
            if(expected&&selected?.lang===expected.lang&&selected?.label===expected.label)state.subtitleExpectedSelection=null;
            else if(!expected&&state.lastSubtitleSelection!=null&&state.lastSubtitleSelection!==selectedId)state.subtitleManual=true;
            state.lastSubtitleSelection=selectedId;
            emitSubtitleTracks(state);
          }
          if(['time-pos','duration'].includes(event.name)&&Number.isFinite(event.data)&&event.data>=0){state.progress[event.name==='time-pos'?'position':'duration']=Math.round(event.data*1000);if(event.name==='time-pos'&&state.ready&&!state.mediaBuffering&&!state.mediaPaused){state.stableSince??=performance.now();if(performance.now()-state.stableSince>=3000&&state.progress.position>=state.firstPosition+1000)state.trace.once('stable-playback',{position:state.progress.position});}emit(state,{type:'playback/progress',...state.progress,paused:state.mediaPaused===true,buffering:state.mediaBuffering===true});emitPlaybackState(state);}
          if(event.name==='pause'&&typeof event.data==='boolean'){state.mediaPaused=event.data;state.stableSince=null;if(state.ready)emit(state,{type:'playback/pause',paused:event.data});emitPlaybackState(state);}
          if(event.name==='paused-for-cache'&&typeof event.data==='boolean'){state.mediaBuffering=event.data;state.stableSince=null;emitPlaybackState(state);}

        }
      }
    });
    await Promise.all(['time-pos','duration','video-out-params','track-list','pause','paused-for-cache'].map((name,i)=>ipcCommand(state,['observe_property',i+1,name])));assertSession(state);
    emit(state,{type:'playback/stage',stage:'first-frame'});
    await ipcCommand(state,['loadfile',url]);assertSession(state);
    state.resolveCommands(true);
    // تمنع بقاء شاشة سوداء إلى الأبد عندما لا يُنتج المصدر إطارًا.
    // أعد فتح رابط الـproxy الداخلي *مرة واحدة*؛ يحتفظ rqbit بنفس الجلسة
    // والأجزاء التي وصلت، فلا يُعاد حل المغناطيس أو الاختيار أو الإعدادات.
    if(!state.ready) {
      // تورنت ينزل فعلًا (سرعة خلال آخر 15 ث): لا نعيد فتح الفيديو، فإعادة الفتح تهدم ما تجمّع في
      // ذاكرة mpv وتطيل البداية. ننتظر ما دام التنزيل يتحرك (ضمن مهلة البداية الكلية)، ونعيد المحاولة عند التوقف فقط.
      const flowing=()=>state.win&&state.demandFlowAt&&Date.now()-state.demandFlowAt<15000&&Date.now()-state.startedAt<90000;
      const waitWhileFlowing=()=>{
        if(state.stopped||current!==state||state.ready)return;
        if(flowing()){emit(state,{type:'playback/stage',stage:'downloading'});state.firstFrameWatchdog=setTimeout(waitWhileFlowing,10000);return;}
        recover();
      };
      const recover=()=>{
        if(state.stopped||current!==state||state.ready)return;
        emit(state,{type:'playback/retrying',message:'نعيد الاتصال بالفيديو مع إبقاء تنزيل التورنت نشطًا'});
        // Per-file --start survives normal initial loading, but retry explicitly
        // reapplies position and pause so a paused room never starts by itself.
        void ipcCommand(state,['loadfile',url,'replace',-1,`start=${position/1000},pause=${pause?'yes':'no'}`]).catch(()=>{});
        state.firstFrameWatchdog=setTimeout(()=>{
          if(!state.stopped&&current===state&&!state.ready)
            void fail(state,'لم يصل إطار فيديو بعد إعادة المحاولة؛ يمكنك تجربة سيرفر آخر');
        },firstFrameFailureMs);
      };
      state.startedAt??=Date.now();
      state.firstFrameWatchdog=setTimeout(waitWhileFlowing,firstFrameRecoveryMs);
    }
  }
  async function startPlayback({session,candidate,title,position=0,pause=false,ownerId='guest'}={}) {
    if(closed)throw new Error('أغلقت الخدمات');
    if(typeof session!=='string'||!session||session.length>200||!Number.isFinite(position)||position<0||typeof pause!=='boolean')throw new Error('جلسة أو موضع تشغيل غير صالح');
    if(typeof ownerId!=='string'||!/^[A-Za-z0-9_-]{1,200}$/.test(ownerId))throw new Error('هوية حساب غير صالحة');
    candidate=validateCandidate(candidate);
    const old=current,state={session,controller:new AbortController(),children:new Set(),pending:new Map(),requestId:0,progress:{},stopped:false};
    state.subtitleTracks=[];state.subtitleFiles=new Map();state.subtitleJobs=new Map();state.subtitleQueue=Promise.resolve();state.subtitleCatalog=new Map();state.subtitleSequence=0;
    state.cacheRecorders=new Set();state.torrentReaders=new Map();state.replayStore=candidate.infoHash?replayFor(ownerId):null;
    state.whenReady=new Promise(resolve=>state.resolveReady=resolve);
    state.whenCommands=new Promise(resolve=>state.resolveCommands=resolve);
    current=state;states.add(state);
    state.rangeSequence=0;state.trace=createStartupTrace(event=>emit(state,event));state.trace.record('source-selected',{fileIdx:candidate.fileIdx,mode:'cold'});
    state.budget=createPlaybackBudget({torrent:!!candidate.infoHash,onTimeout:reason=>{
      if(state.stopped||current!==state)return;
      emit(state,{type:'playback/recovery-needed',reason});
      void fail(state,reason==='startup'?'انتهت مهلة بدء المصدر؛ اختر سيرفرًا آخر':reason==='seek'?'لم يصل المقطع المطلوب؛ أعد المحاولة أو اختر سيرفرًا آخر':'توقف تقدم الفيديو؛ اختر سيرفرًا آخر');
    }});
    try{
      const startupError=await startup;if(startupError)throw startupError;assertSession(state);
      if(old){publish({type:'playback/closed',session:old.session,...old.progress});await cleanup(old);}assertSession(state);
      emit(state,{type:'playback/preparing',title:String(title??'VANTARA').replace(/[\x00-\x1f\x7f]/g,' ').slice(0,300)});
      let url;
      if(candidate.infoHash){
        state.replayEntry=await state.replayStore?.lookup({infoHash:candidate.infoHash,...(candidate.fileIdx!=null?{fileIdx:candidate.fileIdx}:{}),...(candidate.fileIdx==null&&candidate.filename?{filename:basename(String(candidate.filename).replaceAll('\\','/'))}:{})});
        state.trace.record('replay-lookup',{mode:state.replayEntry?'replay-descriptor':'cold'});
        assertSession(state);
        state.engineTask=engine(state,candidate);
        // The independent verified replay copy can supply container headers and
        // first frames while normal, fully checked rqbit discovery runs behind it.
        if(state.replayEntry)void state.engineTask.catch(error=>{if(!state.stopped)void fail(state,error.message);});
        else await state.engineTask;
        assertSession(state);url=await makeProxy(state,null,{},true);
      }else url=await makeProxy(state,candidate.url,candidate.headers);
      assertSession(state);await player(state,url,title,position,pause);assertSession(state);
      const embedded=(Array.isArray(candidate.subtitles)?candidate.subtitles:[]).slice(0,100).sort((a,b)=>Number(subtitleLanguage(b?.lang)==='ar')-Number(subtitleLanguage(a?.lang)==='ar'));
      for(const subtitle of embedded)void loadSubtitle(state,subtitle).catch(()=>{});
      return {started:true};
    }catch(e){const wasCancelled=state.stopped||current!==state||closed;if(!wasCancelled)emit(state,{type:'playback/error',message:e.message?.match(/ملف|fileIdx|هوية|DASH|تورنت|المصدر|المساحة|مساحة|كاش|حجم/)?e.message:'تعذر بدء تشغيل الفيديو'});await cleanup(state);if(current===state)current=null;if(state.failure)throw new Error(state.failure);if(wasCancelled)throw cancelled();throw new Error(e.message?.match(/ملف|fileIdx|هوية|DASH|تورنت|المصدر|المساحة|مساحة|كاش|حجم/)?e.message:'تعذر بدء تشغيل الفيديو');}
  }
  async function stopPlayback({session}={}) {
    const state=current;if(!state||state.session!==session)return;
    publish({type:'playback/closed',session:state.session,...state.progress});await cleanup(state);if(current===state)current=null;
  }
  async function downloadSubtitle(state,value) {
    const controller=new AbortController(),abort=()=>controller.abort();
    const download=state.subtitleDownload={url:value.url,controller,superseded:false};
    state.controller.signal.addEventListener('abort',abort,{once:true});
    const timer=setTimeout(abort,15000);let response;
    try {
      let url=value.url;
      for(let redirects=0;;redirects++) {
        response=await secureResponse(url,{headers:{Accept:'text/plain,application/x-subrip,text/vtt,text/x-ssa'},signal:controller.signal,timeout:15000,lookup});
        if(response.statusCode<300||response.statusCode>=400)break;
        if(redirects>=4||typeof response.headers.location!=='string')throw new Error('توجيه الترجمة تجاوز الحد أو أعاد رابطًا غير صالح');
        try { url=publicURL(new URL(response.headers.location,url).href).href; }
        catch { throw new Error('توجيه الترجمة إلى عنوان غير مسموح'); }
        response.destroy();
      }
      if(response.statusCode<200||response.statusCode>=300)throw new Error('تعذر تنزيل الترجمة؛ استجابة غير ناجحة');
      const validated=validateSubtitleText(await readResponse(response,2*1024*1024,data=>{
        const bom=data[0]===0xef&&data[1]===0xbb&&data[2]===0xbf?'utf-8':data[0]===0xff&&data[1]===0xfe?'utf-16le':data[0]===0xfe&&data[1]===0xff?'utf-16be':null;
        const declared=/charset\s*=\s*["']?([^;\s"']+)/i.exec(response.headers['content-type']??'')?.[1];
        if(bom||declared){try{return new TextDecoder(bom||declared).decode(data);}catch{throw new Error('ترميز ملف الترجمة غير مدعوم');}}
        if(value.lang==='ar'){try{return new TextDecoder('utf-8',{fatal:true}).decode(data);}catch{return new TextDecoder('windows-1256').decode(data);}}
        return data.toString('utf8');
      }));assertSession(state);
      const storage=await fs.statfs(userData,{bigint:true});assertSession(state);
      if(storage.bavail*storage.bsize<BigInt(Buffer.byteLength(validated.text))+8n*1024n**2n)throw new Error('المساحة لا تكفي لتنزيل الترجمة؛ حرر 8 ميغابايت على الأقل');
      if(!state.subtitleDir){state.subtitleDir=join(userData,'subtitle-cache',secret());await mkdir(state.subtitleDir,{recursive:true});assertSession(state);}
      const path=join(state.subtitleDir,`${secret()}.${validated.extension}`);
      await fs.writeFile(path,validated.text,{encoding:'utf8',flag:'wx',mode:0o600});assertSession(state);
      return path;
    } catch(error){
      if(download.superseded)throw Object.assign(new Error('اختيار ترجمة قديم'),{code:'SUBTITLE_SUPERSEDED'});
      throw error;
    } finally { if(state.subtitleDownload?.controller===controller)state.subtitleDownload=null;clearTimeout(timer);state.controller.signal.removeEventListener('abort',abort);response?.destroy(); }
  }
  function emitSubtitleTracks(state,message) {
    const pending=[...state.subtitleCatalog.values()].filter(track=>!state.subtitleFiles.has(track.url)).map(({id,lang,label})=>({id,lang,label,selected:false,origin:'addon'}));
    emit(state,{type:'playback/subtitles',tracks:[...state.subtitleTracks,...pending],...(message?{message}:{})});
  }
  function registerSubtitle(state,value) {
    if(!plain(value)||typeof value.url!=='string')throw new Error('طلب ترجمة غير صالح');
    const url=publicURL(value.url).href;
    if(!state.subtitleCatalog.has(url)){
      if(state.subtitleCatalog.size>=500)throw new Error('عدد نتائج الترجمة أكبر من الحد');
      state.subtitleCatalog.set(url,{id:--state.subtitleSequence,url,lang:subtitleLanguage(value.lang),label:subtitleLabel(value.label??value.lang??'ترجمة')});
      emitSubtitleTracks(state);
    }
  }
  function chooseSubtitle(state,url) {
    state.subtitleManual=true;state.subtitleWanted=url;
    if(state.subtitleDownload&&state.subtitleDownload.url!==url){state.subtitleDownload.superseded=true;state.subtitleDownload.controller.abort();}
  }
  function loadSubtitle(state,value) {
    assertSession(state);
    if(!plain(value)||typeof value.url!=='string'||value.select!=null&&typeof value.select!=='boolean')return Promise.reject(new Error('طلب ترجمة غير صالح'));
    let url;try{url=publicURL(value.url).href;}catch{return Promise.reject(new Error('رابط ترجمة غير مسموح'));}
    if(value.select===true)chooseSubtitle(state,url);
    const existing=state.subtitleFiles.get(url);
    if(existing)return value.select===true?ipcCommand(state,['set_property','sid',existing.id]):Promise.resolve();
    if(state.subtitleJobs.has(url)){
      const pending=state.subtitleJobs.get(url);
      if(state.subtitleDownload?.url===url&&state.subtitleDownload.superseded)return pending.catch(()=>{}).then(()=>{assertSession(state);if(state.subtitleWanted===url)return loadSubtitle(state,value);});
      return pending;
    }
    const subtitle={url,lang:subtitleLanguage(value.lang),label:subtitleLabel(value.label??value.lang??'ترجمة'),select:value.select};
    const job=state.subtitleQueue.then(async()=>{
      assertSession(state);
      if(state.subtitleManual&&state.subtitleWanted!==url)return;
      const loaded=[...state.subtitleFiles.values()];
      const atLimit=loaded.length>=8||subtitle.lang!=='ar'&&loaded.filter(s=>s.lang!=='ar').length>=4;
      if(atLimit&&subtitle.select!==true)throw new Error('وصلت الترجمات إلى الحد؛ يمكن تحميل 8 مسارات منها 4 بغير العربية');
      const path=await downloadSubtitle(state,subtitle);
      try {
        if(!await state.whenReady)throw cancelled();assertSession(state);
        if(state.subtitleManual&&state.subtitleWanted!==url){await rm(path,{force:true});return;}
        if(atLimit){
          const old=loaded.find(file=>Number.isSafeInteger(file.id)&&!state.subtitleTracks.some(track=>track.id===file.id&&track.selected)&&(subtitle.lang==='ar'||file.lang!=='ar'));
          if(!old)throw new Error('تعذر تحرير مسار ترجمة قديم؛ أعد الاختيار');
          await ipcCommand(state,['sub-remove',old.id]);state.subtitleFiles.delete(old.url);await rm(old.path,{force:true});
        }
        const selected=state.subtitleTracks.find(t=>t.selected);
        const automatic=!state.subtitleManual&&(!selected||subtitle.lang==='ar'&&selected.lang!=='ar');
        const select=state.subtitleManual?state.subtitleWanted===url:subtitle.select===true||subtitle.select!==false&&automatic;
        if(select)state.subtitleExpectedSelection={lang:subtitle.lang,label:subtitle.label};
        await ipcCommand(state,['sub-add',path,select?'select':'auto',subtitle.label,subtitle.lang]);assertSession(state);
        const all=await ipcCommand(state,['get_property','track-list']);assertSession(state);
        const track=Array.isArray(all)?all.filter(t=>t.type==='sub'&&(t['external-filename']===path||t.title===subtitle.label&&subtitleLanguage(t.lang)===subtitle.lang)).at(-1):null;
        if(!Number.isSafeInteger(track?.id))throw new Error('لم يسجل المشغل مسار الترجمة');
        state.subtitleFiles.set(url,{...subtitle,path,id:track.id});emitSubtitleTracks(state);
        if(subtitle.select===true)state.subtitleManual=true;
      } catch(error){state.subtitleExpectedSelection=null;await rm(path,{force:true}).catch(()=>{});throw error;}
    }).catch(error=>{
      if(error.code!=='SUBTITLE_SUPERSEDED'&&!state.stopped&&current===state&&(!state.subtitleManual||state.subtitleWanted===url))emitSubtitleTracks(state,error.message?.match(/ترجمة|ترجمات|المساحة|الحد/)?error.message:'تعذر تحميل الترجمة؛ يستمر الفيديو');
      throw error;
    }).finally(()=>{if(state.subtitleJobs.get(url)===job)state.subtitleJobs.delete(url);});
    state.subtitleJobs.set(url,job);state.subtitleQueue=job.catch(()=>{});
    return job;
  }
  async function playbackCommand({session,command,value}={}) {
    const state=current;if(!state||state.session!==session||state.stopped)throw new Error('جلسة تشغيل قديمة');
    if(!await state.whenCommands)throw cancelled();
    assertSession(state);
    if(command==='pause'&&typeof value==='boolean')await ipcCommand(state,['set_property','pause',value]);
    else if(command==='seek'&&Number.isFinite(value)&&value>=0){state.seekTarget=value;state.budget?.seek(value);await ipcCommand(state,['seek',value/1000,'absolute']);}
    else if(command==='rate'&&Number.isFinite(value)&&value>=0.95&&value<=1.05)await ipcCommand(state,['set_property','speed',value]);
    else if(command==='speed'&&Number.isFinite(value)&&value>=0.25&&value<=3)await ipcCommand(state,['set_property','speed',value]);
    else if(command==='video-fit'&&['fit','fill'].includes(value))await ipcCommand(state,['set_property','panscan',value==='fill'?1:0]);
    else if(command==='subtitle-position'&&Number.isFinite(value)&&value>=0&&value<=100)await ipcCommand(state,['set_property','sub-pos',value]);
    else if(command==='subtitle-background'&&['shadow','box'].includes(value)){
      // «ظل» = حدود وظل (افتراضي mpv)، «خلفية داكنة» = صندوق نصف شفاف خلف السطر كما في الجوال
      await ipcCommand(state,['set_property','sub-border-style',value==='box'?'opaque-box':'outline-and-shadow']);
      await ipcCommand(state,['set_property','sub-back-color',value==='box'?'#B3000000':'#00000000']);
    }
    else if(command==='volume'&&Number.isFinite(value)&&value>=0&&value<=100)await ipcCommand(state,['set_property','volume',value]);
    else if(command==='audio-select'&&Number.isSafeInteger(value)&&state.audioTracks?.some(t=>t.id===value))await ipcCommand(state,['set_property','aid',value]);
    else if(command==='subtitle-load')await loadSubtitle(state,value);
    else if(command==='subtitle-register')registerSubtitle(state,value);
    else if(command==='subtitle-off') {chooseSubtitle(state,null);await ipcCommand(state,['set_property','sid','no']);}
    else if(command==='subtitle-select'&&Number.isSafeInteger(value)&&value<0&&[...state.subtitleCatalog.values()].some(t=>t.id===value))await loadSubtitle(state,{...[...state.subtitleCatalog.values()].find(t=>t.id===value),select:true});
    else if(command==='subtitle-select'&&Number.isSafeInteger(value)&&state.subtitleTracks.some(t=>t.id===value)) {chooseSubtitle(state,null);await ipcCommand(state,['set_property','sid',value]);}
    else if(command==='subtitle-delay'&&Number.isFinite(value)&&Math.abs(value)<=60000)await ipcCommand(state,['set_property','sub-delay',value/1000]);
    else if(command==='subtitle-size'&&Number.isFinite(value)&&value>=20&&value<=80)await ipcCommand(state,['set_property','sub-font-size',value]);
    else throw new Error('أمر مشغل غير مسموح');
  }
  // Explicit native-embedding smoke hook: not registered on the renderer IPC bridge.
  // It verifies mpv's real input.conf mapping and client-message dispatch, NOT
  // whether a CI runner can focus a separate Win32 child with physical hardware.
  async function smokeMpvBinding({session,key}={}) {
    const state=current;
    if(!videoHost||!inputConf||!state||state.stopped||state.session!==session)throw new Error('Embedded MPV smoke session unavailable');
    if(key!=='F11'&&key!=='ESC')throw new Error('MPV smoke key is not allowed');
    if(!await state.whenCommands)throw cancelled();
    // IPC keypress is not a reliable substitute for physical Win32 HWND focus
    // on CI. Prove mpv loaded the actual mapping, then exercise the very same
    // script-message through its real IPC client-message dispatcher.
    const eventName=key==='F11'?'vantara-fullscreen':'vantara-back';
    const bindings=await ipcCommand(state,['get_property','input-bindings']);
    if(!Array.isArray(bindings)||!bindings.some(b=>String(b.key??'').toUpperCase()===key&&String(b.cmd??'').includes('script-message '+eventName)))
      throw new Error('MPV did not load the expected native key binding');
    return ipcCommand(state,['script-message',eventName]);
  }
  // Internal verification only: not registered on the renderer IPC bridge.
  async function inspectPlayback({session}={}){const s=current;if(!s||s.session!==session||s.stopped)throw new Error('جلسة تشغيل قديمة');const [video,subtitleDelay]=await Promise.all([ipcCommand(s,['get_property','video-out-params']),ipcCommand(s,['get_property','sub-delay'])]);return {video,subtitleDelay,diagnostics:s.trace.snapshot(),frameEvidence:{decoded:s.ready===true,rendered:'unmeasured'}};}
  async function close(){closed=true;for(const c of resourceControllers)c.abort();await startup;await Promise.all([...states].map(cleanup));await Promise.all([...replayCaches.values()].map(cache=>cache.close()));current=null;}
  return {requestResource,startPlayback,stopPlayback,playbackCommand,inspectPlayback,smokeMpvBinding,close};
}

export function validateTorrentStorage(file,availableBytes) {
  return validateStreamingHeadroom(file,availableBytes);
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
