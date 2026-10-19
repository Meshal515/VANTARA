// Own-fixture Chromium proof: actual selected-range encoding, duration, format and cancellation.
const { createServer } = require('node:http');
const { readFileSync, writeFileSync, mkdtempSync } = require('node:fs');
const { join, extname } = require('node:path');
const { tmpdir } = require('node:os');
const { execFileSync } = require('node:child_process');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fixture = mkdtempSync(join(tmpdir(), 'vantara-moment-export-'));
execFileSync('ffmpeg', ['-hide_banner','-loglevel','error','-y','-f','lavfi','-i','testsrc2=size=320x180:rate=30','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','8','-c:v','libx264','-preset','ultrafast','-g','60','-pix_fmt','yuv420p','-c:a','aac','-movflags','+faststart',join(fixture,'source.mp4')]);
execFileSync('ffmpeg', ['-hide_banner','-loglevel','error','-y','-i',join(fixture,'source.mp4'),'-c','copy','-hls_time','2','-hls_list_size','0',join(fixture,'source.m3u8')]);
const web = join(__dirname, '../../apps/web');
const serve = (req,res) => {
  if (req.url === '/') {res.setHeader('content-type','text/html');return res.end('<!doctype html><meta charset="utf-8"><body><script type="module">import {exportBrowserMoment} from "/lib/moment-export.js";window.exportMoment=exportBrowserMoment;</script>');}
  try {
    const isFixture=/^\/source/.test(req.url);
    const file=join(isFixture?fixture:web,req.url);
    const bytes=readFileSync(file);
    res.setHeader('content-type',({'.js':'text/javascript','.mp4':'video/mp4','.m3u8':'application/vnd.apple.mpegurl','.ts':'video/mp2t'})[extname(file)]||'application/octet-stream');
    res.setHeader('accept-ranges','bytes');
    const range=/bytes=(\d+)-(\d*)/.exec(req.headers.range||'');
    if(range){const start=Number(range[1]),end=range[2]?Number(range[2]):bytes.length-1;res.statusCode=206;res.setHeader('content-range',`bytes ${start}-${end}/${bytes.length}`);res.setHeader('content-length',end-start+1);res.end(bytes.subarray(start,end+1));}else{res.setHeader('content-length',bytes.length);res.end(bytes);}
  } catch {res.statusCode=404;res.end();}
};
const server=createServer(serve), other=createServer(serve);
(async()=>{
  await Promise.all([new Promise(r=>server.listen(0,'127.0.0.1',r)),new Promise(r=>other.listen(0,'127.0.0.1',r))]);
  const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']});
  try {
    const page=await browser.newPage();
    await page.goto('http://127.0.0.1:'+server.address().port);
    await page.waitForFunction(()=>window.exportMoment);
    for(const source of ['/source.mp4','/source.m3u8']) {
      const downloaded=page.waitForEvent('download');
      const result=await page.evaluate(async source=>{
        const result=await window.exportMoment({source,startMs:2000,endMs:5000,filename:'selected.mp4'});
        const blob=await fetch(result.url).then(r=>r.blob());
        const bytes=new Uint8Array(await blob.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));
        URL.revokeObjectURL(result.url);
        return {...result,type:blob.type,size:blob.size,base64:btoa(binary),videos:document.querySelectorAll('video').length};
      },source);
      const download=await downloaded;
      const output=join(fixture,source.includes('m3u8')?'hls-'+result.filename:result.filename);
      writeFileSync(output,Buffer.from(result.base64,'base64'));
      const packets=JSON.parse(execFileSync('ffprobe',['-v','error','-show_packets','-show_entries','packet=pts_time,duration_time','-of','json',output],{encoding:'utf8'})).packets;
      const duration=Math.max(...packets.map(p=>Number(p.pts_time||0)+Number(p.duration_time||0)));
      assert.ok(duration>=2.7&&duration<=3.35,`actual clip duration ${duration}, selected 3 seconds from an 8-second source`);
      assert.ok(result.size>1000&&result.size<=16*1024*1024);
      assert.equal(result.clipped,true);
      assert.equal(result.videos,0);
      assert.equal(await download.failure(),null);
      assert.equal(result.filename.endsWith('.mp4'),result.type.startsWith('video/mp4'));
      console.log('PASS actual captured interval + download',source,result.type,result.size,'bytes',duration,'seconds');
    }
    const abort=await page.evaluate(async()=>{
      const controller=new AbortController();setTimeout(()=>controller.abort(),500);
      try {await window.exportMoment({source:'/source.mp4',startMs:0,endMs:6000,signal:controller.signal});return 'unexpected success';}
      catch(error){return {name:error.name,videos:document.querySelectorAll('video').length};}
    });
    assert.deepEqual(abort,{name:'AbortError',videos:0});
    console.log('PASS mid-recording cancellation and media cleanup');
    const blocked=await page.evaluate(async source=>{
      try {await window.exportMoment({source,startMs:0,endMs:1000});return 'unexpected success';}catch(error){return error.message;}
    },'http://127.0.0.1:'+other.address().port+'/source.mp4');
    assert.match(blocked,/CORS|source|capture/i);
    console.log('PASS cross-origin media refuses false success');
    console.log('Artifacts:',fixture);
  } finally {await browser.close();await Promise.all([new Promise(r=>server.close(r)),new Promise(r=>other.close(r))]);}
})().catch(error=>{console.error(error);server.close();other.close();process.exitCode=1;});
