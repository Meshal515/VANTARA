import { afterEach, expect, it, vi } from 'vitest';
import { parseHTML } from 'linkedom';
import { createDesktopApp } from './app.js';
afterEach(() => vi.unstubAllGlobals());
it('يعيد استعمال مدير الإضافات ويوفر دخول الحسابات دون إنشاء حساب بديل', async () => {
  const { window, document } = parseHTML('<html><body><div id="root"></div></body></html>');
  vi.stubGlobal('window', window); vi.stubGlobal('document', document);
  vi.stubGlobal('localStorage', { getItem: () => null, setItem() {} });
  const data = new Map();
  const runtime = { store: { get: async (ns,key) => data.get(ns+key), set: async (ns,key,value) => data.set(ns+key,{value}) }, addons: { ready: Promise.resolve(), registry: { list: () => [], setProfile() {} } } };
  const app = await createDesktopApp({ root: document.getElementById('root'), runtime });
  expect(document.querySelector('.addon-hub')).toBeTruthy();
  expect(document.querySelector('[data-import-url]')).toBeTruthy();
  expect(document.querySelector('[data-desktop-accounts]').getAttribute('href')).toBe('/index.html');
  expect(document.querySelector('[data-desktop-section="cinema"]')).toBeTruthy();
  expect(document.querySelector('[data-desktop-section="anime"]')).toBeTruthy();
  expect(document.body.textContent).not.toContain('داخل التطبيق فقط');
  app.close();
});
