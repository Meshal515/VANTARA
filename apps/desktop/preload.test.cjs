const {test}=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const fs=require('node:fs');
test('the isolated Windows preload reports the packaged application version supplied by main',()=>{
 for(const [arg,expected]of [['--vantara-version=0.3.164','0.3.164'],['--vantara-version=0.2.9','0.2.9'],['--vantara-version=invalid','0.0.0']]){
  let bridge;
  vm.runInNewContext(fs.readFileSync(require.resolve('./preload.cjs'),'utf8'),{process:{argv:['VANTARA.exe',arg]},require:id=>{assert.equal(id,'electron');return{contextBridge:{exposeInMainWorld:(name,value)=>{assert.equal(name,'VantaraDesktop');bridge=value;}},ipcRenderer:{invoke(){},on(){},removeListener(){}}};}});
  assert.equal(bridge.version,expected);
 }
});
