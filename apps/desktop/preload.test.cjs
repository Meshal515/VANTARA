const {test}=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const fs=require('node:fs');
test('the isolated Windows preload reports the packaged application version supplied by main',()=>{
 for(const [arg,expected]of [['--vantara-version=0.3.164','0.3.164'],['--vantara-version=0.2.9','0.2.9'],['--vantara-version=invalid','0.0.0']]){
  let bridge;
  vm.runInNewContext(fs.readFileSync(require.resolve('./preload.cjs'),'utf8'),{process:{argv:['VANTARA.exe',arg]},require:id=>{assert.equal(id,'electron');return{contextBridge:{exposeInMainWorld:(name,value)=>{assert.equal(name,'VantaraDesktop');bridge=value;}},ipcRenderer:{invoke(){},on(){},removeListener(){}}};}});
  assert.equal(bridge.version,expected);
 }
});
test('the preload exposes the stamped channel identity and rejects malformed values',()=>{
 const load=argv=>{let bridge;vm.runInNewContext(fs.readFileSync(require.resolve('./preload.cjs'),'utf8'),{process:{argv:['VANTARA.exe',...argv]},require:()=>({contextBridge:{exposeInMainWorld:(_n,v)=>{bridge=v;}},ipcRenderer:{invoke(){},on(){},removeListener(){}}})});return bridge;};
 const debug=load(['--vantara-version=0.4.12','--vantara-channel=debug','--vantara-build=12','--vantara-source=abcdef1234567','--vantara-built=2026-11-13T10:00:00.000Z']);
 assert.deepEqual([debug.version,debug.channel,debug.build,debug.sourceSha,debug.builtAt],['0.4.12','debug',12,'abcdef1234567','2026-11-13T10:00:00.000Z']);
 const legacy=load(['--vantara-version=0.0.215']);
 assert.deepEqual([legacy.channel,legacy.build,legacy.sourceSha],['stable',null,null]);
 const hostile=load(['--vantara-channel=nightly','--vantara-build=-3','--vantara-source=../x']);
 assert.deepEqual([hostile.channel,hostile.build,hostile.sourceSha],['stable',null,null]);
});
