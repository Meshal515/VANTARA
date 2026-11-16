import { afterEach, expect, it, vi } from 'vitest';
import { parseHTML } from 'linkedom';
vi.mock('./reader-translate.js', () => ({ createReaderTranslation: () => ({ attach() {}, openGate() {}, focus() {}, needs: () => false, enabled: () => false, isOn: () => false, destroy() {}, onImage() {} }) }));
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

// #323 U-07/U-08: القارئ الساكن كان يرسل progress.set ويكتب خريطة المواضع كاملة كل 5 ثوانٍ بلا تغيير
it('an idle reader does not resend progress or rewrite positions every 5 seconds', async () => {
  vi.useFakeTimers(); vi.resetModules();
  const { window, document } = parseHTML('<html><body></body></html>');
  document.visibilityState = 'visible';
  vi.stubGlobal('document', document); vi.stubGlobal('window', window); vi.stubGlobal('navigator', { onLine: true });
  let writes = 0;
  const store = new Map();
  vi.stubGlobal('localStorage', { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => { if (k.includes('pos')) writes += 1; store.set(k, v); }, removeItem: (k) => store.delete(k) });
  vi.stubGlobal('Image', class { constructor() { const img = document.createElement('img'); img.decode = async () => {}; img.naturalWidth = 800; img.naturalHeight = 3000; return img; } });
  vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} });
  window.HTMLElement.prototype.scrollTo = function ({ top = 0 }) { this.scrollTop = top; };
  window.HTMLElement.prototype.getBoundingClientRect = () => ({ top: 0, bottom: 1000, height: 1000 });
  vi.stubGlobal('requestAnimationFrame', (fn) => setTimeout(fn, 0)); vi.stubGlobal('cancelAnimationFrame', clearTimeout);
  const engine = {
    pages: async (sourceId, chapter) => Array.from({ length: 6 }, (_, i) => ({ url: `${sourceId}${chapter.url}/${i}` })),
    pageImage: async (sourceId, page) => ({ src: `img:${page.url}` }),
  };
  const rows = [1, 2].map((n) => ({ number: n, sourceId: 'A', label: 'A', chapter: { url: `/A/${n}`, name: `Chapter ${n}`, chapter_number: n } }));
  const sent = [];
  const sync = { user: { userId: 'u' }, rows: () => [], enqueue: (kind, payload) => { if (kind === 'progress.set') sent.push(payload); } };
  const { openSmartReader } = await import('./reader.js');
  const reader = openSmartReader({ sync, engine, mount: (n) => document.body.append(n), exit() {} },
    { title: 'Idle', seriesRef: 'w', rows, row: rows[0], work: { id: 'w', _editions: [] } });
  for (let n = 0; n < 40; n++) await vi.advanceTimersByTimeAsync(200);
  const settledSent = sent.length, settledWrites = writes;
  // 25 ثانية بلا أي حركة: لا إرسال جديد، ولا إعادة كتابة للمواضع
  await vi.advanceTimersByTimeAsync(25_000);
  expect(sent.length - settledSent).toBe(0);
  expect(writes - settledWrites).toBe(0);
  reader.destroy();
});
