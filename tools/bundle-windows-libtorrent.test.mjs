import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {pinnedDownload,LIBTORRENT_WINDOWS_ARTIFACTS} from './bundle-windows-libtorrent.mjs';

test('runtime, wheel and redistribution licenses are pinned independently',()=>{
  assert.equal(LIBTORRENT_WINDOWS_ARTIFACTS.length,4);
  assert.match(LIBTORRENT_WINDOWS_ARTIFACTS[0].url,/^https:\/\/www\.python\.org\/.*embeddable-amd64\.zip$/);
  assert.match(LIBTORRENT_WINDOWS_ARTIFACTS[1].url,/^https:\/\/files\.pythonhosted\.org\/.*cp313-cp313-win_amd64\.whl$/);
  for(const artifact of LIBTORRENT_WINDOWS_ARTIFACTS)assert.match(artifact.sha256,/^[a-f0-9]{64}$/);
});
test('a corrupt download cannot replace a verified artifact and a valid cached file is reused',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'vantara-native-pins-'));t.after(()=>rm(dir,{force:true,recursive:true}));
  const bytes=Buffer.from('owned fixture'),artifact={name:'owned.zip',url:'https://example.test/owned.zip',sha256:createHash('sha256').update(bytes).digest('hex')};
  const filename=await pinnedDownload(artifact,dir,async()=>new Response(bytes));
  assert.deepEqual(await readFile(filename),bytes);
  assert.equal(await pinnedDownload(artifact,dir,()=>{throw Error('must not refetch');}),filename);
  await writeFile(filename,'corrupt cache');
  await assert.rejects(()=>pinnedDownload(artifact,dir,async()=>new Response('wrong bytes')),/checksum/);
  assert.equal(await readFile(filename,'utf8'),'corrupt cache');
  await assert.rejects(()=>pinnedDownload({...artifact,name:'../escape'},dir),/Invalid/);
});
