const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createPlaybackDiagnostics}=require('./playback-diagnostics.cjs');
const hash='a'.repeat(40);
function fixture(){let now=100;const diagnostics=createPlaybackDiagnostics({version:'0.3.16',platform:'win32',clock:()=>now});return {diagnostics,tick:()=>now+=5};}
test('exports only allowed metrics and validated public source identity, never arbitrary strings',()=>{
 const {diagnostics:d,tick}=fixture();
 d.begin('private-session',{infoHash:hash,fileIdx:0,url:'https://private/token',title:'private-title',headers:{Authorization:'private-key'}});
 tick();d.capture({type:'playback/preparing',session:'private-session',title:'private-title'});
 d.capture({type:'playback/diagnostic',session:'private-session',stage:'torrent-sample',elapsedMs:12,connectedPeers:2,speedBytes:500,checkedBytes:-1,waitMs:Infinity,fileIdx:'private-key',mode:'network',message:'private-key',url:'https://private/token',headers:{Authorization:'private-key'}});
 d.capture({type:'playback/diagnostic',session:'private-session',stage:'private-title',elapsedMs:15});
 d.capture({type:'playback/stage',session:'private-session',stage:'cache-selected',volume:'C:\\private-path',availableBytes:100});
 const report=JSON.parse(d.export());
 assert.equal(report.version,'0.3.16');assert.equal(report.platform,'win32');
 assert.deepEqual(report.source,{kind:'torrent',infoHash:hash,fileIdx:0});
 assert.equal(report.events.length,2);
 assert.deepEqual(report.events[1],{type:'playback/diagnostic',elapsedMs:5,traceElapsedMs:12,stage:'torrent-sample',connectedPeers:2,speedBytes:500,mode:'network'});
 assert.doesNotMatch(d.export(),/private|Authorization|volume|availableBytes|Infinity/);
});
test('retains the last session through error and close, rejects stale events, resets at next start',()=>{
 const {diagnostics:d}=fixture();d.begin('first',{infoHash:hash});
 d.capture({type:'playback/preparing',session:'first'});
 d.capture({type:'playback/error',session:'first',message:'لم يصل إطار فيديو https://private/token'});
 let report=JSON.parse(d.export());assert.equal(report.status,'error');assert.equal(report.events.at(-1).errorClass,'first-frame');
 d.capture({type:'playback/closed',session:'first'});
 report=JSON.parse(d.export());assert.equal(report.status,'closed');assert.equal(report.events.length,3);
 d.capture({type:'playback/diagnostic',session:'first',stage:'torrent-sample'});assert.equal(JSON.parse(d.export()).events.length,3);
 d.begin('second',{url:'https://private/token'});d.capture({type:'playback/closed',session:'first'});
 report=JSON.parse(d.export());assert.equal(report.status,'starting');assert.deepEqual(report.source,{kind:'direct'});assert.deepEqual(report.events,[]);
 // Reusing an opaque UI session ID must still clear the preceding attempt.
 d.begin('second',{infoHash:hash,fileIdx:1});assert.equal(JSON.parse(d.export()).source.fileIdx,1);
});
test('bounds history to 256 events and does not expose invalid identity or unknown error codes',()=>{
 const {diagnostics:d}=fixture();d.begin('one',{infoHash:'https://private',fileIdx:-1});
 for(let i=0;i<1000;i++)d.capture({type:'playback/diagnostic',session:'one',stage:'torrent-sample',checkedBytes:i});
 let report=JSON.parse(d.export());assert.equal(report.events.length,256);assert.equal(report.events[0].checkedBytes,744);assert.deepEqual(report.source,{kind:'direct'});
 d.capture({type:'playback/error',session:'one',code:'private-key',message:'private-title'});
 report=JSON.parse(d.export());assert.equal(report.events.at(-1).errorClass,'playback-failed');assert.doesNotMatch(d.export(),/private/);
});
test('empty export is usable before any playback and snapshots cannot mutate retained events',()=>{
 const {diagnostics:d}=fixture();assert.equal(JSON.parse(d.export()).status,'none');
 d.begin('one',{});d.capture({type:'playback/preparing',session:'one'});
 const report=JSON.parse(d.export());report.events[0].type='private';assert.equal(JSON.parse(d.export()).events[0].type,'playback/preparing');
});
test('source replacement with the same UI session survives the preceding source closing',()=>{
 const {diagnostics:d}=fixture();d.begin('same',{infoHash:hash});d.capture({type:'playback/preparing',session:'same'});
 d.begin('same',{infoHash:'b'.repeat(40)});
 d.capture({type:'playback/diagnostic',session:'same',stage:'source-selected'});
 // services publishes source-selected for the new attempt, then closes the old
 // source, then announces preparing. UI source switching reuses this session.
 d.capture({type:'playback/closed',session:'same'});
 d.capture({type:'playback/preparing',session:'same'});
 d.capture({type:'playback/diagnostic',session:'same',stage:'engine-start'});
 let report=JSON.parse(d.export());assert.equal(report.status,'preparing');
 assert.deepEqual(report.events.map(e=>e.stage??e.type),['source-selected','playback/preparing','engine-start']);
 d.capture({type:'playback/recovery-needed',session:'same',reason:'stalled'});
 assert.equal(JSON.parse(d.export()).events.at(-1).reason,'stalled');
 d.capture({type:'playback/closed',session:'same'});d.capture({type:'playback/preparing',session:'same'});
 report=JSON.parse(d.export());assert.equal(report.status,'closed');
});
test('retains the header arrival milestone without response headers or URLs',()=>{
 const {diagnostics:d}=fixture();d.begin('one',{});
 d.capture({type:'playback/diagnostic',session:'one',stage:'http-headers',elapsedMs:25,requestId:1,rangeStart:0,rangeEnd:50,waitMs:20,headers:{Authorization:'private-token'},url:'https://private/token'});
 assert.deepEqual(JSON.parse(d.export()).events[0],{type:'playback/diagnostic',elapsedMs:0,traceElapsedMs:25,stage:'http-headers',rangeStart:0,rangeEnd:50,waitMs:20,requestId:1});
 assert.doesNotMatch(d.export(),/private|Authorization/);
});


test('exports classified startup boundaries without upstream error strings',()=>{
 const report=createPlaybackDiagnostics({version:'0.3.16',platform:'win32'});report.begin('one');
 report.capture({type:'playback/diagnostic',session:'one',stage:'managed-add-error',waitMs:1300,errorCode:5,statusCode:503,message:'https://provider.test/private/key'});
 report.capture({type:'playback/diagnostic',session:'one',stage:'player-end-file',reasonCode:4,errorCode:2});
 const data=JSON.parse(report.export());assert.equal(data.events[0].statusCode,503);assert.equal(data.events[1].reasonCode,4);assert.ok(!report.export().includes('provider.test'));
});
