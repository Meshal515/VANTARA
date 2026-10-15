#!/usr/bin/env node
/** Add a verified Windows installer to the existing Android/PWA stable manifest.
 * Do not publish the changed manifest until the Windows release assets are uploaded.
 */
import { createHash } from 'node:crypto';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { validateStableManifest } from './release-manifest-validation.mjs';

export function joinDesktopRelease(manifest, { installerPath, baseUrl, version } = {}) {
  validateStableManifest(manifest);
  if (version !== manifest.versionName) throw new Error('نسخة ويندوز لا تطابق إصدار Android');
  const name=basename(installerPath ?? '');
  if (name !== `VANTARA-${version}-Windows-x64-Setup.exe`) throw new Error('اسم مثبت ويندوز غير مطابق');
  const release = `https://github.com/Meshal515/VANTARA/releases/download/stable-${manifest.versionCode}`;
  if (baseUrl !== release) throw new Error('رابط الإصدار المستقر لا يطابق manifest');
  const size=statSync(installerPath).size;
  if (!Number.isSafeInteger(size)||size<1024) throw new Error('مثبت ويندوز غير موجود أو فارغ');
  const sha256=createHash('sha256').update(readFileSync(installerPath)).digest('hex');
  return {
    ...manifest,
    desktop: {
      version,
      url:`${release}/${name}`,
      sha256,
      size,
      platform:'win32-x64',
      installer:'nsis',
    },
  };
}

if(process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const options=Object.fromEntries(process.argv.slice(2).reduce((items,arg,index,array)=> {
    if(index%2===0)items.push([arg.replace(/^--/,''),array[index+1]]);
    return items;
  }, []));
  const manifest=JSON.parse(readFileSync(options.input,'utf8'));
  const result=joinDesktopRelease(manifest,{
    installerPath:options.installer,baseUrl:options.base,version:options.version,
  });
  writeFileSync(options.output,JSON.stringify(result,null,2)+'\n');
  process.stdout.write(`Updated Windows release manifest for ${result.versionName}\n`);
}
