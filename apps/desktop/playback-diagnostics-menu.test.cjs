const {test}=require('node:test');
const assert=require('node:assert/strict');
const Module=require('node:module');
const os=require('node:os');
test('Help menu copies diagnostics only on explicit activation, including rejected playback starts',async t=>{
 let ready,menu,window;
 const loaded=new Promise(resolve=>ready=resolve),handlers=new Map(),copies=[];
 const electron={
  app:{setName(){},requestSingleInstanceLock:()=>true,on(){},whenReady:async()=>{},getPath:()=>os.tmpdir(),quit(){},exit(){}},
  clipboard:{writeText:text=>copies.push(text)},
  protocol:{registerSchemesAsPrivileged(){},handle(){}},ipcMain:{handle:(name,fn)=>handlers.set(name,fn)},net:{},
  Menu:{buildFromTemplate:value=>value,setApplicationMenu:value=>menu=value},
  BrowserWindow:class{constructor(){window=this;this.webContents={mainFrame:{url:'vantara://app/index.html'},setWindowOpenHandler(){},on(){},send(){}};}once(){}async loadURL(){ready();}},
 };
 const previous=Module._load;
 delete require.cache[require.resolve('./main.cjs')];
 t.after(()=>{delete require.cache[require.resolve('./main.cjs')];});
 Module._load=function(id,...args){return id==='electron'?electron:previous.call(this,id,...args);};
 try{require('./main.cjs');}finally{Module._load=previous;}
 await loaded;
 const item=menu.find(item=>item.role==='help')?.submenu.find(item=>item.label==='نسخ تشخيص تشغيل الفيديو');
 assert.ok(item,'Help menu exposes the diagnostic copy action');
 assert.equal(item.accelerator,'CmdOrCtrl+Shift+D');
 assert.deepEqual(copies,[]);
 item.click();assert.equal(JSON.parse(copies[0]).status,'none');
 const event={sender:window.webContents,senderFrame:window.webContents.mainFrame};
 await assert.rejects(handlers.get('vantara:start-playback')(event,{session:'private-session',candidate:{infoHash:'a'.repeat(40),fileIdx:0},ownerId:'invalid owner'}));
 assert.equal(copies.length,1,'playback failure does not overwrite clipboard');
 item.click();const report=JSON.parse(copies[1]);assert.equal(report.status,'error');
 assert.deepEqual(report.source,{kind:'torrent',infoHash:'a'.repeat(40),fileIdx:0});
 assert.equal(report.events.at(-1).errorClass,'start-failed');assert.doesNotMatch(copies[1],/private-session|invalid owner/);
 assert.throws(()=>handlers.get('vantara:start-playback')({sender:{},senderFrame:event.senderFrame},{session:'untrusted',candidate:{infoHash:'b'.repeat(40)}}));
 item.click();assert.equal(copies[2],copies[1]);
 assert.equal(handlers.has('vantara:copy-playback-diagnostics'),false,'renderer has no automatic clipboard IPC');
});
