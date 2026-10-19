const {spawn:spawnProcess}=require('node:child_process');

function nativeWindowId(handle) {
  if(!Buffer.isBuffer(handle)||![4,8].includes(handle.length))throw new Error('مقبض نافذة الفيديو غير صالح');
  const value=handle.length===8?handle.readBigUInt64LE():BigInt(handle.readUInt32LE());
  if(!value)throw new Error('مقبض نافذة الفيديو غير صالح');
  return String(value);
}
function viewportBounds(value,contentSize,scale) {
  if(!value||!Number.isFinite(scale)||scale<=0||scale>16)throw new Error('مساحة الفيديو غير صالحة');
  for(const key of ['x','y','width','height','viewportWidth','viewportHeight'])if(!Number.isFinite(value[key])||value[key]<0||value[key]>32768)throw new Error('مساحة الفيديو غير صالحة');
  if(!value.viewportWidth||!value.viewportHeight)throw new Error('مساحة الفيديو غير صالحة');
  // CSS coordinates include page zoom; the HWND uses physical client pixels.
  const factorX=contentSize[0]/value.viewportWidth*scale,factorY=contentSize[1]/value.viewportHeight*scale;
  const x=Math.min(value.x,value.viewportWidth),y=Math.min(value.y,value.viewportHeight);
  return {x:Math.round(x*factorX),y:Math.round(y*factorY),width:Math.round(Math.min(value.width,value.viewportWidth-x)*factorX),height:Math.round(Math.min(value.height,value.viewportHeight-y)*factorY)};
}
function createVideoHost({getWindow,executable,scaleFactor=()=>1,spawn=spawnProcess,onFailure=()=>{}}) {
  let active=null,viewport=null,shellFullscreen=null;
  const write=(state,line)=>{if(state.child&&!state.closed&&!state.child.stdin.destroyed)state.child.stdin.write(line+'\n');};
  function resize() {
    const window=getWindow();if(!active?.windowId||!window||window.isDestroyed()||viewport?.session!==active.session)return;
    const b=viewportBounds(viewport,window.getContentSize(),scaleFactor(window.getBounds()));
    write(active,viewport.hidden||!b.width||!b.height?'hide':`bounds ${b.x} ${b.y} ${b.width} ${b.height}`);
  }
  async function release(state) {
    if(state.closing)return state.closing;
    state.closing=(async()=>{
      write(state,'close');state.closed=true;
      if(active===state)active=null;
      if(state.exited)return;
      await new Promise(resolve=>{
        const timer=setTimeout(()=>{state.child.kill();resolve();},1500);
        state.child.once('exit',()=>{clearTimeout(timer);resolve();});
      });
    })();return state.closing;
  }
  return {
    async acquire(session,signal) {
      if(active)await release(active);
      if(signal?.aborted)throw new Error('ألغيت جلسة الفيديو');
      const window=getWindow();if(!window||window.isDestroyed())throw new Error('نافذة الفيديو غير متاحة');
      const state={session,windowId:null,closed:false,exited:false};active=state;
      const child=state.child=spawn(executable,[nativeWindowId(window.getNativeWindowHandle()),String(process.pid)],{stdio:['pipe','pipe','ignore'],windowsHide:true,shell:false});
      try {
        state.windowId=await new Promise((resolve,reject)=>{
          let data='';const timeout=setTimeout(()=>done(new Error('انتهت مهلة نافذة الفيديو المدمجة')),10000);
          const abort=()=>done(new Error('ألغيت جلسة الفيديو'));
          function done(error,id){clearTimeout(timeout);signal?.removeEventListener('abort',abort);child.stdout.removeListener('data',receive);error?reject(error):resolve(id);}
          function receive(chunk){data+=chunk.toString('ascii');if(data.length>128)return done(new Error('استجابة نافذة الفيديو غير صالحة'));if(data.includes('\n')){const id=data.split('\n')[0].trim();/^\d{1,20}$/.test(id)&&BigInt(id)>0n?done(null,id):done(new Error('استجابة نافذة الفيديو غير صالحة'));}}
          child.stdout.on('data',receive);child.once('error',()=>done(new Error('تعذر تشغيل نافذة الفيديو المرفقة')));child.once('exit',()=>{state.exited=true;done(new Error('أغلقت نافذة الفيديو المدمجة'));if(!state.closed)onFailure(session);});
          signal?.addEventListener('abort',abort,{once:true});
        });
        if(signal?.aborted||active!==state)throw new Error('ألغيت جلسة الفيديو');
        if(shellFullscreen)write(state,`fullscreen ${shellFullscreen.windowId} ${shellFullscreen.enabled?1:0}`);
        resize();return {windowId:state.windowId,close:()=>release(state)};
      }catch(error){await release(state);throw error;}
    },
    viewport(value){
      if(typeof value?.session!=='string'||!value.session||value.session.length>200)throw new Error('جلسة الفيديو غير صالحة');
      if(active&&value.session!==active.session)throw new Error('جلسة الفيديو قديمة');
      const window=getWindow();viewportBounds(value,window.getContentSize(),scaleFactor(window.getBounds()));
      viewport={...value,hidden:value.hidden===true};resize();return true;
    },
    resize,
    fullscreen(enabled,handle){
      if(typeof enabled!=='boolean')throw new Error('طلب ملء الشاشة غير صالح');
      const windowId=nativeWindowId(handle);
      if(shellFullscreen?.windowId===windowId&&shellFullscreen.enabled===enabled)return;
      shellFullscreen={windowId,enabled};
      if(active?.windowId)write(active,`fullscreen ${windowId} ${enabled?1:0}`);
    },
    hide(){if(active)write(active,'hide');},
    show(){resize();},
    close:()=>active?release(active):Promise.resolve(),
    snapshot:()=>({session:active?.session??null,windowId:active?.windowId??null,embedded:!!active?.windowId}),
    inspect(){
      const state=active;if(!state?.windowId)return Promise.reject(new Error('نافذة الفيديو غير متاحة'));
      return new Promise((resolve,reject)=>{
        let buffer='';const timer=setTimeout(()=>finish(new Error('انتهت مهلة فحص نافذة الفيديو')),3000);
        const finish=(error,value)=>{clearTimeout(timer);state.child.stdout.removeListener('data',receive);error?reject(error):resolve(value);};
        const receive=chunk=>{buffer+=chunk.toString('utf8');if(buffer.length>65536)return finish(new Error('استجابة الفحص غير صالحة'));if(buffer.includes('\n')){try{const value=JSON.parse(buffer.split('\n')[0]);if(value.event==='inspect')finish(null,value);else finish(new Error('استجابة الفحص غير صالحة'));}catch{finish(new Error('استجابة الفحص غير صالحة'));}}};
        state.child.stdout.on('data',receive);write(state,'inspect');
      });
    },
  };
}
module.exports={nativeWindowId,viewportBounds,createVideoHost};
