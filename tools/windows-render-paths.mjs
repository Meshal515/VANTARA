// Owned local-file render experiment. Does not change application defaults or CI acceptance.
import cp from 'node:child_process';
import fs from 'node:fs/promises';
import net from 'node:net';
import {randomBytes} from 'node:crypto';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {performance} from 'node:perf_hooks';
import {assessRealtimePlayback} from './torrent-validation.mjs';
import {softwareRenderPolicyLua} from '../apps/desktop/src/mpv-render-policy.mjs';
import {framePixels} from './torrent-startup-benchmark.mjs';

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
export const renderPaths=[
  ['default',[]],
  ['next-fast',['--profile=fast']],
  ['gpu-fast',['--vo=gpu','--gpu-api=d3d11','--profile=fast']],
  ['gpu-fast-no-vsync',['--vo=gpu','--gpu-api=d3d11','--profile=fast','--d3d11-sync-interval=0']],
  ['direct3d',['--vo=direct3d']],
  ['direct3d-sw-fast',['--vo=direct3d','--profile=sw-fast']],
];
async function ipc(pipe){
  let socket;
  for(let i=0;i<200;i++){
    try{socket=await new Promise((r,j)=>{const s=net.createConnection(pipe);s.once('connect',()=>r(s));s.once('error',j);});break;}catch{await sleep(25);}
  }
  if(!socket)throw new Error('MPV did not open IPC');
  const pending=new Map();let buffer='',id=0;
  socket.on('data',b=>{buffer+=b;while(buffer.includes('\n')){const n=buffer.indexOf('\n'),line=buffer.slice(0,n);buffer=buffer.slice(n+1);let m;try{m=JSON.parse(line);}catch{continue;}const p=pending.get(m.request_id);if(p){pending.delete(m.request_id);clearTimeout(p.timer);m.error==='success'?p.resolve(m.data):p.reject(new Error(m.error));}}});
  return {send(command){return new Promise((resolve,reject)=>{const request_id=++id,timer=setTimeout(()=>{pending.delete(request_id);reject(new Error('IPC command deadline'));},3000);pending.set(request_id,{resolve,reject,timer});socket.write(JSON.stringify({command,request_id})+'\n');});},close(){socket.destroy();for(const p of pending.values()){clearTimeout(p.timer);p.reject(new Error('IPC closed'));}pending.clear();}};
}
function command(binary,args){return new Promise((r,j)=>{const child=cp.spawn(binary,args,{windowsHide:true,stdio:['ignore','pipe','pipe']}),out=[],err=[];child.stdout.on('data',b=>out.push(b));child.stderr.on('data',b=>err.push(b));child.once('error',j);child.once('exit',c=>c===0?r(Buffer.concat(out)):j(new Error(Buffer.concat(err).toString().slice(-1000))));});}
async function status(c){const names=['time-pos','pause','paused-for-cache','frame-drop-count','decoder-frame-drop-count','vo-delayed-frame-count','video-params','video-out-params','video-codec','container-fps','current-vo','hwdec-current','display-fps','estimated-display-fps'];return Object.fromEntries(await Promise.all(names.map(async n=>[n,await c.send(['get_property',n]).catch(()=>null)])));}
export async function main(argv=process.argv.slice(2)){
  const [mpv,ffmpeg,file,output]=argv; if(!output)throw new Error('Usage: mpv ffmpeg owned-file output');
  const root=resolve(output);await fs.mkdir(root,{recursive:true});const rows=[];
  const script=join(root,'software-render.lua');await fs.writeFile(script,softwareRenderPolicyLua);
  const paths=[...renderPaths,['conditional-fast',[`--script=${script}`]]];
  for(const [label,args] of paths){
    const row={label,args,passed:false};rows.push(row);let child,c;
    try{
      const pipe=process.platform==='win32'?`\\\\.\\pipe\\vantara-render-${randomBytes(8).toString('hex')}`:join(root,`${label}.sock`);
      child=cp.spawn(mpv,['--no-config','--idle=yes','--force-window=yes','--terminal=no','--hwdec=auto-safe','--ao=null','--osc=no',`--input-ipc-server=${pipe}`,`--log-file=${join(root,label+'.log')}`,...args],{windowsHide:true,stdio:'ignore'});
      c=await ipc(pipe);await c.send(['loadfile',resolve(file)]);
      const deadline=performance.now()+15000;
      do{row.initial=await status(c);if(row.initial['time-pos']>.05&&row.initial.pause===false&&row.initial['paused-for-cache']===false)break;await sleep(50);}while(performance.now()<deadline);
      await c.send(['set_property','screenshot-png-compression',0]);
      const screenshot=join(root,label+'.png');await c.send(['screenshot-to-file',screenshot,'window']);
      row.image=framePixels(await command(ffmpeg,['-v','error','-i',screenshot,'-vf','scale=64:36','-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','pipe:1']));
      const started=performance.now(),samples=[];
      do{const s=await status(c);samples.push({atSeconds:(performance.now()-started)/1000,position:s['time-pos'],paused:s.pause,buffering:s['paused-for-cache'],droppedFrames:s['frame-drop-count'],decoderDroppedFrames:s['decoder-frame-drop-count'],delayedFrames:s['vo-delayed-frame-count']});await sleep(250);}while(performance.now()-started<10250);
      row.final=await status(c);row.samples=samples;row.assessment=assessRealtimePlayback(samples,{seconds:10,fps:row.final['container-fps']});
      row.passed=row.image.nonblack&&row.assessment.passed&&row.final['video-params']?.w>0;
    }catch(e){row.error=e.message;}finally{c?.close();if(child&&child.exitCode===null){child.kill();await Promise.race([new Promise(r=>child.once('exit',r)),sleep(1500)]);if(child.exitCode===null)child.kill('SIGKILL');}}
    await fs.writeFile(join(root,'results.json'),JSON.stringify({file:resolve(file),rows},null,2));
    console.log(JSON.stringify({label,passed:row.passed,error:row.error,assessment:row.assessment,vo:row.final?.['current-vo'],hwdec:row.final?.['hwdec-current']}));
  }
  return rows;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().then(rows=>{if(!rows.some(r=>r.passed))process.exitCode=1;}).catch(e=>{console.error(e);process.exitCode=1;});
