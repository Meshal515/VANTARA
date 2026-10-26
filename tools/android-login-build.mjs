/** Builds unmodified stable-212 and the candidate as real Release variants for CI. */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { nativeFingerprint } from './native-fingerprint.mjs';
if (process.env.GITHUB_ACTIONS !== 'true') throw new Error('Run only in the isolated GitHub Actions checkout; never overlay a developer worktree');
const phase = process.argv[2];
if (!['baseline', 'candidate'].includes(phase)) throw new Error('expected baseline or candidate');
const ref = phase === 'baseline' ? 'f557a61de26f01fb8074c34d7db586006562efd7' : process.env.GITHUB_SHA;
if (!ref || !/^[a-f0-9]{40}$/.test(ref)) throw new Error('exact source commit required');
const tree = execFileSync('git', ['archive', ref, 'apps/web', 'android'], { maxBuffer: 64 * 1024 * 1024 });
execFileSync('tar', ['-xf', '-'], { input: tree });
const config = 'apps/web/lib/config.js';
let source = readFileSync(config, 'utf8');
for (const [key, value] of Object.entries({SYNC_URL: 'http://localhost:8765', API_URL: '', UPDATES_URL: '', VERSION: '0.0.212'})) {
  source = source.replaceAll(`__VANTARA_${key}__`, value);
}
writeFileSync(config, source);
const instrument = 'android/app/src/androidTest/java/com/vantara/login';
mkdirSync(instrument, { recursive: true });
copyFileSync('tools/android-login-ReleaseLoginDeviceTest.kt', `${instrument}/ReleaseLoginDeviceTest.kt`);
execFileSync('pnpm', ['exec', 'cap', 'sync', 'android'], { stdio: 'inherit' });
const fingerprint = nativeFingerprint();
writeFileSync('android/app/src/main/assets/public/vantara-bundle.json', JSON.stringify({version:'0.0.212',native:fingerprint}));
execFileSync('./gradlew', ['--no-daemon', '-I', process.env.ANDROID_LOGIN_GRADLE_INIT, ':app:assembleRelease', ':app:assembleReleaseAndroidTest'], {
  cwd: 'android', stdio: 'inherit', env: {...process.env,VANTARA_VERSION_NAME:'0.0.212',VANTARA_VERSION_CODE:'212',VANTARA_NATIVE:fingerprint},
});
const out = resolve(process.env.RUNNER_TEMP, 'android-login', phase);
mkdirSync(out, { recursive: true });
const appDir = 'android/app/build/outputs/apk/release';
const testDir = 'android/app/build/outputs/apk/androidTest/release';
copyFileSync(`${appDir}/${readdirSync(appDir).find(n => n.endsWith('.apk'))}`, `${out}/app-release.apk`);
copyFileSync(`${testDir}/${readdirSync(testDir).find(n => n.endsWith('.apk'))}`, `${out}/app-release-androidTest.apk`);
writeFileSync(`${out}/source.json`, JSON.stringify({phase,sourceSha:ref,buildType:'release',testAbi:'x86_64',nativeFingerprint:fingerprint,fixtureOnly:true}, null, 2));
