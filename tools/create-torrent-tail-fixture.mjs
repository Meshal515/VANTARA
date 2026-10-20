// Legal authored HEVC input only; used by Windows CI and local reproduction.
import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {join,resolve,basename} from 'node:path';
import assert from 'node:assert/strict';

const [ffmpeg,sourceArg,outArg]=process.argv.slice(2);
assert.ok(ffmpeg&&sourceArg&&outArg,'ffmpeg, authored source and output directory required');
const source=resolve(sourceArg),out=resolve(outArg);
await fs.mkdir(out,{recursive:true});
const remux=join(out,'authored-remux.mp4');
execFileSync(ffmpeg,['-v','error','-y','-stream_loop','7','-i',source,'-c','copy',remux],{stdio:'inherit'});
const bytes=await fs.readFile(remux);
let moov=0;
while(moov+8<=bytes.length){
  const size=bytes.readUInt32BE(moov);
  assert.ok(size>=8&&moov+size<=bytes.length,'Invalid authored atom');
  if(bytes.toString('ascii',moov+4,moov+8)==='moov')break;
  moov+=size;
}
assert.ok(moov+8<=bytes.length,'Missing authored moov');
assert.equal(moov+bytes.readUInt32BE(moov),bytes.length,'Expected trailing moov');
const prefix=2247490-moov,padding=256*1024*1024;
assert.ok(prefix>=8);
const free=size=>{const h=Buffer.alloc(8);h.writeUInt32BE(size);h.write('free',4);return h;};
const target=join(out,'authored-late-moov.mp4'),file=await fs.open(target,'wx');
try{
  await file.write(bytes.subarray(0,moov),0,moov,0);
  await file.write(free(prefix),0,8,moov);
  await file.write(free(padding),0,8,moov+prefix);
  await file.write(bytes.subarray(moov),0,bytes.length-moov,moov+prefix+padding);
}finally{await file.close();}
const hash=createHash('sha256');for await(const chunk of createReadStream(target))hash.update(chunk);
await fs.writeFile(join(out,'fixture.json'),JSON.stringify({format:1,authoredSource:basename(source),sourceSha256:createHash('sha256').update(await fs.readFile(source)).digest('hex'),sha256:hash.digest('hex'),moovOffset:moov+prefix+padding,bytes:(await fs.stat(target)).size,paddingBytes:prefix+padding},null,2));
