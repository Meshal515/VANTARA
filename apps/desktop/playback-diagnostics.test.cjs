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
