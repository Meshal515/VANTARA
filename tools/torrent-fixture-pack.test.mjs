import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {verifyFixturePack} from './torrent-fixture-pack.mjs';
test('common comparison artifact rejects changed bytes or untrusted fixture paths',async t=>{
  const root=await fs.mkdtemp(join(tmpdir(),'vantara-common-fixtures-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const files=[];
  for(const kind of ['mp4','late-moov','mkv']){
    const name=`authored-${kind}.${kind==='mkv'?'mkv':'mp4'}`,data=Buffer.from(kind);
    await fs.writeFile(join(root,name),data);files.push({kind,name,bytes:data.length,fileIdx:0,infoHash:'a'.repeat(40),sha256:createHash('sha256').update(data).digest('hex')});
  }
  const save=()=>fs.writeFile(join(root,'fixtures-manifest.json'),JSON.stringify({format:1,files}));await save();
  await assert.doesNotReject(verifyFixturePack(root));
  await fs.writeFile(join(root,files[0].name),'xxx');await assert.rejects(verifyFixturePack(root),/SHA256/);
  files[0].name='../outside';await save();await assert.rejects(verifyFixturePack(root),/Untrusted/);
});
