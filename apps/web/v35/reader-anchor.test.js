import { afterEach, expect, it, vi } from 'vitest';
import { parseHTML } from 'linkedom';
vi.mock('./reader-translate.js', () => ({ createReaderTranslation: () => ({ attach() {}, openGate() {}, focus() {}, needs: () => false, enabled: () => false, isOn: () => false, destroy() {}, onImage() {} }) }));
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

// iPhone (Safari/WebKit) has no CSS scroll anchoring: a page above the reader that finishes loading grows from its
// placeholder to its real height and pushes the page being read down (measured: 16 072 px in one chapter).
it.each([[false, 2735], [true, 0]])('a page loading above the reader keeps the reading place (native anchoring=%s)', async (native, shift) => {
  vi.useFakeTimers(); vi.resetModules();
  const { window, document } = parseHTML('<html><body></body></html>');
  document.visibilityState = 'visible';
  vi.stubGlobal('document', document); vi.stubGlobal('window', window); vi.stubGlobal('navigator', { onLine: true });
  vi.stubGlobal('localStorage', { getItem: () => null, setItem() {} });
  vi.stubGlobal('CSS', { supports: (p) => p === 'overflow-anchor' ? native : false });
  vi.stubGlobal('Image', class { constructor() { const img = document.createElement('img'); img.decode = async () => {}; img.naturalWidth = 360; img.naturalHeight = 3000; return img; } });
  vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} });
  window.HTMLElement.prototype.scrollTo = function ({ top = 0 }) { this.scrollTop = top; };
  // Geometry: page heights stack; a loaded page is 3000 px, a placeholder 265 px. The scroller sits at y=0.
  const heightOf = (f) => (f.querySelector('img') ? 3000 : 265);
  window.HTMLElement.prototype.getBoundingClientRect = function () {
    const scroll = document.querySelector('#rdScroll');
    if (this === scroll) return { top: 0, bottom: 844, height: 844 };
    if (!this.classList.contains('rd-page')) return { top: 0, bottom: 0, height: 0 };
    let y = -(scroll?.scrollTop ?? 0);
    for (const f of document.querySelectorAll('.rd-page')) { if (f === this) break; y += heightOf(f); }
    const h = heightOf(this); return { top: y, bottom: y + h, height: h };
  };
  vi.stubGlobal('requestAnimationFrame', (fn) => setTimeout(fn, 0)); vi.stubGlobal('cancelAnimationFrame', clearTimeout);
  let release; const late = new Promise((r) => { release = r; });
  const engine = {
    pages: async () => Array.from({ length: 6 }, (_, i) => ({ url: `p${i}` })),
    pageImage: async (_s, page) => (page.url === 'p0' ? late : { src: `img:${page.url}` }),
  };
  const row = { number: 1, sourceId: 'A', chapter: { url: '/1', name: 'Chapter 1' } };
  const { openSmartReader } = await import('./reader.js');
  const reader = openSmartReader({ sync: { user: { userId: 'u' }, rows: () => [], enqueue() {} }, engine, mount: (n) => document.body.append(n), exit() {} },
    { title: 'W', seriesRef: 'w', rows: [row], row, work: null });
  for (let n = 0; n < 30; n++) await vi.advanceTimersByTimeAsync(100);
  const scroll = document.querySelector('#rdScroll');
  scroll.scrollTop = 1000; // reading below page 0, which is still a placeholder
  const reading = [...document.querySelectorAll('.rd-page')][2];
  const before = reading.getBoundingClientRect().top;
  release({ src: 'img:p0' });
  for (let n = 0; n < 30; n++) await vi.advanceTimersByTimeAsync(100);
  // Without native anchoring the reader compensates exactly; with it the browser does, so the reader must not.
  expect(scroll.scrollTop).toBe(1000 + shift);
  expect(reading.getBoundingClientRect().top - before).toBe(native ? 2735 : 0);
  reader.destroy();
});
