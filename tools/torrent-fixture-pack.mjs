// One authored artifact for every comparison host. MKV encoders can randomize
// SegmentUID even when pictures, codec, duration and file size are identical.
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {fixture} from './torrent-startup-benchmark.mjs';
const names={'mp4':'authored-mp4.mp4','late-moov':'authored-late-moov.mp4','mkv':'authored-mkv.mkv'};
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
export async function verifyFixturePack(directory){
  const manifest=JSON.parse(await fs.readFile(join(directory,'fixtures-manifest.json'),'utf8'));
  assert.equal(manifest.format,1);assert.equal(manifest.files.length,3);
  assert.deepEqual(manifest.files.map(f=>f.kind).sort(),Object.keys(names).sort());
  for(const file of manifest.files){
    assert.equal(file.name,names[file.kind],'Untrusted fixture path');
    assert.match(file.infoHash,/^[a-f0-9]{40}$/);assert.equal(file.fileIdx,0);
    const data=await fs.readFile(join(directory,file.name));
    assert.equal(data.length,file.bytes,'Fixture length mismatch');assert.equal(digest(data),file.sha256,'Fixture SHA256 mismatch');
  }
  return manifest;
}
export async function createFixturePack(directory,ffmpeg){
  await fs.mkdir(directory,{recursive:true});const files=[];
  for(const kind of Object.keys(names)){
    const f=await fixture(directory,kind,32,ffmpeg,null,256*1024,false);
    files.push({kind,name:f.name,bytes:f.bytes,infoHash:f.infoHash,fileIdx:0,sha256:digest(await fs.readFile(f.path))});
  }
  await fs.writeFile(join(directory,'fixtures-manifest.json'),JSON.stringify({format:1,files},null,2));
  return verifyFixturePack(directory);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [mode,directory,ffmpeg]=process.argv.slice(2);
  assert.ok(mode==='create'||mode==='verify');
  const manifest=mode==='create'?await createFixturePack(resolve(directory),ffmpeg):await verifyFixturePack(resolve(directory));
  console.log(JSON.stringify(manifest));
}
