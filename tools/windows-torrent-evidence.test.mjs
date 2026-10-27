import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyContainerComparisons } from './windows-torrent-evidence.mjs';
const reports=()=>['rqbit','libtorrent'].flatMap(seed=>['rqbit','libtorrent'].map(engine=>({options:{seedEngine:seed},torrentBackend:engine,fixtures:['mp4','late-moov','mkv'].map(kind=>({kind,infoHash:'a'.repeat(40),fileIdx:0,bytes:1234})),runs:['mp4','late-moov','mkv'].flatMap(fixture=>['cold','warm','restart','partial'].flatMap(mode=>Array.from({length:3},(_,trial)=>({fixture,mode,trial,ok:true,realtimePlaybackVerified:true}))))})));

test('parallel comparisons require all four real engine pairs and the same exact torrent/file',()=>{
  assert.doesNotThrow(()=>verifyContainerComparisons(reports()));
  assert.throws(()=>verifyContainerComparisons(reports().slice(1)),/four/);
  const changed=reports();changed[2].fixtures[0].infoHash='b'.repeat(40);
  assert.throws(()=>verifyContainerComparisons(changed),/identity/);
  const unproven=reports();unproven[0].runs[0].realtimePlaybackVerified=false;
  assert.throws(()=>verifyContainerComparisons(unproven),/playback/);
  const failure=reports();failure[2].runs[0].ok=false;
  assert.throws(()=>verifyContainerComparisons(failure),/failed/);
});
