import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
// Python's official Windows index supplies the runtime checksum. PyPI supplies
// the wheel checksum. Neither an unpinned runtime nor a system pip install is shipped.
export const LIBTORRENT_WINDOWS_ARTIFACTS=Object.freeze([
  {name:'python-3.13.17-embeddable-amd64.zip',url:'https://www.python.org/ftp/python/3.13.17/python-3.13.17-embeddable-amd64.zip',sha256:'0ba1ee4bfcbdc3a559d27e2e9ce76d04a7839947a23f46375872c755c0d463b8'},
  {name:'libtorrent-2.0.13-cp313-cp313-win_amd64.whl',url:'https://files.pythonhosted.org/packages/82/ed/7e4d78ba435efa41d050b4268a5fbe195c16e75bd9c29e50592ac3817f96/libtorrent-2.0.13-cp313-cp313-win_amd64.whl',sha256:'73551473c0342de0b9f324dfeec6f731901cac31899d5bc331f7eac9f6cf0ba1'},
  {name:'LIBTORRENT-LICENSE.txt',url:'https://raw.githubusercontent.com/arvidn/libtorrent/v2.0.13/COPYING',sha256:'f4b492afbde73d2f4e051050a619622876a13b77e7b8b6ea3ec2868a6929b31b'},
  {name:'BOOST-LICENSE.txt',url:'https://www.boost.org/LICENSE_1_0.txt',sha256:'c9bff75738922193e67fa726fa225535870d2aa1059f91452c411736284ad566'},
]);
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');

export async function pinnedDownload(artifact,cache,fetcher=fetch){
  if(!/^[a-f0-9]{64}$/.test(artifact.sha256)||path.basename(artifact.name)!==artifact.name||!artifact.url.startsWith('https://'))throw new Error('Invalid pinned artifact');
  await fs.mkdir(cache,{recursive:true});
  const target=path.join(cache,artifact.name);
  let bytes=await fs.readFile(target).catch(()=>null);
  if(bytes&&sha256(bytes)===artifact.sha256)return target;
  const response=await fetcher(artifact.url);
  if(!response.ok)throw new Error(`Native artifact HTTP ${response.status}`);
  bytes=Buffer.from(await response.arrayBuffer());
  if(sha256(bytes)!==artifact.sha256)throw new Error(`Native artifact checksum mismatch: ${artifact.name}`);
  // A partial/failed download must never replace a previously verified cache entry.
  const temp=target+'.tmp';await fs.writeFile(temp,bytes);await fs.rename(temp,target);
  return target;
}

export async function bundleWindowsLibtorrent({outputDir,cache,python=process.platform==='win32'?'python':'python3'}={}){
  if(!path.isAbsolute(outputDir??'')||!path.isAbsolute(cache??''))throw new Error('Absolute build staging paths required');
  const root=path.join(outputDir,'python');
  await fs.mkdir(root,{recursive:true});
  const downloaded=await Promise.all(LIBTORRENT_WINDOWS_ARTIFACTS.map(a=>pinnedDownload(a,cache)));
  const extraction=String.raw`import pathlib,stat,sys,zipfile
root=pathlib.Path(sys.argv[2]).resolve()
with zipfile.ZipFile(sys.argv[1]) as z:
 for info in z.infolist():
  target=(root/info.filename).resolve()
  if not target.is_relative_to(root) or stat.S_ISLNK(info.external_attr >> 16): raise RuntimeError('unsafe archive path')
 z.extractall(root)
`;
  for(const filename of downloaded.slice(0,2))execFileSync(python,['-I','-c',extraction,filename,root],{stdio:'inherit'});
  // In an embedded interpreter '.' here means this immutable runtime directory,
  // never the user's cwd; do not enable site, registry search or user packages.
  await fs.writeFile(path.join(root,'python313._pth'),'python313.zip\n.\n');
  for(let i=2;i<downloaded.length;i++)await fs.copyFile(downloaded[i],path.join(outputDir,LIBTORRENT_WINDOWS_ARTIFACTS[i].name));
  await fs.copyFile(path.join(repo,'apps/desktop/native/libtorrent/server.py'),path.join(outputDir,'server.py'));
  await fs.writeFile(path.join(outputDir,'THIRD-PARTY-NOTICES.txt'),`libtorrent 2.0.13: BSD-3-Clause; LIBTORRENT-LICENSE.txt. Official Python bindings: https://pypi.org/project/libtorrent/2.0.13/\nBoost/Boost.Python: Boost Software License 1.0; BOOST-LICENSE.txt.\nCPython 3.13.17 embedded x64: Python Software Foundation License and bundled dependency notices in python/LICENSE.txt.\nNo Android JNI/Media3 code or runtime is copied. VANTARA's streaming policy is implemented against the official libtorrent Python API.\n`);
  const files=[];
  for(const entry of await fs.readdir(outputDir,{recursive:true,withFileTypes:true})){
    if(!entry.isFile())continue;
    const filename=path.join(entry.parentPath??entry.path,entry.name),bytes=await fs.readFile(filename);
    files.push({path:path.relative(outputDir,filename).split(path.sep).join('/'),sha256:sha256(bytes),bytes:bytes.length});
  }
  const manifest={format:1,engine:'libtorrent',version:'2.0.13',python:'3.13.17',platform:'win32-x64',default:false,artifacts:LIBTORRENT_WINDOWS_ARTIFACTS,files};
  await fs.writeFile(path.join(outputDir,'LIBTORRENT-MANIFEST.json'),JSON.stringify(manifest,null,2)+'\n');
  return manifest;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const arg=name=>process.argv.find(x=>x.startsWith(`--${name}=`))?.slice(name.length+3);
  const outputDir=path.resolve(arg('output')??path.join(repo,'..','VANTARA-artifacts','libtorrent-native'));
  const cache=path.resolve(arg('cache')??path.join(repo,'..','VANTARA-artifacts','cache'));
  const manifest=await bundleWindowsLibtorrent({outputDir,cache});
  console.log(JSON.stringify({outputDir,engine:manifest.engine,version:manifest.version,default:false}));
}
