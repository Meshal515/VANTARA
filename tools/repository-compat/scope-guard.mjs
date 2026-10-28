/** This experimental cohort may only ADD isolated files. Legacy files stay byte-identical. */
import {execFileSync} from 'node:child_process';
// Integration foundation inherits the current signed Debug branch unchanged.
// The core PR keeps its independent f20723d baseline and additions-only guard.
const base='f959ad673804ff36ebce0c23c2762f82ec0b9e4b';
const lines=execFileSync('git',['diff','--name-status','--no-renames',base],{encoding:'utf8'}).trim().split('\n').filter(Boolean);
const prefixes=['extensions/runtime-core/','extensions/runtime-android/','tools/repository-compat/','docs/repository-compat/'];
for(const row of lines){const [status,path]=row.split('\t');if(status!=='A'||!(prefixes.some(p=>path.startsWith(p))||path==='.github/workflows/repository-compat.yml'||path==='.github/workflows/runtime-android.yml'||path==='docs/superpowers/plans/2026-10-28-vantara-runtime-worker.md'||path==='docs/superpowers/plans/2026-10-28-repository-compat-runtime.md'))throw Error('Forbidden legacy/scope change: '+row);}
console.log(`Scope verified: ${lines.length} additions only; original application, torrent, player, subtitles and accounts unchanged from ${base}`);
