const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {createPlaybackDiagnostics}=require('./playback-diagnostics.cjs');

function fixture(){
 const main=fs.readFileSync(require.resolve('./main.cjs'),'utf8');
 const start=main.indexOf("  register('start-playback', async args => {");
 const end=main.indexOf("  for (const [name, method]",start);
 assert.ok(start>=0&&end>start,'extract the actual main-process start handler');
 const diagnostics=createPlaybackDiagnostics({version:'0.3.16',platform:'win32'});
 const pending=[];let handler;
 const services={startPlayback(args){
  diagnostics.capture({type:'playback/preparing',session:args.session});
  return new Promise((resolve,reject)=>pending.push({resolve,reject}));
 }};
 vm.runInNewContext(`let playbackStartRequest=0;\n${main.slice(start,end)}`,{
  register:(name,fn)=>{assert.equal(name,'start-playback');handler=fn;},
  validateCandidate:candidate=>candidate,services,playbackDiagnostics:diagnostics,
 });
 return {handler,pending,diagnostics};
}

test('a canceled older start cannot mark a newer source failed when the UI session ID is reused',async()=>{
 const {handler,pending,diagnostics:d}=fixture();
 const first=handler({session:'same',candidate:{infoHash:'a'.repeat(40)}});
 const firstRejected=assert.rejects(first,/canceled/);
 const second=handler({session:'same',candidate:{infoHash:'b'.repeat(40)}});
 pending[0].reject(new Error('canceled old source'));
 await firstRejected;
 assert.equal(JSON.parse(d.export()).status,'preparing');
 d.capture({type:'playback/ready',session:'same'});
 pending[1].resolve({started:true});await second;
 const report=JSON.parse(d.export());
 assert.equal(report.status,'ready');assert.equal(report.source.infoHash,'b'.repeat(40));
 assert.equal(report.events.some(event=>event.type==='playback/error'),false);
});

test('the current start still records its failure after another attempt was superseded',async()=>{
 const {handler,pending,diagnostics:d}=fixture();
 const first=handler({session:'same',candidate:{infoHash:'a'.repeat(40)}});
 const firstRejected=assert.rejects(first,/canceled/);
 const second=handler({session:'same',candidate:{infoHash:'b'.repeat(40)}});
 const secondRejected=assert.rejects(second,/failed/);
 pending[1].reject(new Error('failed current source'));await secondRejected;
 const report=JSON.parse(d.export());assert.equal(report.status,'error');
 assert.equal(report.events.at(-1).errorClass,'start-failed');
 pending[0].reject(new Error('canceled old source'));await firstRejected;
 assert.equal(d.export(),JSON.stringify(report,null,2));
});
