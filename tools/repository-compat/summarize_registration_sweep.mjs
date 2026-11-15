import {readFileSync} from 'node:fs';
const rows=readFileSync(process.argv[2]??'registration-sweep.jsonl','utf8').split('\n')
 .filter(l=>l.trimStart().startsWith('{')).map(l=>{try{return JSON.parse(l)}catch{return null}}).filter(Boolean);
const strict=process.argv.includes('--strict');
const seen=new Set();
let passed=0,failed=0;
console.log('| Plugin | Content | Registration | Sources | Failure |');
console.log('|---|---|---|---:|---|');
for(const row of rows){
 const name=String(row.plugin??'?');
 if(seen.has(String(row.pkg??name))) {console.error('DUPLICATE_REGISTRATION_ROW: '+name);process.exitCode=1}
 seen.add(String(row.pkg??name));
 const ok=row.result==='PASS' && Number(row.sources)>0;
 if(ok)passed++;else failed++;
 console.log(`| ${name.replaceAll('|','/')} | ${row.content??'?'} | ${ok?'PASS':'FAIL'} | ${row.sources??0} | ${String(row.failure??'').replaceAll('|','/').slice(0,95)} |`);
}
console.log(`Published plugin ABI/registration journeys: ${rows.length}, passed: ${passed}, failed: ${failed}. NOT source-site playback proof.`);
if(strict && (!rows.length || failed>0)) {
 console.error('REGISTRATION_COMPATIBILITY_NOT_CERTIFIED: '+failed+' failed of '+rows.length);
 process.exitCode=1;
}
