import { describe, expect, it } from 'vitest';
import { decideUpdate, dismissedRecently, isNewer } from './updater.js';

const manifest = (over = {}) => ({
  format: 2,
  versionName: '0.0.9',
  versionCode: 9,
  native: 'aaaaaaaaaaaaaaaaaaaaaaaa',
  minimumSupportedVersionCode: 0,
  changelog: ['تحسين القارئ'],
  apk: { url: 'https://x/VANTARA-stable.apk', sha256: 'a'.repeat(64), size: 1 },
  web: { url: 'https://x/VANTARA-web.zip', sha256: 'b'.repeat(64), size: 1 },
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
    expect(out.web).toMatchObject({ version: '0.0.9', url: 'https://x/VANTARA-web.zip' });
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
