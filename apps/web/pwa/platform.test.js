import { describe, expect, it } from 'vitest';
import { isNative, isWeb, webPlugin } from './platform.js';
import { installWebBridges } from './boot.js';

const native = { Capacitor: { isNativePlatform: () => true, Plugins: {} } };

describe('platform gate', () => {
  it('knows the APK from the browser by the native bridge only', () => {
    expect(isNative(native)).toBe(true);
    expect(isNative({ Capacitor: { getPlatform: () => 'android' } })).toBe(true);
    expect(isNative({ Capacitor: { isNativePlatform: () => false } })).toBe(false);
    expect(isNative({})).toBe(false);
    // جسر يرمي: يُعامل كأصلي فلا يُحقن فيه شيء من الويب
    expect(isNative({ Capacitor: { isNativePlatform: () => { throw new Error('x'); } } })).toBe(true);
    expect(isWeb({})).toBe(true);
  });

  it('boot installs web bridges in the browser and nothing inside the APK', () => {
    const app = { ...native };
    expect(installWebBridges(app)).toBeNull();
    expect(app.VantaraWeb).toBeUndefined();
    expect(webPlugin('ExtensionEngine', { ...native, VantaraWeb: { ExtensionEngine: {} } })).toBeNull();

    const browser = {};
    const web = installWebBridges(browser);
    expect(web.ExtensionEngine).toBeTruthy();
    expect(webPlugin('ExtensionEngine', browser)).toBe(web.ExtensionEngine);
    expect(installWebBridges(browser)).toBe(web);
  });
});
