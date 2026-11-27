import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {makeManifest,createAddon,parseOptions} from './create-vantara-addon.mjs';
import {validateManifest} from '../apps/web/addons/manifest.js';

const base='https://addons.example.org';
for(const kind of ['manga','video','subtitles','torrent']){
  test('addon-kit produces a valid '+kind+' protocol manifest',()=>{
    const manifest=makeManifest({kind,name:'Demo '+kind,origin:base});
    const checked=validateManifest(manifest,{origin:base,productVersion:'0.2.2'});
    assert.deepEqual(checked.errors,[]);
    assert.equal(checked.manifest.name,'Demo '+kind);
    assert.equal(checked.manifest.protocol,kind==='manga'?'vantara':'stremio');
    assert.equal(checked.manifest.official,false);
    assert.equal(checked.manifest.runtime,'remote');
    if(kind==='manga'){
      assert.deepEqual(checked.manifest.capabilities,['home','search','details','chapters','pages']);
      assert.equal(checked.manifest.compatibility.pwa,true);
    }else{
      assert.ok(checked.manifest.capabilities.length>0);
    }
  });
  test('addon-kit '+kind+' starter starts a real JSON HTTP server and never fabricates content',async()=>{
    const tmp=await mkdtemp(join(tmpdir(),'vantara-addon-kit-'));
    try{
      const dir=join(tmp,'demo');
      await createAddon({kind,name:'Demo '+kind,dir,origin:base});
      const files=await readdir(dir);
      assert.deepEqual(files.sort(),['README.md','addon.test.mjs','index.mjs','manifest.json','package.json'].sort());
      const {createAddonServer}=await import(pathToFileURL(join(dir,'index.mjs')).href);
      const server=createAddonServer();
      await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
      try{
        const address='http://127.0.0.1:'+server.address().port;
        const result=await fetch(address+'/manifest.json');
        assert.equal(result.status,200);
        assert.equal(result.headers.get('access-control-allow-origin'),'*');
        const manifest=await result.json();
        assert.deepEqual(manifest,makeManifest({kind,name:'Demo '+kind,origin:base}));
        const route=kind==='manga'?'/home':kind==='subtitles'?'/subtitles/movie/example.json':kind==='torrent'?'/stream/movie/example.json':'/catalog/movie/sample.json';
        const response=await fetch(address+route);
        assert.equal(response.status,200);
        const data=await response.json();
        const list=kind==='manga'?data.mangas:kind==='subtitles'?data.subtitles:kind==='torrent'?data.streams:data.metas;
        assert.deepEqual(list,[]);
        const missing=await fetch(address+'/undefined');
        assert.equal(missing.status,404);
        assert.equal((await missing.json()).error,'resource unavailable');
      }finally{await new Promise((resolve,reject)=>server.close(err=>err?reject(err):resolve()));}
      await assert.rejects(createAddon({kind,name:'Overwrite attempt',dir,origin:base}));
      assert.equal(JSON.parse(await readFile(join(dir,'manifest.json'),'utf8')).name,'Demo '+kind);
    }finally{await rm(tmp,{recursive:true,force:true});}
  });
}

test('kit rejects unsafe origins and unsupported source kinds',()=>{
  for(const origin of ['http://addons.example.org','https://127.0.0.1','https://localhost','https://a@addons.example.org','https://addons.example.org:9999','https://addons.example.org/some/path']){
    assert.throws(()=>makeManifest({kind:'manga',name:'Test',origin}),/public HTTPS origin/);
  }
  assert.throws(()=>makeManifest({kind:'cloudstream',name:'Test',origin:base}),/Choose --kind/);
  assert.deepEqual(parseOptions(['--kind','video','--name','Demo','--dir','./demo']),{kind:'video',name:'Demo',dir:'./demo'});
  assert.throws(()=>parseOptions(['--name']),/Expected/);
});
