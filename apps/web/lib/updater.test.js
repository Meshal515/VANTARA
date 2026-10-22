import { describe, expect, it } from 'vitest';
import { decideUpdate, dismissedRecently, isNewer } from './updater.js';

const manifest = (over = {}) => ({
  format: 2,
  versionName: '0.0.9',
  versionCode: 9,
  native: 'aaaaaaaaaaaaaaaaaaaaaaaa',
  minimumSupportedVersionCode: 0,
  changelog: ['تحسين القارئ'],
  apk: { url: 'https://github.com/Meshal515/VANTARA/releases/download/stable-9/VANTARA-stable.apk', sha256: 'a'.repeat(64), size: 1 },
  web: { url: 'https://github.com/Meshal515/VANTARA/releases/download/stable-9/VANTARA-web.zip', sha256: 'b'.repeat(64), size: 1 },
  ...over,
});
const device = (over = {}) => ({ versionCode: 5, native: 'aaaaaaaaaaaaaaaaaaaaaaaa', webVersion: '0.0.7', bad: [], staged: null, ...over });

describe('isNewer', () => {
  it('compares numerically, part by part', () => {
    expect(isNewer('0.0.12', '0.0.9')).toBe(true);
    expect(isNewer('0.0.9', '0.0.9')).toBe(false);
    expect(isNewer('0.0.9', null)).toBe(true);
  });
});

describe('decideUpdate', () => {
  it('same native code: a newer web bundle, silently, and no APK', () => {
    const out = decideUpdate(manifest(), device());
    expect(out.apk).toBeNull();
    expect(out.web).toMatchObject({ version: '0.0.9', url: 'https://github.com/Meshal515/VANTARA/releases/download/stable-9/VANTARA-web.zip' });
  });

  it('native code changed: the APK, never a web bundle that needs code the phone lacks', () => {
    const out = decideUpdate(manifest({ native: 'bbbbbbbbbbbbbbbbbbbbbbbb' }), device());
    expect(out.web).toBeNull();
    expect(out.apk).toMatchObject({ version: '0.0.9', versionCode: 9, required: false, changelog: ['تحسين القارئ'] });
  });

  it('below the minimum supported version: the APK is required, even with the same native code', () => {
    const out = decideUpdate(manifest({ minimumSupportedVersionCode: 6 }), device());
    expect(out.apk).toMatchObject({ required: true });
  });

  it('never offers an APK that is not newer than the installed one', () => {
    expect(decideUpdate(manifest({ native: 'c'.repeat(24), versionCode: 5 }), device()).apk).toBeNull();
  });

  it('skips a web version this phone already rolled back, or already has waiting', () => {
    expect(decideUpdate(manifest(), device({ bad: ['0.0.9'] })).web).toBeNull();
    expect(decideUpdate(manifest(), device({ staged: '0.0.9' })).web).toBeNull();
    expect(decideUpdate(manifest(), device({ webVersion: '0.0.9' })).web).toBeNull();
  });

  it('requires a checksum for anything it downloads', () => {
    expect(decideUpdate(manifest({ web: { url: 'https://x/w.zip' } }), device()).web).toBeNull();
    expect(decideUpdate(manifest({ native: 'd'.repeat(24), apk: { url: 'https://x/a.apk' } }), device()).apk).toBeNull();
  });

  it('a local debug build never updates itself; an old-format manifest is ignored', () => {
    expect(decideUpdate(manifest(), device({ native: 'dev' }))).toEqual({ web: null, apk: null });
    expect(decideUpdate({ versionName: '0.0.9', nativeApi: 2 }, device())).toEqual({ web: null, apk: null });
  });
});

describe('dismissedRecently', () => {
  it('a required update can never be postponed', () => {
    expect(dismissedRecently({ version: '0.0.9', required: true })).toBe(false);
  });
});

describe('stable platform manifest boundaries',()=>{
  it('Windows assets never become an APK update',()=>{
    const desktop={url:'https://github.com/Meshal515/VANTARA/releases/download/stable-9/VANTARA-0.0.9-Windows-x64-Setup.exe',sha256:'a'.repeat(64),size:2048};
    expect(decideUpdate(manifest({native:'b'.repeat(24),apk:desktop,desktop}),device()).apk).toBeNull();
    expect(decideUpdate(manifest({native:'b'.repeat(24),apk:null,desktop}),device()).apk).toBeNull();
  });
  it('rejects wrong tags, malformed hashes, absent sizes and unpublished metadata',()=>{
    for(const apk of [
      {...manifest().apk,url:manifest().apk.url.replace('stable-9','stable-10')},
      {...manifest().apk,sha256:'bad'}, {...manifest().apk,size:0},
    ]) expect(decideUpdate(manifest({native:'b'.repeat(24),apk}),device()).apk).toBeNull();
    for(const over of [{format:1},{versionName:'preview'},{versionCode:'9'},{minimumSupportedVersionCode:10}])
      expect(decideUpdate(manifest(over),device())).toEqual({web:null,apk:null});
    expect(decideUpdate(manifest({native:'b'.repeat(24)}),device({official:false})).apk).toBeNull();
  });
});

describe('manual web staging ownership', () => {
  it('marks the requested download so native boot may finish it after interruption', async () => {
    const previous = globalThis.Capacitor;
    let requested;
    globalThis.Capacitor = { Plugins: { AppUpdate: { downloadWeb: async options => { requested = options; } } } };
    try {
      const { stageWeb } = await import('./updater.js');
      expect(await stageWeb({ url: 'https://x/web.zip', version: '0.0.9', sha256: 'a'.repeat(64) })).toBe(true);
      expect(requested.userInitiated).toBe(true);
    } finally { globalThis.Capacitor = previous; }
  });
});
