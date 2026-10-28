/** Release-port gate: compare preserved contracts/assets to the shipped Stable. */
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
export const baseline='c5741f01aa1d6386e7b50c5ddf3a78e1c73ff841';
const root=resolve(fileURLToPath(new URL('../..',import.meta.url)));
const protectedPaths=[
 'android/app/build.gradle','android/app/src/main/assets/extensions','android/app/src/main/assets/anime-extensions',
 'android/app/src/main/kotlin/dev/vantara/spike','android/app/src/main/kotlin/com/vantara/anime/AnimeEngine.kt',
 'android/app/src/main/kotlin/com/vantara/anime/catalog','android/app/src/main/kotlin/com/vantara/anime/registry',
 'android/app/src/main/kotlin/com/vantara/addons','android/app/src/main/kotlin/com/vantara/plugins/update',
 'android/app/src/main/kotlin/com/vantara/plugins/AppUpdatePlugin.kt',
 'apps/web/lib/manga-engine.js','apps/web/lib/sync.js','apps/web/lib/account-store.js','apps/web/lib/session-store.js',
 'apps/web/lib/config.js','apps/web/lib/updater.js','apps/web/addons/registry.js',
 'apps/web/v35/manga.js','apps/web/v35/profile.js','apps/web/v35/reader.js',
 'apps/desktop','packages','services',
 '.github/workflows/android-stable.yml','.github/workflows/android-debug.yml',
];
const git=(...args)=>execFileSync('git',args,{cwd:root,maxBuffer:64*1024*1024});
export function assertPreserved(read=path=>readFileSync(resolve(root,path))){
 const paths=git('ls-tree','-r','--name-only',baseline,'--',...protectedPaths).toString().trim().split('\n');
 if(paths.length<50)throw new Error('Stable baseline was not fully available');
 for(const path of paths){if(!read(path).equals(git('show',`${baseline}:${path}`)))throw new Error(`Stable contract changed: ${path}`);}
 const regions=[
  ['android/app/src/main/kotlin/com/vantara/plugins/ExtensionEnginePlugin.kt','    fun catalogue('],
  ['android/app/src/main/kotlin/com/vantara/anime/bridge/AnimeEnginePlugin.kt','    fun verify('],
 ];
 for(const [path,marker] of regions){const a=read(path).toString(),b=git('show',`${baseline}:${path}`).toString();if(!a.includes(marker)||a.slice(a.indexOf(marker))!==b.slice(b.indexOf(marker)))throw new Error(`Stable extraction changed: ${path}`);}
 const path='apps/web/v35/addons-view.js';
 const setup=s=>s.slice(s.indexOf('export async function configureInApp('),s.indexOf('export function renderAddonDetails(')).replace('export function configureLink(', 'function configureLink(');
 if(setup(read(path).toString())!==setup(git('show',`${baseline}:${path}`).toString()))throw new Error('Stable in-app configuration changed');
 return {baseline,protectedFiles:paths.length,extractionRegions:regions.length,inAppConfiguration:true};
}
if(process.argv[1]===fileURLToPath(import.meta.url))console.log(JSON.stringify(assertPreserved()));
