// Main-process boundary: do not trust even the upstream diagnostic sanitizer.
// Only fixed stage names, numeric metrics and fixed classifications leave here.
const numeric=new Set(['fileIdx','fileBytes','knownPeers','connectedPeers','speedBytes','checkedBytes','checkedPieces','requestedPiece','rangeStart','rangeEnd','cursor','bytes','waitMs','position','cacheBytesRead','requestId']);
const modes=new Set(['cold','replay-descriptor','cache','torrent','network','decoded','render-unmeasured']);
const traceStages=new Set(['source-selected','http-range','http-headers','http-first-byte','range-first-byte','first-useful-piece','engine-start','engine-ready','magnet-metadata-start','magnet-metadata-complete','file-selected','torrent-sample','peer-connected','player-start','player-ipc-ready','decoder-output','container-metadata-ready','stable-playback','replay-lookup']);
const lifecycle=new Set(['playback/preparing','playback/ready','playback/closed','playback/error','playback/retrying','playback/recovery-needed']);
const stages=new Set(['engine-start','metadata','file-selected','downloading','player-start','first-frame']);
const reasons=new Set(['startup','seek','stalled']);
function errorClass(event){
 if(event.code==='START_FAILED')return 'start-failed';
 const message=typeof event.message==='string'?event.message.slice(0,2000):'';
 if(/نافذة الفيديو/.test(message))return 'video-host';
 if(/مهلة/.test(message))return 'timeout';
 if(/إطار فيديو/.test(message))return 'first-frame';
 if(/مساحة|المساحة/.test(message))return 'storage';
 if(/fileIdx|ملف/.test(message))return 'file-selection';
 if(/تورنت/.test(message))return 'torrent';
 if(/كاش/.test(message))return 'cache';
 return 'playback-failed';
}
function createPlaybackDiagnostics({version,platform,clock=()=>performance.now()}={}){
 const metadata={format:'vantara-playback-diagnostics-v1',version:/^\d+\.\d+\.\d+$/.test(version)?version:'unknown',platform:['win32','linux','darwin'].includes(platform)?platform:'unknown'};
 let session=null,started=0,status='none',source=null,events=[],prepared=false;
 function begin(id,candidate={}){
  if(typeof id!=='string'||!id||id.length>200)return;
  session=id;started=clock();status='starting';events=[];prepared=false;
  const hash=typeof candidate.infoHash==='string'?candidate.infoHash.toLowerCase():'';
  source=/^[a-f0-9]{40}$/.test(hash)?{kind:'torrent',infoHash:hash,...(Number.isSafeInteger(candidate.fileIdx)&&candidate.fileIdx>=0?{fileIdx:candidate.fileIdx}:{})}:{kind:'direct'};
 }
 function capture(event){
  if(!event||!session||event.session!==session)return;
  const replacing=status==='closed'&&!prepared&&event.type==='playback/preparing';
  if((status==='closed'||status==='error')&&event.type!=='playback/closed'&&!replacing)return;
  const row={type:event.type,elapsedMs:Math.max(0,Math.round(clock()-started))};
  if(event.type==='playback/diagnostic'){
   if(!traceStages.has(event.stage))return;
   row.stage=event.stage;
   if(Number.isFinite(event.elapsedMs)&&event.elapsedMs>=0)row.traceElapsedMs=event.elapsedMs;
   for(const key of numeric)if(Number.isFinite(event[key])&&event[key]>=0)row[key]=event[key];
   if(modes.has(event.mode))row.mode=event.mode;
  }else if(event.type==='playback/stage'){
   if(!stages.has(event.stage))return;
   row.stage=event.stage;
  }else if(!lifecycle.has(event.type))return;
  if(event.type==='playback/preparing'){
   // Source replacement reuses the UI session: services closes the preceding
   // source after source-selected but before this new preparing event.
   if(replacing)events=events.filter(row=>row.type!=='playback/closed');
   prepared=true;status='preparing';
  }
  if(event.type==='playback/ready')status='ready';
  if(event.type==='playback/closed')status='closed';
  if(event.type==='playback/error'){status='error';row.errorClass=errorClass(event);}
  if(event.type==='playback/recovery-needed'&&reasons.has(event.reason))row.reason=event.reason;
  events.push(row);if(events.length>256)events.shift();
 }
 return {begin,capture,export:()=>JSON.stringify({...metadata,status,source,events},null,2)};
}
module.exports={createPlaybackDiagnostics};
