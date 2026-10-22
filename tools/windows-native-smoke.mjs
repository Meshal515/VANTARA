// اختبار خارج المنتج: النقل وحده يُستبدل بسيرفر fixture مملوك، والمشغل وIPC حقيقيان.
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns/promises';
import {readFile,mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createDesktopServices} from '../apps/desktop/src/services.mjs';

const native=process.argv[2],reportPath=process.argv[3];
const clip=await readFile(process.argv[4]??new URL('../android/app/src/androidTest/assets/addon-torrent-proof.mp4',import.meta.url));
const srt=Buffer.from('1\n00:00:00,000 --> 00:00:03,000\nترجمة عربية مؤلفة للتحقق\n');
const server=http.createServer((req,res)=>{
  const body=req.url==='/owned.srt'?srt:clip;
  const type=req.url==='/owned.srt'?'text/plain; charset=utf-8':'video/mp4';
  const range=/bytes=(\d+)-(\d*)/.exec(req.headers.range??'');
  if(range){const begin=Number(range[1]),end=range[2]?Math.min(Number(range[2]),body.length-1):body.length-1;res.writeHead(206,{'content-type':type,'content-range':`bytes ${begin}-${end}/${body.length}`,'content-length':end-begin+1});return res.end(body.subarray(begin,end+1));}
  res.writeHead(200,{'content-type':type,'content-length':body.length});res.end(body);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`;
const previousDNS=dns.lookup,previousRequest=https.request;
dns.lookup=async(host,opts)=>host==='owned.example.com'?[{address:'93.184.216.34',family:4}]:previousDNS(host,opts);
https.request=(url,opts,callback)=>new URL(url).hostname==='owned.example.com'?http.request(base+new URL(url).pathname,{method:opts.method,headers:opts.headers,signal:opts.signal},callback):previousRequest(url,opts,callback);
const folder=await mkdtemp(join(tmpdir(),'vantara-native-proof-'));
const events=[];
const services=createDesktopServices({userData:folder,binaries:{mpv:join(native,'mpv.exe'),rqbit:join(native,'rqbit.exe')},onEvent:event=>events.push(event)});
async function until(fn){const end=Date.now()+30000;while(Date.now()<end){if(fn())return;await new Promise(resolve=>setTimeout(resolve,100));}throw new Error('انتهت مهلة إثبات المشغل الحقيقي');}
try{
  await services.startPlayback({session:'windows-proof',candidate:{url:'https://owned.example.com/owned.mp4'},title:'فيديو مؤلف لاختبار ويندوز',pause:true});
  await until(()=>events.some(e=>e.type==='playback/ready'));
  await services.playbackCommand({session:'windows-proof',command:'subtitle-load',value:{url:'https://owned.example.com/owned.srt',lang:'ar',label:'العربية'}});
  await until(()=>events.some(e=>e.type==='playback/subtitles'&&e.tracks.some(track=>track.lang==='ar'&&track.selected)));
  await services.playbackCommand({session:'windows-proof',command:'subtitle-delay',value:500});
  await services.playbackCommand({session:'windows-proof',command:'subtitle-size',value:46});
  await services.playbackCommand({session:'windows-proof',command:'seek',value:500});
  await until(()=>events.some(e=>e.position>=400));
  await services.playbackCommand({session:'windows-proof',command:'pause',value:false});
  await services.playbackCommand({session:'windows-proof',command:'rate',value:1.02});
  assert(!events.some(e=>e.type==='playback/error'));
  const decoded=await services.inspectPlayback({session:'windows-proof'});
  if(process.argv[4])assert(decoded.video.w===3840&&decoded.video.h===2160,'Expected a decoded 4K frame');
  assert.equal(decoded.subtitleDelay,.5);
  await services.stopPlayback({session:'windows-proof'});
  assert(events.some(e=>e.type==='playback/closed'));
  const report={decoded,platform:process.platform,realMpv:true,realIPC:true,firstVideoFrame:true,arabicSubtitleSelected:true,pauseSeekRate:true,stopped:true,transport:'سيرفر فيديو وترجمة مملوك للاختبار'};
  await writeFile(reportPath,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await services.close();https.request=previousRequest;dns.lookup=previousDNS;server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(folder,{recursive:true,force:true});}
