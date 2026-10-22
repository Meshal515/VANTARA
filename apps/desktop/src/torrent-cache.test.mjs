import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {selectTorrentCacheRoot,validateStreamingHeadroom,prepareTorrentCache,cacheNamespace,MiB,TORRENT_FREE_RESERVE} from './torrent-cache.mjs';

test('Windows chooses the writable fixed drive with most *free* space, not profile C:',async()=>{
  const sizes=new Map([['C:\\',679n*MiB],['D:\\',38n*1024n*MiB],['E:\\',69n*1024n*MiB],['M:\\',89n*1024n*MiB],['C:\\Users\\Vantara',679n*MiB]]);
  const choice=await selectTorrentCacheRoot({
    platform:'win32',userData:'C:\\Users\\Vantara',roots:['C:\\','D:\\','E:\\','M:\\'],
    statfs:async path=>({bavail:sizes.get(path)??0n,bsize:1n}),writable:async()=>true,
  });
  assert.equal(choice.root,'M:\\');
});
test('skips unwritable high-capacity drives and keeps the working fallback',async()=>{
  const choice=await selectTorrentCacheRoot({
    platform:'win32',userData:'/profile',roots:['M:\\','E:\\'],
    statfs:async path=>({bavail:path==='M:\\'?9000n*MiB:path==='E:\\'?7000n*MiB:600n*MiB,bsize:1n}),
    writable:async path=>path!=='M:\\',
  });
  assert.equal(choice.root,'E:\\');
});
test('fails closed when all volumes have under 512 MiB available',async()=>{
  await assert.rejects(selectTorrentCacheRoot({
    userData:'/profile',platform:'win32',roots:['C:\\'],
    statfs:async()=>({bavail:10n*MiB,bsize:1n}),writable:async()=>true,
  }),/512/);
});
test('torrent is checked for safe headroom, not rejected for logical video length',()=>{
  const ninetyGiB=90*1024**3;
  assert.equal(validateStreamingHeadroom({length:ninetyGiB},TORRENT_FREE_RESERVE+1n),ninetyGiB);
  assert.throws(()=>validateStreamingHeadroom({length:ninetyGiB},10n*MiB),/المساحة/);
  assert.throws(()=>validateStreamingHeadroom({length:null},1000n*MiB),/حجم/);
});
test('only a namespaced cache is cleared on next launch, unrelated files survive',async t=>{
  const root=await fs.mkdtemp(join(tmpdir(),'vantara-cache-choice-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const owner='/some/profile',path=join(root,cacheNamespace(owner)),neighbor=join(root,'keep.txt');
  await fs.mkdir(path,{recursive:true});await fs.writeFile(join(path,'stale-piece'),'bytes');
  await fs.writeFile(neighbor,'do-not-delete');
  assert.equal(await prepareTorrentCache(root,owner),path);
  await assert.rejects(fs.access(join(path,'stale-piece')),{code:'ENOENT'});
  assert.equal(await fs.readFile(neighbor,'utf8'),'do-not-delete');
});
