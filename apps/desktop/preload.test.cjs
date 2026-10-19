const {test}=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const fs=require('node:fs');
test('the isolated Windows preload reports the packaged application version supplied by main',()=>{
 for(const [arg,expected]of [['--vantara-version=0.3.164','0.3.164'],['--vantara-version=0.2.9','0.2.9'],['--vantara-version=invalid','0.0.0']]){
  let bridge;
  vm.runInNewContext(fs.readFileSync(require.resolve('./preload.cjs'),'utf8'),{process:{argv:['VANTARA.exe',arg]},require:id=>{assert.equal(id,'electron');return{contextBridge:{exposeInMainWorld:(name,value)=>{assert.equal(name,'VantaraDesktop');bridge=value;}},ipcRenderer:{invoke(){},on(){},removeListener(){}}};}});
  assert.equal(bridge.version,expected);
 }
});
test('moment bridge exposes only prepare, release and bounded export IPC calls',()=>{
 let bridge;const calls=[];
 vm.runInNewContext(fs.readFileSync(require.resolve('./preload.cjs'),'utf8'),{process:{argv:[]},require:()=>({contextBridge:{exposeInMainWorld:(_name,value)=>bridge=value},ipcRenderer:{invoke:(...args)=>calls.push(args),on(){},removeListener(){}}})});
 for(const [method,channel]of [['prepareMoment','prepare-moment'],['releaseMoment','release-moment'],['exportMoment','export-moment'],['readMoment','read-moment']]){const request={session:'local'};bridge[method](request);assert.equal(calls.at(-1)[0],'vantara:'+channel);assert.equal(calls.at(-1)[1],request);}
});
