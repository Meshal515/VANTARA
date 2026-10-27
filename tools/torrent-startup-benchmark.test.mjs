import test from 'node:test';
import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import net from 'node:net';
import { framePixels, summarize, main, assessPlaybackProgress, playbackHasActuallyStarted, createUtpFixtureRelay, waitForOwnedTcpListener, waitForOwnedBitTorrentPeer } from './torrent-startup-benchmark.mjs';

test('fixture readiness verifies the requested BitTorrent hash, not an accepted TCP socket',async t=>{
  const hash='a'.repeat(40);let attempts=0;
  const server=net.createServer(socket=>{socket.once('data',request=>{attempts++;assert.equal(request.length,68);const reply=Buffer.from(request);if(attempts===1)reply.fill(0,28,48);socket.end(reply);});});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
  await waitForOwnedBitTorrentPeer(server.address().port,hash,1000);
  assert.equal(attempts,2);
});

test('owned seeder readiness waits for an actual listening socket, not just checked file bytes',async t=>{
  const server=net.createServer(socket=>socket.end());
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;
  await new Promise(r=>server.close(r));
  let listening=false;
  const ready=waitForOwnedTcpListener(port,1000).then(()=>assert.equal(listening,true));
  setTimeout(()=>server.listen(port,'127.0.0.1',()=>{listening=true;}),50);
  t.after(()=>new Promise(r=>server.close(r)));
  await ready;
});

test('frame proof rejects black output and accepts authored colored rendered pixels',()=>{
  assert.equal(framePixels(Buffer.alloc(1200)).nonblack,false);
  assert.equal(framePixels(Buffer.from([230,10,30,10,200,80])).nonblack,true);
});
test('timing summary excludes failed runs and reports measured samples only',()=>{
  const result=summarize([{ok:true,firstRenderedMs:100},{ok:true,firstRenderedMs:300},{ok:false,firstRenderedMs:1}]);
  assert.deepEqual(result,{successful:2,failed:1,minMs:100,medianMs:200,p95Ms:300,maxMs:300});
  assert.equal(summarize([{ok:false}]).medianMs,null);
});

test('software-only local baseline cannot weaken absolute playback acceptance',()=>{
  const sample={fromSeconds:0,toSeconds:.3,observedSeconds:2};
  const baseline={fromSeconds:0,toSeconds:.4,observedSeconds:2,softwareAdapter:true};
  assert.equal(assessPlaybackProgress(sample).passed,false);
  assert.equal(assessPlaybackProgress(sample,{...baseline,softwareAdapter:false}).passed,false);
  assert.equal(assessPlaybackProgress(sample,baseline).kind,'realtime');
  assert.equal(assessPlaybackProgress(sample,baseline).passed,false);
  assert.equal(assessPlaybackProgress({...sample,toSeconds:0},baseline).passed,false);
  assert.equal(assessPlaybackProgress(sample,{...baseline,toSeconds:0}).passed,false);
  assert.equal(assessPlaybackProgress({...sample,toSeconds:2}).kind,'realtime');
  assert.equal(assessPlaybackProgress({...sample,toSeconds:2}).passed,true);
});

test('first decoded frame is not considered moving video while the player is buffering or paused',()=>{
  assert.equal(playbackHasActuallyStarted({position:0,paused:false,buffering:false}),false);
  assert.equal(playbackHasActuallyStarted({position:0.5,paused:false,buffering:true}),false);
  assert.equal(playbackHasActuallyStarted({position:0.5,paused:true,buffering:false}),false);
  assert.equal(playbackHasActuallyStarted({position:1,paused:false,buffering:false}),true);
  assert.equal(playbackHasActuallyStarted({position:NaN,paused:false,buffering:false}),false);
});

test('benchmark rejects unknown warmup strategies and invalid piece sizes before launching tools',async()=>{
  const required=['--service-module','unused','--rqbit','unused','--mpv','unused'];
  await assert.rejects(main([...required,'--torrent-warmup','head-typo']),/torrent-warmup/);
  await assert.rejects(main([...required,'--piece-length','12345']),/piece-length/);
});

test('uTP-only comparisons cannot silently use a TCP seeder or an unsupported transport',async()=>{
  const required=['--service-module','unused','--rqbit','unused','--mpv','unused'];
  await assert.rejects(main([...required,'--seed-transport','utp']),/uTP-only fixture requires libtorrent seeder/);
  await assert.rejects(main([...required,'--seed-transport','udp-typo']),/Unsupported fixture seed transport/);
  await assert.rejects(main([...required,'--native-transport','tcp-typo']),/Unsupported fixture native transport/);
  await assert.rejects(main([...required,'--rqbit-transport','udp-typo']),/Unsupported fixture rqbit transport/);
  await assert.rejects(main([...required,'--seed-encryption','mse']),/MSE fixture requires libtorrent seeder/);
  await assert.rejects(main([...required,'--seed-encryption','unknown']),/Unsupported fixture encryption/);
});

test('UDP-only owned relay verifies TCP rejection and forwards datagrams in both directions',async t=>{
  const seed=dgram.createSocket('udp4'),client=dgram.createSocket('udp4');
  t.after(()=>{seed.close();client.close();});
  await new Promise(r=>seed.bind(0,'127.0.0.1',r));
  seed.on('message',(bytes,from)=>{assert.equal(bytes.toString(),'owned request');seed.send(Buffer.from('owned reply'),from.port,from.address);});
  const relay=await createUtpFixtureRelay(seed.address().port);t.after(()=>relay.close());
  assert.equal(relay.proof.tcpConnectRejected,true);
  const response=new Promise(r=>client.once('message',bytes=>r(bytes.toString())));
  client.send(Buffer.from('owned request'),relay.port,'127.0.0.1');
  assert.equal(await response,'owned reply');
});
