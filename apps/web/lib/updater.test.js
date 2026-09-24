import { describe, expect, it } from 'vitest';
import { decideUpdate, isNewer } from './updater.js';

/**
 * «يوجد تحديث»: متى تكفي الواجهة ومتى يلزم الـAPK؟ خطأ هنا يعني واجهةً
 * جديدة فوق كود أندرويد لا يعرف ما تطلبه، أو APK كل مرة بلا داعٍ.
 */
const manifest = (extra = {}) => ({
  versionName: '0.0.12',
  versionCode: 12,
  nativeApi: 1,
  notes: 'إصلاحات',
  web: { url: 'https://github.com/x/web.zip', sha256: 'a'.repeat(64) },
  apk: { url: 'https://github.com/x/app.apk', sha256: 'b'.repeat(64) },
  ...extra,
});

describe('decideUpdate', () => {
  it('same native code and a newer version: web only, no Android installer', () => {
    expect(decideUpdate(manifest(), { nativeApi: 1, versionCode: 10, webVersion: '0.0.10' })?.kind).toBe('web');
  });
  it('a different native code needs the APK', () => {
    expect(decideUpdate(manifest({ nativeApi: 2 }), { nativeApi: 1, versionCode: 10, webVersion: '0.0.10' })?.kind).toBe('apk');
  });
  it('nothing newer: nothing to offer', () => {
    expect(decideUpdate(manifest(), { nativeApi: 1, versionCode: 12, webVersion: '0.0.12' })).toBeNull();
    // واجهة طُبّقت فوق APK أقدم: رقم الواجهة هو المرجع
    expect(decideUpdate(manifest(), { nativeApi: 1, versionCode: 10, webVersion: '0.0.12' })).toBeNull();
  });
  it('a bundle without its checksum is never applied', () => {
    expect(decideUpdate(manifest({ web: { url: 'https://x/web.zip' } }), { nativeApi: 1, versionCode: 1, webVersion: '0.0.1' })).toBeNull();
  });
  it('compares versions part by part', () => {
    expect(isNewer('0.0.10', '0.0.9')).toBe(true);
    expect(isNewer('0.0.9', '0.0.10')).toBe(false);
  });
});
