import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {execFileSync} from 'node:child_process';
import {nativeFingerprint,nativeInputs} from '../native-fingerprint.mjs';

test('opt-in Debug fingerprints compiled runtime inputs while default channel stays independent',()=>{
  const root=mkdtempSync(join(tmpdir(),'vrt-fingerprint-'));
  const put=(p,s)=>{mkdirSync(dirname(join(root,p)),{recursive:true});writeFileSync(join(root,p),s);};
  try{
    execFileSync('git',['init','-q'],{cwd:root});
    put('android/settings.gradle','base');put('pnpm-lock.yaml','');
    put('extensions/runtime-android/executor/src/main/java/Runtime.java','one');
    put('extensions/runtime-android/executor/src/test/java/Test.java','test-one');
    execFileSync('git',['add','.'],{cwd:root});
    const base=nativeFingerprint(root),debug=nativeFingerprint(root,{runtimeDebug:true});
    assert.notEqual(debug,base);
    assert.ok(nativeInputs(root,{runtimeDebug:true}).includes('extensions/runtime-android/executor/src/main/java/Runtime.java'));
    put('extensions/runtime-android/executor/src/main/java/Runtime.java','two');
    assert.equal(nativeFingerprint(root),base);
    assert.notEqual(nativeFingerprint(root,{runtimeDebug:true}),debug);
    const next=nativeFingerprint(root,{runtimeDebug:true});
    put('extensions/runtime-android/executor/src/test/java/Test.java','test-two');
    assert.equal(nativeFingerprint(root,{runtimeDebug:true}),next);
  }finally{rmSync(root,{recursive:true,force:true});}
});
