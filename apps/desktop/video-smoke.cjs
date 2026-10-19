// Explicit local CLI smoke mode only. Real Electron HWND, compiled host, MPV,
// production renderer controls and IPC; only owned fixture transport is replaced.
const assert=require('node:assert/strict');
const http=require('node:http');
const https=require('node:https');
const dns=require('node:dns/promises');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {nativeWindowId}=require('./video-host.cjs');
async function until(fn,timeout=30000){const end=Date.now()+timeout;while(Date.now()<end){const value=await fn();if(value)return value;await new Promise(r=>setTimeout(r,80));}throw new Error('انتهت مهلة إثبات الفيديو المدمج');}
async function runEmbeddedVideoSmoke({window,videoHost,playerOverlay,native,fixture,reportPath,setServices,publish}) {
  const report={platform:process.platform,realMpv:true,realElectron:true,realEmbeddedChild:false,resized:false,rendererControls:false,cleanup:false};
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'vantara-embedded-proof-'));
  const {screen,desktopCapturer}=require('electron');
  const clip=await fs.readFile(fixture),srt=Buffer.from('1\n00:00:00,000 --> 00:00:03,000\nترجمة عربية مؤلفة للتحقق\n');
  const server=http.createServer((req,res)=>{
    const body=req.url.endsWith('.srt')?srt:clip,range=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range??'');
    const start=range?Number(range[1]):0,end=range&&range[2]?Math.min(Number(range[2]),body.length-1):body.length-1;
    if(start>=body.length){res.writeHead(416);return res.end();}
    res.writeHead(range?206:200,{'content-type':req.url.endsWith('.srt')?'text/plain; charset=utf-8':'video/mp4','content-length':end-start+1,...(range?{'content-range':`bytes ${start}-${end}/${body.length}`}:{})});res.end(body.subarray(start,end+1));
  });await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const previousDNS=dns.lookup,previousRequest=https.request;
  dns.lookup=async(host,opts)=>host==='owned.example.com'?[{address:'93.184.216.34',family:4}]:previousDNS(host,opts);
  https.request=(url,opts,callback)=>new URL(url).hostname==='owned.example.com'?http.request(`http://127.0.0.1:${server.address().port}${new URL(url).pathname}`,{method:opts.method,headers:opts.headers,signal:opts.signal},callback):previousRequest(url,opts,callback);
  const {createDesktopServices}=await import('./src/services.mjs'),events=[];
  const services=createDesktopServices({userData:dir,binaries:{mpv:path.join(native,'mpv.exe'),rqbit:path.join(native,'rqbit.exe')},videoHost,inputConf:path.join(__dirname,'native-host/input.conf'),onEvent:event=>{events.push(event);publish(event);}});
  await setServices(services);
  try{
    await window.loadURL('vantara://app/desktop/video-smoke.html');window.show();window.focus();
    report.stage='renderer-ready';await until(()=>window.webContents.executeJavaScript('window.VantaraVideoSmokeReady===true'));
    report.stage='start-playback';await services.startPlayback({session:'embedded-proof',candidate:{url:'https://owned.example.com/owned.mp4'},title:'فيديو VANTARA المؤلف',pause:true});
    report.stage='first-frame';await until(()=>events.some(e=>e.type==='playback/ready'&&e.embedded));
    report.stage='native-child';const parent=nativeWindowId(window.getNativeWindowHandle());
    let proof=await until(async()=>{const s=await videoHost.inspect();return s.children.some(c=>c.child&&c.parent===s.host&&/mpv/i.test(c.class))&&s.width>200&&s.height>100?s:false;});
    assert.equal(proof.parent,parent);report.realEmbeddedChild=true;report.initial=proof;
    report.stage='pause-controls';await window.webContents.executeJavaScript("document.querySelector('[data-action=\"pause\"]').click()");
    await until(()=>events.some(e=>e.type==='playback/pause'&&e.paused===false));
    report.stage='pause-controls';await window.webContents.executeJavaScript("document.querySelector('[data-action=\"pause\"]').click()");
    await until(()=>events.some(e=>e.type==='playback/pause'&&e.paused===true));
    await services.playbackCommand({session:'embedded-proof',command:'subtitle-load',value:{url:'https://owned.example.com/owned.srt',lang:'ar',label:'العربية'}});
    await until(()=>events.some(e=>e.type==='playback/subtitles'&&e.tracks.some(t=>t.lang==='ar'&&t.selected)));
    // Exercise the actual transparent overlay → main renderer → native MPV chain.
    report.stage='overlay-subtitles';const overlayWindow=await until(()=>playerOverlay?.window());
    await until(()=>overlayWindow.webContents.executeJavaScript('!!window.VantaraOverlayView'));
    await overlayWindow.webContents.executeJavaScript(`window.VantaraOverlayView.open.subtitles();[...document.querySelectorAll('button')].find(b=>b.textContent==='الضبط').click();`);
    await overlayWindow.webContents.executeJavaScript(`[...document.querySelectorAll('button')].find(b=>b.textContent==='أتأخر 0.5').click()`);
    await until(async()=>Math.abs((await services.inspectPlayback({session:'embedded-proof'})).subtitleDelay-.5)<.001);
    report.overlaySubtitleDelay=true;
    await overlayWindow.webContents.executeJavaScript('window.VantaraOverlayView.closeSheet()');
    report.stage='resize';const bounds=window.getBounds();window.setSize(bounds.width+160,bounds.height+100);
    proof=await until(async()=>{const s=await videoHost.inspect(),c=s.children.find(c=>/mpv/i.test(c.class));return s.width>report.initial.width&&s.height>report.initial.height&&c?.width===s.width&&c?.height===s.height?s:false;});
    report.resized=true;report.afterResize=proof;
    await window.webContents.executeJavaScript("const s=document.querySelector('[data-control=\"seek\"]');s.value='500';s.dispatchEvent(new Event('change'));document.querySelector('[data-action=\"fullscreen\"]').click()");
    await until(()=>events.some(e=>e.type==='playback/seek'&&e.position>=400));
    await until(()=>window.isFullScreen());report.fullscreen=true;
    const aligned=async()=>{
      const host=await videoHost.inspect(),content=window.getContentBounds(),overlay=overlayWindow.getBounds();
      const display=screen.getDisplayMatching(window.getBounds()),scale=display.scaleFactor;
      const child=host.children.find(c=>/mpv/i.test(c.class));
      const same=(a,b)=>Math.abs(a-b)<=1;
      report.lastBounds={host,content,overlay,fullscreen:window.isFullScreen(),shellFullscreen:host.shellFullscreen,menuBarVisible:window.isMenuBarVisible()};
      return host.shellFullscreen===window.isFullScreen()&&same(overlay.x,content.x)&&same(overlay.y,content.y)&&same(overlay.width,content.width)&&same(overlay.height,content.height)
        &&host.x===0&&host.y===0&&host.width===host.parentWidth&&host.height===host.parentHeight&&same(host.width,content.width*scale)&&same(host.height,content.height*scale)&&same(child?.width,host.width)&&same(child?.height,host.height)
        ?{host,content,overlay,display:display.bounds}:false;
    };
    report.stage='fullscreen-bounds';report.fullscreenBounds=await until(async()=>{
      const value=await aligned();if(!value)return false;
      return ['x','y','width','height'].every(key=>Math.abs(value.content[key]-value.display[key])<=1)?value:false;
    });
    overlayWindow.focus();await until(()=>overlayWindow.isFocused());
    const display=screen.getDisplayMatching(window.getBounds());
    const sources=await desktopCapturer.getSources({types:['screen'],thumbnailSize:{width:Math.round(display.size.width*display.scaleFactor),height:Math.round(display.size.height*display.scaleFactor)}});
    const capture=sources.find(source=>source.display_id===String(display.id));
    assert(capture&&!capture.thumbnail.isEmpty(),'Fullscreen desktop capture unavailable');
    await fs.writeFile(reportPath+'.fullscreen.png',capture.thumbnail.toPNG());
    const key=async(target,keyCode)=>{target.focus();await until(()=>target.isFocused());target.webContents.sendInputEvent({type:'keyDown',keyCode});target.webContents.sendInputEvent({type:'keyUp',keyCode});};
    report.stage='overlay-escape';await key(overlayWindow,'Escape');await until(()=>!window.isFullScreen());await until(aligned);report.overlayEscapeRestores=true;
    report.stage='main-f11';await key(window,'F11');await until(()=>window.isFullScreen());await until(aligned);report.mainF11=true;
    report.stage='overlay-f11';await key(overlayWindow,'F11');await until(()=>!window.isFullScreen());await until(aligned);report.overlayF11=true;
    // Deliver Win32 key messages to the real mpv child, which must use input.conf
    // and return through the production IPC/renderer fullscreen action.
    const nativeKey=(hwnd,key)=>{
      // PostMessage(WM_KEYDOWN) is not actual user input: mpv on Windows
      // may ignore it (no keyboard focus, missing scan-code context).
      // Focus the genuine mpv child and send real OS key events instead.
      assert(/^\d{1,20}$/.test(hwnd));
      const script=String.raw`Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class VantaraProofInput {
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr h, uint flags);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint from, uint to, bool attach);
  [DllImport("user32.dll")] public static extern IntPtr SetFocus(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetFocus();
  [DllImport("user32.dll")] public static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extra);
}
'@
$h=[IntPtr]::new([long]::Parse('${hwnd}'))
if(-not [VantaraProofInput]::IsWindow($h)){exit 2}
[uint32]$pid=0
$target=[VantaraProofInput]::GetWindowThreadProcessId($h,[ref]$pid)
$caller=[VantaraProofInput]::GetCurrentThreadId()
$root=[VantaraProofInput]::GetAncestor($h,2)
if(-not $target){exit 3}
$attached=[VantaraProofInput]::AttachThreadInput($caller,$target,$true)
try {
  [void][VantaraProofInput]::SetForegroundWindow($root)
  [void][VantaraProofInput]::SetFocus($h)
  if([VantaraProofInput]::GetFocus() -ne $h){exit 4}
} finally { if($attached){[void][VantaraProofInput]::AttachThreadInput($caller,$target,$false)} }
Start-Sleep -Milliseconds 80
[VantaraProofInput]::keybd_event([byte]${key},[byte]0,[uint32]0,[UIntPtr]::Zero)
Start-Sleep -Milliseconds 35
[VantaraProofInput]::keybd_event([byte]${key},[byte]0,[uint32]2,[UIntPtr]::Zero)
`;
      require('node:child_process').execFileSync('powershell.exe',
        ['-NoProfile','-NonInteractive','-Command',script],
        {windowsHide:true,timeout:15000});
    };
    const mpvChild=(await videoHost.inspect()).children.find(c=>/mpv/i.test(c.class));
    report.stage='native-f11';nativeKey(mpvChild.hwnd,0x7a);await until(()=>window.isFullScreen());await until(aligned);report.nativeF11=true;
    report.stage='native-escape';nativeKey(mpvChild.hwnd,0x1b);await until(()=>!window.isFullScreen());await until(aligned);report.nativeEscapeRestores=true;
    assert(await window.webContents.executeJavaScript('!!document.querySelector(".desktop-player")'));
    report.rendererControls=true;report.arabicSubtitleSelected=true;
    // Production HTML room and controls must hide the actual child HWND, not just cover it with CSS.
    report.stage='room';await window.webContents.executeJavaScript('window.VantaraVideoSmoke.enterRoom()');
    await until(()=>window.webContents.executeJavaScript('!!document.querySelector(".pp-lobby .pl-choose-server")'));
    await until(async()=>!(await videoHost.inspect()).visible);report.sharedRoomRenderer=true;report.roomHidesNativeVideo=true;
    await fs.writeFile(reportPath+'.room.png',(await window.webContents.capturePage()).toPNG());
    await window.webContents.executeJavaScript('document.querySelector(".pl-choose-server").click()');
    await until(()=>window.webContents.executeJavaScript('!!document.querySelector(".an-pick.ss")'));
    assert.equal((await videoHost.inspect()).visible,false);report.sharedServerPicker=true;
    await window.webContents.executeJavaScript('document.querySelector(".an-pick-back").click();document.querySelector(".pp-lobby .pl-go:not(.pl-choose-server)").click()');
    await until(()=>window.webContents.executeJavaScript('!!document.querySelector(".pl-count")'));
    assert.equal((await videoHost.inspect()).visible,false);
    await until(async()=>{const gone=await window.webContents.executeJavaScript('document.querySelector(".pp-lobby").hidden');return gone&&(await videoHost.inspect()).visible;});report.sharedCountdown=true;
    await window.webContents.executeJavaScript('document.querySelector("[data-action=settings]").click()');
    await until(async()=>!(await videoHost.inspect()).visible);
    const roomCommands=await window.webContents.executeJavaScript('window.VantaraVideoSmoke.commands.length');
    await window.webContents.executeJavaScript('const t=document.querySelector("[data-control=video-offset]");t.value="0.5";t.dispatchEvent(new Event("change"));');
    assert.equal(await window.webContents.executeJavaScript('window.VantaraVideoSmoke.commands.length'),roomCommands);report.localVideoTiming=true;
    await window.webContents.executeJavaScript('document.querySelector("[data-action=settings-close]").click()');
    await window.webContents.executeJavaScript("document.querySelector('[data-action=\"close\"]').click()");
    await until(()=>!videoHost.snapshot().embedded&&events.some(e=>e.type==='playback/closed'));report.cleanup=true;
    assert(!events.some(e=>e.type==='playback/error'));
    report.stage='complete';report.transport='owned MP4/subtitle fixture; real HWND/video/renderer/IPC';
  }catch(error){report.error=error.message;throw error;}
  finally{report.nativeHost=videoHost.snapshot();report.playbackEvents=events.filter(e=>!['playback/progress','playback/state'].includes(e.type)).slice(-80).map(({type,stage,message,embedded})=>({type,stage,message,embedded}));await services.close();https.request=previousRequest;dns.lookup=previousDNS;server.closeAllConnections();await new Promise(r=>server.close(r));await fs.rm(dir,{recursive:true,force:true});await fs.writeFile(reportPath,JSON.stringify(report,null,2));}
  return report;
}
module.exports={runEmbeddedVideoSmoke};
