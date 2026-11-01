import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,mkdirSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';

test('publisher names with spaces and Arabic stay one Gradle instrumentation argument',()=>{
 const dir=mkdtempSync(join(tmpdir(),'vantara-video-args-'));
 try {
  const bin=join(dir,'bin');mkdirSync(bin);
  const argsFile=join(dir,'args.json');
  // Intercept the Gradle launcher only. No fake source/media PASS is produced.
  writeFileSync(join(bin,'bash'),`#!/usr/bin/env node\nrequire('node:fs').writeFileSync(process.env.ARG_CAPTURE,JSON.stringify(process.argv.slice(2)));process.exit(23);\n`,{mode:0o755});
  writeFileSync(join(bin,'adb'),'#!/bin/sh\nexit 0\n',{mode:0o755});
  const providers='Asia2tv 2,Dima toon,Cee (🇮🇶),مصدر عربي';
  const script=resolve('tools/repository-compat/run_live_video.sh');
  const result=spawnSync('/bin/bash',[script],{cwd:dir,encoding:'utf8',env:{...process.env,PATH:bin+':'+process.env.PATH,ARG_CAPTURE:argsFile,VANTARA_LIVE_ONLY:providers,VANTARA_LIVE_LIMIT:'8',VANTARA_NATIVE_VIDEO:'true'}});
  assert.notEqual(result.status,0,'An intercepted/failed Gradle run must not become source success');
  const args=JSON.parse(readFileSync(argsFile,'utf8'));
  assert.ok(args.includes('-Pandroid.testInstrumentationRunnerArguments.vantaraOnly='+providers),JSON.stringify(args));
  assert.equal(args.filter(x=>x.startsWith('-Pandroid.testInstrumentationRunnerArguments.vantaraOnly=')).length,1);
 } finally {rmSync(dir,{recursive:true,force:true});}
});
