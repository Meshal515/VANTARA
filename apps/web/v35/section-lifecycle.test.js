import { parseHTML } from 'linkedom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * #311 D-011/D-012/D-014/D-015: دورة حياة السينما — مستمع التمرير، كاش صور الممثلين، مؤقت البحث،
 * ومراقب «المزيد» في شبكة اكتشف.
 */
const searches = [];
vi.mock('./motion.js', () => ({ pop() {}, progressFill() {}, reduced: () => true, revealIn() {}, stripIn() {} }));
vi.mock('../lib/cinema-meta.js', async (original) => ({
  ...await original(),
  search: async (q) => { searches.push(q); return []; },
  catalog: () => new Promise(() => {}), // الصفحة لا ترد: الشبكة تبقى بانتظار «المزيد»
  castPhotos: async () => new Map(),
}));
vi.mock('../lib/anime-engine.js', async (original) => ({ ...await original(), available: () => false, sources: async () => [], onNeedsHuman() {}, on: () => () => {} }));
const { createCinema } = await import('./cinema.js');

let listeners, observers;
beforeEach(() => {
  vi.useFakeTimers();
  searches.length = 0;
  const { window, document } = parseHTML('<html><body><main><section id="cinemaDiscover"></section></main><div id="sheet"></div></body></html>');
  vi.stubGlobal('window', window); vi.stubGlobal('document', document);
  vi.stubGlobal('requestAnimationFrame', (f) => setTimeout(f, 0)); vi.stubGlobal('cancelAnimationFrame', clearTimeout);
  vi.stubGlobal('Image', function () { return document.createElement('img'); });
  vi.stubGlobal('localStorage', { getItem: () => null, setItem() {}, removeItem() {} });
  vi.stubGlobal('innerHeight', 800);
  listeners = new Set();
  vi.stubGlobal('addEventListener', (type, fn) => { if (type === 'scroll') listeners.add(fn); });
  vi.stubGlobal('removeEventListener', (type, fn) => { if (type === 'scroll') listeners.delete(fn); });
  observers = { live: 0 };
  vi.stubGlobal('IntersectionObserver', class { constructor() { observers.live++; this.on = true; } observe() {} unobserve() {} disconnect() { if (this.on) { this.on = false; observers.live--; } } });
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

const make = () => {
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const root = document.querySelector('main');
  return createCinema({ q: (id) => document.getElementById(id), el, toast: vi.fn(), showPage() {}, currentPage: () => 'discover', openSheet() {}, closeSheet() {}, root });
};

describe('#311 cinema lifecycle', () => {
  it('D-011: destroy removes the header scroll listener; a remount keeps exactly one', () => {
    const first = make();
    expect(listeners.size).toBe(1);
    first.destroy();
    expect(listeners.size).toBe(0);
    make();
    expect(listeners.size).toBe(1);
  });

  it('D-014: a pending search timer from a replaced discover page changes nothing', async () => {
    const cinema = make();
    cinema.showDiscover();
    const input = document.querySelector('#cinemaDiscover input');
    input.value = 'Avatar';
    input.oninput();
    // قبل 380ms: «مسلسلات» يعيد بناء الصفحة
    [...document.querySelectorAll('#cinemaDiscover .cn-kind')].find((b) => b.textContent === 'مسلسلات').onclick();
    await vi.advanceTimersByTimeAsync(500);
    expect(searches).toEqual([]);
    expect(document.querySelector('#cinemaDiscover input').value).toBe('');
  });

  it('D-015: switching genres before the grid runs out leaves one live «more» observer', async () => {
    const cinema = make();
    cinema.showDiscover();
    for (let i = 0; i < 12; i++) {
      [...document.querySelectorAll('#cinemaDiscover .cn-chip')][1 + (i % 5)].onclick();
      await vi.advanceTimersByTimeAsync(0);
    }
    expect(observers.live).toBeLessThanOrEqual(1);
  });
});

describe('#311 D-013 anime listeners', () => {
  it('destroy removes the visibilitychange listener; remounting keeps one', async () => {
    const { createAnime } = await import('./anime.js');
    const live = new Set();
    const add = document.addEventListener.bind(document), remove = document.removeEventListener.bind(document);
    document.addEventListener = (t, fn, o) => { if (t === 'visibilitychange') live.add(fn); return add(t, fn, o); };
    document.removeEventListener = (t, fn, o) => { if (t === 'visibilitychange') live.delete(fn); return remove(t, fn, o); };
    const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
    const root = document.querySelector('main');
    const deps = () => ({ root, q: (id) => root.querySelector(`#${id}`), el, toast: vi.fn(), genreAr: (s) => s, openSheet: vi.fn(), closeSheet: vi.fn(), showPage() {}, currentPage: () => 'anime', sync: { user: null, rows: () => [], enqueue: vi.fn() } });
    const first = createAnime(deps());
    expect(live.size).toBe(1);
    first.destroy();
    expect(live.size).toBe(0);
    createAnime(deps());
    expect(live.size).toBe(1);
  });
});

describe('#311 D-012 cast photos', () => {
  it('a 503 is not cached as «no photos»: the next ask fetches again', async () => {
    const { castPhotos } = await vi.importActual('../lib/cinema-meta.js');
    let n = 0;
    const fetchImpl = async () => {
      n++;
      if (n === 1) return { ok: false, status: 503, json: async () => null };
      return { ok: true, json: async () => ({ results: { bindings: [{ name: { value: 'Actor One' }, img: { value: 'http://img/a.jpg' } }] } }) };
    };
    expect((await castPhotos('tt7654321', { fetchImpl })).size).toBe(0);
    const second = await castPhotos('tt7654321', { fetchImpl });
    expect(n).toBe(2);
    expect(second.size).toBe(1);
  });
});
