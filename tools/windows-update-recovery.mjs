// Real installer migration on an ephemeral Windows runner; no production publication.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { Readable } from 'node:stream';
const require=createRequire(import.meta.url);
const updater=require('../apps/desktop/updater.cjs');
assert.equal(process.platform,'win32','This check requires real Windows');
const [oldInstaller,newInstaller,version,reportPath]=process.argv.slice(2);
assert.match(version,/^0\.4\.\d+$/);
const folder=await mkdtemp(join(tmpdir(),'VANTARA update check '));
const target=join(folder,'مستخدم مع مسافات','VANTARA');
const application=join(target,'resources','app');
async function install(file){
 const cmd=updater.installCommand({installer:file,exe:join(target,'VANTARA.exe'),relaunch:false});
 await new Promise((resolve,reject)=>{
  const child=spawn(cmd.file,cmd.args,{...cmd.options,detached:false});
  const timer=setTimeout(()=>{child.kill();reject(new Error('Installer exceeded 180 seconds'));},180000);
  child.once('error',error=>{clearTimeout(timer);reject(error);});
  child.once('exit',code=>{clearTimeout(timer);code===0?resolve():reject(new Error(`Installer exit ${code}`));});
 });
}
await install(oldInstaller);
assert.equal(JSON.parse(await readFile(join(application,'package.json'),'utf8')).version,'0.0.209');
// Load the actual installed old updater before its files are replaced.
const oldSource=await readFile(join(application,'web','desktop','update-check.js'),'utf8');
const oldReader=await import('data:text/javascript;base64,'+Buffer.from(oldSource).toString('base64'));
const retained=new Map();
for(const path of [join(target,'VANTARA-data','Local Storage','account.marker'),join(target,'VANTARA-data','device.marker'),join(target,'personal.marker')]){
 await mkdir(join(path,'..'),{recursive:true});
 const bytes=Buffer.from('Synthetic local profile retained across installer migration\n'+path);
 await writeFile(path,bytes);retained.set(path,bytes);
}
const hash=createHash('sha256');let size=0;
for await(const bytes of createReadStream(newInstaller)){hash.update(bytes);size+=bytes.length;}
const code=Number(version.split('.')[2]);
const update={version,url:`https://github.com/Meshal515/VANTARA/releases/download/stable-${code}/VANTARA-${version}-Windows-x64-Setup.exe`,size,sha256:hash.digest('hex')};
const manifest={format:2,versionName:version,versionCode:code,desktop:{...update,platform:'win32-x64',installer:'nsis'}};
for(const installed of ['0.3.18','0.0.209','0.0.210'])assert.equal(oldReader.desktopUpdateFromManifest(manifest,installed)?.version,version);
updater.assertForwardUpdate(update,'0.0.209');
// Only the transport is replaced: the artifact is not advertised on production.
const downloaded=await updater.downloadUpdate({update,dir:join(folder,'updates'),fetch:async url=>{
 assert.equal(url,update.url);return new Response(Readable.toWeb(createReadStream(newInstaller)));
}});
await install(downloaded);
assert.equal(JSON.parse(await readFile(join(application,'package.json'),'utf8')).version,version);
assert.equal(JSON.parse(await readFile(join(target,'BUILD-MANIFEST.json'),'utf8')).version,version);
assert.match(await readFile(join(application,'web','lib','config.js'),'utf8'),new RegExp(version.replaceAll('.','\\.')));
for(const [path,bytes]of retained)assert.deepEqual(await readFile(path),bytes);
const installedUpdater=require(join(application,'updater.cjs'));
assert.throws(()=>installedUpdater.assertForwardUpdate({...update,version:'0.3.18',url:'https://github.com/Meshal515/VANTARA/releases/download/windows-v0.3.18/VANTARA-0.3.18-Windows-x64-Setup.exe'},version));
assert.throws(()=>installedUpdater.assertForwardUpdate(update,version));
const registry=execFileSync('reg',['query','HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\VANTARA','/v','DisplayVersion'],{encoding:'utf8'});
assert.ok(registry.includes(version),'Installed registry version must match application');
const report={platform:process.platform,oldInstalledVersion:'0.0.209',newInstalledVersion:version,actualNsisInstall:true,actualUpdaterDownloadAndHash:true,transport:'local verified CI artifact; not a published update',oldReaderAcceptsRecovery:['0.3.18','0.0.209','0.0.210'],profileMarkersRetained:retained.size,rollbackRejected:true,equalVersionRejected:true,pathWithSpacesAndArabic:true,installedRegistryVersion:version};
await writeFile(reportPath,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
