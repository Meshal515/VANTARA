import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';

const runner=join(import.meta.dirname,'summarize_live_sweep.mjs');
function run(rows,args=['--strict','--require-plugins=Animewitcher']){
 const temp=mkdtempSync(join(tmpdir(),'vantara-source-proof-'));
 try{
  const file=join(temp,'sweep.jsonl');
  writeFileSync(file,rows.map(r=>JSON.stringify(r)).join('\n')+'\n');
  return spawnSync(process.execPath,[runner,file,...args],{encoding:'utf8'});
 }finally{rmSync(temp,{recursive:true,force:true});}
}
const pass={result:'PASS'};
const success={plugin:'Animewitcher',install:pass,sources:[{catalogue:pass,details:pass,episodes:pass,videoLinks:pass,links:1,playable:1}]};
test('strict proof accepts actual five-step journey with media bytes',()=>{
 const r=run([success]);assert.equal(r.status,0,r.stdout+r.stderr);assert.match(r.stdout,/confirmed five-step media journeys: 1/i);
});
test('strict proof fails reports with no successful playable media',()=>{
 const r=run([{...success,sources:[{...success.sources[0],playable:0}]}]);assert.notEqual(r.status,0,r.stdout+r.stderr);
});
test('strict proof fails a missing named plugin rather than ignoring it',()=>{
 const r=run([success],['--strict','--require-plugins=Animewitcher,Anime4up']);assert.notEqual(r.status,0,r.stdout+r.stderr);
});
test('strict proof rejects empty output as no evidence',()=>{
 const r=run([]);assert.notEqual(r.status,0,r.stdout+r.stderr);
});

test('explicit AnimeRift health gate cannot be green just because Anime4up plays',()=>{
 const r=run([success,{plugin:'AnimeRift',install:pass,sources:[{catalogue:{result:'FAIL',reason:'VERIFICATION_REQUIRED'},playable:0}]}],
   ['--strict','--require-plugins=Animewitcher,AnimeRift','--require-healthy=AnimeRift']);
 assert.notEqual(r.status,0,r.stdout+r.stderr);
 assert.match(r.stderr,/AnimeRift/i);
});
test('explicit AnimeRift health gate succeeds only on a full actual media journey',()=>{
 const r=run([success,{...success,plugin:'AnimeRift'}],
   ['--strict','--require-plugins=Animewitcher,AnimeRift','--require-healthy=AnimeRift']);
 assert.equal(r.status,0,r.stdout+r.stderr);
 assert.match(r.stdout,/AnimeRift/);
});
test('strict health check identifies requested provider case-insensitively',()=>{
 const r=run([{...success,plugin:'AnimeRift'}],['--strict','--require-plugins=animerift','--require-healthy=ANIMERIFT']);
 assert.equal(r.status,0,r.stdout+r.stderr);
});
