/** This experimental cohort may only ADD isolated files. Legacy files stay byte-identical. */
import {execFileSync} from 'node:child_process';
const base='f20723d168bd45b9524244171be41f97f6a5dbd3';
const lines=execFileSync('git',['diff','--name-status','--no-renames',base],{encoding:'utf8'}).trim().split('\n').filter(Boolean);
const prefixes=['extensions/runtime-core/','extensions/runtime-android/','tools/repository-compat/','docs/repository-compat/'];
for(const row of lines){const [status,path]=row.split('\t');if(status!=='A'||!(prefixes.some(p=>path.startsWith(p))||path==='.github/workflows/repository-compat.yml'||path==='.github/workflows/runtime-android.yml'||path==='docs/superpowers/plans/2026-10-28-vantara-runtime-worker.md'||path==='docs/superpowers/plans/2026-10-28-repository-compat-runtime.md'))throw Error('Forbidden legacy/scope change: '+row);}
console.log(`Scope verified: ${lines.length} additions only; original application, torrent, player, subtitles and accounts unchanged from ${base}`);
