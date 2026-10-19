const {test}=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {PassThrough}=require('node:stream');
const {nativeWindowId,viewportBounds,createVideoHost}=require('./video-host.cjs');
test('native HWND stays lossless and comes only from Electron',()=>{
  const handle=Buffer.alloc(8);handle.writeBigUInt64LE(0xfedcba9876543210n);
  assert.equal(nativeWindowId(handle),'18364758544493064720');
  assert.throws(()=>nativeWindowId(Buffer.alloc(8)),/نافذة/);
});
test('viewport validates and clips renderer CSS coordinates at zoom and DPI',()=>{
  assert.deepEqual(viewportBounds({x:10,y:60,width:800,height:500,viewportWidth:1000,viewportHeight:700},[1000,700],1.5),{x:15,y:90,width:1200,height:750});
  assert.deepEqual(viewportBounds({x:0,y:60,width:900,height:900,viewportWidth:900,viewportHeight:700},[900,700],1),{x:0,y:60,width:900,height:640});
  for(const bad of [{x:NaN},{x:-1},{width:1e9},{viewportWidth:0}])assert.throws(()=>viewportBounds({...{x:0,y:0,width:10,height:10,viewportWidth:100,viewportHeight:100},...bad},[100,100],1),/الفيديو/);
});
test('host is acquired once, resized in the main client area, and closed per session',async()=>{
  const child=new EventEmitter();child.stdout=new PassThrough();child.stdin=new PassThrough();child.kill=()=>child.emit('exit',0);let writes='';child.stdin.on('data',x=>writes+=x);
  const handle=Buffer.alloc(8);handle.writeBigUInt64LE(123n);let spawned;
  const win={getNativeWindowHandle:()=>handle,getContentSize:()=>[900,700],getBounds:()=>({}),webContents:{getZoomFactor:()=>1},isDestroyed:()=>false};
  const host=createVideoHost({getWindow:()=>win,executable:'owned-host.exe',scaleFactor:()=>1,spawn:(exe,args,opts)=>{spawned={exe,args,opts};queueMicrotask(()=>child.stdout.write('456\n'));return child;}});
  host.fullscreen(true,handle);
  host.viewport({session:'one',x:0,y:60,width:900,height:430,viewportWidth:900,viewportHeight:700});
  const surface=await host.acquire('one');assert.equal(surface.windowId,'456');assert.equal(spawned.args[0],'123');assert.equal(spawned.opts.shell,false);
  assert.match(writes,/bounds 0 60 900 430/);assert.match(writes,/fullscreen 123 1/);
  host.fullscreen(false,handle);assert.match(writes,/fullscreen 123 0/);
  assert.throws(()=>host.viewport({session:'old',x:0,y:0,width:10,height:10,viewportWidth:900,viewportHeight:700}),/جلسة/);
  await surface.close();assert.match(writes,/close/);assert.equal(host.snapshot().windowId,null);
});
