import { afterEach, expect, it, vi } from 'vitest';
import { parseHTML } from 'linkedom';
vi.mock('./reader-translate.js', () => ({ createReaderTranslation: () => ({ attach() {}, openGate() {}, focus() {}, needs: () => false, enabled: () => false, isOn: () => false, destroy() {}, onImage() {} }) }));
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

// Reported: reading into the next chapter sometimes «kicked out» the reader. One page failing on its source made the
// reader reopen the whole chapter from another source: earlier chapters removed and the position reset to the top.
it('a page that fails on its source is filled in place from another source; the reading is never reset', async () => {
  vi.useFakeTimers(); vi.resetModules();
  const { window, document } = parseHTML('<html><body></body></html>');
  document.visibilityState = 'visible';
  vi.stubGlobal('document', document); vi.stubGlobal('window', window); vi.stubGlobal('navigator', { onLine: true });
  vi.stubGlobal('localStorage', { getItem: () => null, setItem() {} });
  vi.stubGlobal('Image', class { constructor() { const img = document.createElement('img'); img.decode = async () => {}; img.naturalWidth = 800; img.naturalHeight = 3000; return img; } });
  vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} });
  window.HTMLElement.prototype.scrollTo = function ({ top = 0 }) { this.scrollTop = top; };
  window.HTMLElement.prototype.getBoundingClientRect = () => ({ top: 0, bottom: 1000, height: 1000 });
  vi.stubGlobal('requestAnimationFrame', (fn) => setTimeout(fn, 0)); vi.stubGlobal('cancelAnimationFrame', clearTimeout);
  const asked = [];
  let failNow; const failing = new Promise((_, reject) => { failNow = () => reject(new Error('cloudflare')); }); failing.catch(() => {});
  const engine = {
    pages: async (sourceId, chapter) => Array.from({ length: 6 }, (_, i) => ({ url: `${sourceId}${chapter.url}/${i}` })),
    pageImage: async (sourceId, page) => { asked.push(page.url); if (page.url === 'A/A/1/3') return failing; return { src: `img:${page.url}` }; },
  };
  const chapters = (s) => [1, 2].map((n) => ({ url: `/${s}/${n}`, name: `Chapter ${n}`, chapter_number: n }));
  const work = { id: 'w', _editions: [{ sourceId: 'A', label: 'A', chapters: chapters('A') }, { sourceId: 'B', label: 'B', chapters: chapters('B') }] };
  const rows = [1, 2].map((n) => ({ number: n, sourceId: 'A', label: 'A', chapter: { url: `/A/${n}`, name: `Chapter ${n}`, chapter_number: n } }));
  const { openSmartReader } = await import('./reader.js');
  const reader = openSmartReader({ sync: { user: { userId: 'u' }, rows: () => [], enqueue() {} }, engine, mount: (n) => document.body.append(n), exit() {} },
    { title: 'Webtoon', seriesRef: 'w', rows, row: rows[0], work });
  for (let n = 0; n < 40; n++) await vi.advanceTimersByTimeAsync(200);
  const scroll = document.querySelector('#rdScroll');
  const segment = scroll.firstElementChild;
  scroll.scrollTop = 4000;
  failNow(); // the page fails while the reader is mid-chapter
  for (let n = 0; n < 40; n++) await vi.advanceTimersByTimeAsync(200);
  // Same reading surface and position: the chapter was not reopened.
  expect(scroll.firstElementChild).toBe(segment);
  expect(scroll.scrollTop).toBe(4000);
  // The failed page came from source B, in its own slot.
  const page = [...document.querySelectorAll('.rd-page')].find((f) => f.querySelector('img')?.src === 'img:B/B/1/3');
  expect(page?.dataset.index).toBe('3');
  expect(asked).toContain('B/B/1/3');
  reader.destroy();
});
