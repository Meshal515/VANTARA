import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildManifest } from './update-manifest.mjs';
import { validateStableManifest } from './release-manifest-validation.mjs';

const inputs = files => ({version:'0.0.140',code:140,native:'a'.repeat(24),base:'https://github.com/Meshal515/VANTARA/releases/download/stable-140',...files,changelog:['Fix'],policy:{minimumSupportedVersionCode:0}});
const fixture = t => {
  const dir=mkdtempSync(join(tmpdir(),'vantara-release-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const files={apk:join(dir,'VANTARA-stable.apk'),web:join(dir,'VANTARA-web.zip')};
  for(const file of Object.values(files))writeFileSync(file,'verified package');
  return files;
};
test('stable manifests require a valid version, supported minimum and exact release URL',t=>{
  const good=inputs(fixture(t));
  for(const bad of [{code:0},{code:1.5},{version:'preview'},{base:good.base.replace('140','141')},{policy:{minimumSupportedVersionCode:141}}])
    assert.throws(()=>buildManifest({...good,...bad}));
  writeFileSync(good.web,'');
  assert.throws(()=>buildManifest(good),/empty/);
});
test('published APK/web bytes must match size and checksum before advertising Windows',t=>{
  const files=fixture(t), manifest=buildManifest(inputs(files));
  assert.equal(validateStableManifest(manifest,files),manifest);
  for(const bad of [
    {...manifest,apk:{...manifest.apk,url:manifest.apk.url.replace('.apk','.exe')}},
    {...manifest,web:{...manifest.web,sha256:'bad'}},
    {...manifest,apk:{...manifest.apk,size:0}},
  ])assert.throws(()=>validateStableManifest(bad,files));
  writeFileSync(files.apk,'corrupted package');
  assert.throws(()=>validateStableManifest(manifest,files),/integrity/);
});
test('GITHUB_TOKEN stable publication has a workflow completion trigger and retry path',async()=>{
  const {readFileSync}=await import('node:fs');
  const companion=readFileSync(new URL('../.github/workflows/windows-stable-companion.yml',import.meta.url),'utf8');
  assert.match(companion,/workflow_run:[\s\S]*workflows: \['Android stable APK'\]/);
  assert.match(companion,/workflow_dispatch:[\s\S]*stable_tag:/);
  assert.match(companion,/head_repository.full_name == github.repository/);
  const workflow=readFileSync(new URL('../.github/workflows/android-stable.yml',import.meta.url),'utf8');
  assert.match(workflow,/--draft/);
  assert.match(workflow,/del\(\.desktop\)/);
  assert.ok(workflow.indexOf('release-manifest-validation.mjs')<workflow.indexOf('--draft=false --latest'));
});
