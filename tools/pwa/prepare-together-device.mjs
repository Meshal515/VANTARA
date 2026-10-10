/** Build an isolated emulator fixture from current production Together sources, no NDK. */
import {mkdir,copyFile} from 'node:fs/promises';
import {resolve,dirname,sep} from 'node:path';
const root=resolve('.'),target=resolve('work/together-native-proof');
if(!target.startsWith(resolve('work')+sep))throw Error('fixture must remain in work/');
const copies=[['settings.gradle','settings.gradle'],['build.gradle','build.gradle'],['gradle.properties','gradle.properties'],['app.gradle','app/build.gradle'],['AndroidManifest.xml','app/src/main/AndroidManifest.xml'],['ProofActivity.kt','app/src/main/java/com/vantara/proof/ProofActivity.kt']];
for(const [from,to] of copies){const dest=resolve(target,to);await mkdir(dirname(dest),{recursive:true});await copyFile(resolve(root,'tools/pwa/together-device',from),dest);}
const player='android/app/src/main/kotlin/com/vantara/anime/player';
for(const path of ['Ui.kt','together/TogetherPlayer.kt','together/TogetherClient.kt','together/TogetherSync.kt']){const dest=resolve(target,'app/src/main/java/com/vantara/anime/player',path);await mkdir(dirname(dest),{recursive:true});await copyFile(resolve(root,player,path),dest);}
const fixture=resolve(target,'app/src/main/assets/authored.mp4');await mkdir(dirname(fixture),{recursive:true});await copyFile(resolve(root,'android/app/src/androidTest/assets/addon-torrent-proof.mp4'),fixture);
console.log(`Fixture prepared: ${target}`);
