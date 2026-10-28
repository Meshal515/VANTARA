'use strict';
const fs = require('node:fs');
const path = require('node:path');

/** Select the experimental libtorrent worker only for an explicit local
 * command-line preview. Stable has no flag and always remains on rqbit.
 * Never download runtimes on startup or consult system-installed Python.
 */
function selectTorrentPreview({argv=[],platform=process.platform,packaged=false,nativeDir,exists=fs.existsSync,read=fs.readFileSync}={}) {
  const flag = '--vantara-torrent-preview=libtorrent';
  if (!argv.includes(flag)) return {torrentBackend:'rqbit',binaries:{}};
  if (platform!=='win32' || !packaged || typeof nativeDir!=='string' || !path.isAbsolute(nativeDir))
    throw new Error('تجربة libtorrent تتطلب حزمة Windows Preview مستقلة');
  const root=path.join(nativeDir,'libtorrent');
  const manifestPath=path.join(root,'LIBTORRENT-MANIFEST.json');
  const python=path.join(root,'python','python.exe');
  const script=path.join(root,'server.py');
  const isolated=path.join(root,'python','python313._pth');
  for (const file of [manifestPath,python,script,isolated])
    if (!exists(file)) throw new Error('حزمة libtorrent الاختبارية ناقصة؛ لم يُغيَّر محرك Stable');
  let manifest;
  try { manifest=JSON.parse(read(manifestPath,'utf8')); } catch { throw new Error('بيانات حزمة libtorrent غير صالحة'); }
  if (manifest?.format!==1 || manifest?.engine!=='libtorrent' || manifest?.version!=='2.0.13' ||
      manifest?.python!=='3.13.17' || manifest?.platform!=='win32-x64' || manifest?.default!==false)
    throw new Error('نسخة محرك libtorrent الاختباري غير متوافقة');
  return {torrentBackend:'libtorrent',binaries:{libtorrentPython:python,libtorrentScript:script}};
}
module.exports={selectTorrentPreview};
