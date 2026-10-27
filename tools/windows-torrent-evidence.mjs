import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {resolve,join,basename} from 'node:path';
import {fileURLToPath} from 'node:url';

export function verifyContainerComparisons(reports){
  assert.equal(reports.length,4,'Missing four engine/seeder comparisons');
  const pairs=new Set(),identities=reports.map(report=>{
    const pair=`${report.options.seedEngine}-${report.torrentBackend}`;
    assert.ok(!pairs.has(pair),'Duplicate engine/seeder comparison');pairs.add(pair);
    assert.equal(report.runs.length,36,'Missing required cache/container samples');
    assert.ok(report.runs.every(r=>r.ok===true&&r.realtimePlaybackVerified===true),'Actual real-time playback comparison failed');
    assert.deepEqual(report.fixtures.map(f=>f.kind).sort(),['late-moov','mkv','mp4']);
    for(const fixture of ['mp4','late-moov','mkv'])for(const mode of ['cold','warm','restart','partial']){
      const trials=report.runs.filter(r=>r.fixture===fixture&&r.mode===mode).map(r=>r.trial).sort();
      assert.deepEqual(trials,[0,1,2],'Missing or duplicated required playback trials');
    }
    return JSON.stringify(report.fixtures.map(({kind,infoHash,fileIdx,bytes})=>({kind,infoHash,fileIdx,bytes})));
  });
  assert.deepEqual([...pairs].sort(),['libtorrent-libtorrent','libtorrent-rqbit','rqbit-libtorrent','rqbit-rqbit']);
  assert.ok(identities.every(identity=>identity===identities[0]),'Parallel comparisons changed torrent/file identity');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const root=resolve(process.argv[2]),reports=[];
  for(const name of await fs.readdir(root,{recursive:true})){
    if(basename(name)!=='results.json')continue;
    const report=JSON.parse(await fs.readFile(join(root,name),'utf8'));
    if(report.options?.kinds==='mp4,late-moov,mkv')reports.push(report);
  }
  verifyContainerComparisons(reports);
  console.log('All four Windows engine/seeder comparisons used identical torrents and files; 144 actual playback cases passed.');
}
