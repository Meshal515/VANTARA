const {test}=require('node:test');
const assert=require('node:assert/strict');
const os=require('node:os');
const fs=require('node:fs');
const path=require('node:path');
const {selectTorrentPreview}=require('./torrent-preview.cjs');
const flag='--vantara-torrent-preview=libtorrent';

test('normal Windows Stable and every platform stay on rqbit without the exact opt-in flag',()=>{
  for(const argv of [[],['--vantara-torrent-preview=other'],['--vantara-torrent-preview=libtorrentX']])
    assert.deepEqual(selectTorrentPreview({argv,platform:'win32',packaged:true,nativeDir:'C:\\VANTARA\\native'}),{torrentBackend:'rqbit',binaries:{}});
});
test('the preview is blocked for unpackaged or non-Windows apps even if the flag is present',()=>{
  for(const props of [{platform:'linux',packaged:true},{platform:'win32',packaged:false}])
    assert.throws(()=>selectTorrentPreview({argv:[flag],nativeDir:'/native',...props}),/Windows Preview/);
});
test('the preview never falls back silently on a missing or incompatible pinned bundle',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vantara-libtorrent-preview-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  assert.throws(()=>selectTorrentPreview({argv:[flag],nativeDir:dir,platform:'win32',packaged:true}),/ناقصة/);
  const base=path.join(dir,'libtorrent');
  fs.mkdirSync(path.join(base,'python'),{recursive:true});
  for(const rel of ['python/python.exe','server.py','python/python313._pth'])fs.writeFileSync(path.join(base,rel),'owned-test');
  const manifest={format:1,engine:'libtorrent',version:'2.0.13',python:'3.13.17',platform:'win32-x64',default:false};
  fs.writeFileSync(path.join(base,'LIBTORRENT-MANIFEST.json'),JSON.stringify({...manifest,version:'1.0.0'}));
  assert.throws(()=>selectTorrentPreview({argv:[flag],nativeDir:dir,platform:'win32',packaged:true}),/غير متوافقة/);
  fs.writeFileSync(path.join(base,'LIBTORRENT-MANIFEST.json'),JSON.stringify(manifest));
  assert.deepEqual(selectTorrentPreview({argv:[flag],nativeDir:dir,platform:'win32',packaged:true}),{
    torrentBackend:'libtorrent',binaries:{
      libtorrentPython:path.join(base,'python','python.exe'),
      libtorrentScript:path.join(base,'server.py')
    }
  });
});
