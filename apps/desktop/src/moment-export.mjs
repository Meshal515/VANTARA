import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';

const invalid=()=>new Error('بيانات المقطع غير صالحة؛ اختر مدة حتى 70 ثانية');
export function validateMomentExport(value) {
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!['session','exportHandle','startMs','endMs','filename','action'].includes(key)))throw invalid();
  const {session,exportHandle,startMs,endMs,action}=value;
  if(typeof session!=='string'||!session||session.length>200||exportHandle!==undefined&&(typeof exportHandle!=='string'||!/^[a-f0-9]{48}$/.test(exportHandle))||!Number.isSafeInteger(startMs)||!Number.isSafeInteger(endMs)||startMs<0||endMs<=startMs||endMs-startMs>70000||!['save','share'].includes(action))throw invalid();
  let filename=value.filename??'VANTARA moment';
  if(typeof filename!=='string'||filename.length>120||/[<>:"/\\|?*\x00-\x1f\x7f]/.test(filename)||/[. ]$/.test(filename)||/^\./.test(filename)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(filename)||!filename.trim())throw invalid();
  filename=filename.replace(/\.mp4$/i,'')+'.mp4';
  return {session,...(exportHandle!==undefined?{exportHandle}:{}),startMs,endMs,filename,action};
}

// Only main-owned source proxies enter this module. Renderer requests never provide a URL.
export function createMomentExporter({mpv,videosDir,shareFile}) {
  function run(args,signal) {
    if(signal?.aborted)return Promise.reject(new Error('أُلغي تصدير المقطع'));
    return new Promise((resolve,reject)=>{
      let output='',done=false,stopError=null,killTimer=null;const child=spawn(mpv,args,{stdio:['ignore','pipe','pipe'],windowsHide:true,shell:false});
      const finish=(error)=>{if(done)return;done=true;clearTimeout(timer);clearTimeout(killTimer);signal?.removeEventListener('abort',abort);error?reject(error):resolve(output);};
      const stop=error=>{if(stopError)return;stopError=error;child.kill();killTimer=setTimeout(()=>child.kill('SIGKILL'),1000);};
      const abort=()=>stop(new Error('أُلغي تصدير المقطع'));
      const timer=setTimeout(()=>stop(new Error('انتهت مهلة تصدير المقطع؛ حاول من مصدر آخر')),180000);
      signal?.addEventListener('abort',abort,{once:true});
      child.stdout.on('data',data=>{output=(output+data.toString()).slice(-65536);});
      child.stderr.on('data',()=>{}); // Never expose source URLs or authentication from native diagnostics.
      child.once('error',()=>finish(new Error('تعذر تشغيل محرك تصدير المقطع')));
      child.once('close',code=>finish(stopError??(code===0?null:new Error('تعذر تصدير المقطع بهذا المصدر أو محرك الفيديو'))));
    });
  }
  async function duration(url,signal) {
    const marker='VANTARA_DURATION_'+randomBytes(12).toString('hex')+'=';
    const output=await run(['--no-config','--vo=null','--ao=null','--frames=1','--sid=no','--sub-auto=no','--term-playing-msg='+marker+'${=duration}','--',url],signal);
    const seconds=Number(new RegExp('(?:^|\\n)'+marker+'(\\d+(?:\\.\\d+)?)(?:\\r?\\n|$)').exec(output)?.[1]);
    if(!Number.isFinite(seconds)||seconds<=0)throw new Error('تعذر التحقق من مدة الفيديو لتصدير النطاق المحدد');
    return seconds*1000;
  }
  return {async exportClip({url,startMs,endMs,filename,action,signal}) {
    if(typeof videosDir!=='string'||!videosDir)throw new Error('مجلد الفيديو غير متاح');
    const sourceDuration=await duration(url,signal);
    if(endMs>sourceDuration)throw new Error('نهاية المقطع تتجاوز مدة الفيديو');
    const folder=join(videosDir,'VANTARA');await fs.mkdir(folder,{recursive:true});
    const work=await fs.mkdtemp(join(folder,'.moment-'));const output=join(work,'clip.mp4');
    try {
      await run(['--no-config','--no-terminal','--sid=no','--sub-auto=no','--hr-seek=yes',`--start=${startMs/1000}`,`--length=${(endMs-startMs)/1000}`,'--of=mp4','--ofopts=movflags=+faststart','--ovc=libx264',"--vf=lavfi=[scale=w='min(1280,iw)':h='min(720,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2],format=fmt=yuv420p",'--ovcopts=preset=veryfast,b=1200000,maxrate=1400000,bufsize=2800000','--oac=aac','--oacopts=b=96000',`--o=${output}`,'--',url],signal);
      const stat=await fs.stat(output);if(stat.size<32||stat.size>16*1024**2)throw new Error('لم ينتج محرك الفيديو مقطعًا صالحًا');
      const encodedDuration=await duration(output,signal);
      if(Math.abs(encodedDuration-(endMs-startMs))>100)throw new Error('لم يكتمل النطاق المحدد؛ أعد المحاولة بعد وصول الفيديو');
      if(signal?.aborted)throw new Error('أُلغي تصدير المقطع');
      const savedName=filename.replace(/\.mp4$/i,'')+'-'+randomBytes(6).toString('hex')+'.mp4';const file=join(folder,savedName);
      // link is exclusive: never overwrite a prior export or expose a partial file.
      await fs.link(output,file);
      const result={saved:true,path:file,filename:savedName,startMs,endMs};
      if(action==='share') {
        try {if(typeof shareFile!=='function')throw new Error();await shareFile(file);result.shareStatus='clipboard';}
        catch {result.shareStatus='unavailable';}
      }
      return result;
    }finally {await fs.rm(work,{recursive:true,force:true});}
  }};
}
