import { parseHTML } from 'linkedom';
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('./motion.js', () => ({ stripIn() {}, pop() {}, revealIn() {} }));
const { createAnimeDiscover } = await import('./anime-discover.js');

/**
 * #311 D-001/D-003/D-007 و D-002/D-017: صفحة تصنيف أنمي (أكشن ← رومانسي ← أكشن)، ومراقب «المزيد»،
 * ورد قديم بعد الانتقال، وبطاقات الأنواع ووجوهها.
 */
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

function setup({ fetchImpl } = {}) {
  const { window, document } = parseHTML('<html><body><main><section id="animeCollection"></section><div id="animeDiscover"></div></main></body></html>');
  vi.stubGlobal('window', Object.assign(window, { scrollTo() {} }));
  vi.stubGlobal('document', document);
  vi.stubGlobal('Image', function () { return document.createElement('img'); });
  vi.stubGlobal('localStorage', { getItem: () => null, setItem() {}, removeItem() {} });
  const observers = { live: 0, made: 0 };
  vi.stubGlobal('IntersectionObserver', class { constructor() { observers.made++; observers.live++; this.on = true; } observe() {} unobserve() {} disconnect() { if (this.on) { this.on = false; observers.live--; } } });
  const calls = [];
  vi.stubGlobal('fetch', fetchImpl ?? (async (_url, init) => {
    const vars = JSON.parse(init.body).variables ?? {};
    calls.push(vars);
    const genre = vars.genreIn?.[0] ?? 'all';
    return { ok: true, json: async () => ({ data: { Page: { pageInfo: { hasNextPage: false }, media: [{ id: genre.length, title: { english: `${genre} 1` }, coverImage: { large: 'x' } }] } } }) };
  }));
  const root = document.querySelector('main');
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const button = (cls, html, fn, label) => { const b = el('button', cls); b.innerHTML = html; b.onclick = fn; if (label) b.setAttribute('aria-label', label); return b; };
  const made = [];
  const deps = { q: (id) => root.querySelector(`#${id}`), el, button, genreAr: (g) => g, genres: [['Action', 0], ['Romance', 330]], image: () => el('img'),
    posterCard: (m) => { const c = el('button', 'poster', m.title); made.push(m.title); return c; }, openSheet() {}, closeSheet() {}, showPage() {}, toast() {}, trending: () => [] };
  return { discover: createAnimeDiscover(deps), root, calls, made, observers, document };
}
const settle = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)); };

describe('#311 anime genre collections', () => {
  it('D-007: a late Action response after opening Romance builds no Action cards', async () => {
    const pending = [];
    const { discover, made } = setup({ fetchImpl: (_u, init) => new Promise((resolve) => pending.push({ resolve, genre: JSON.parse(init.body).variables.genreIn?.[0] })) });
    discover.openCollection({ kind: 'genre', genre: 'Action' });
    await settle();
    discover.openCollection({ kind: 'genre', genre: 'Romance' });
    await settle();
    const action = pending.find((p) => p.genre === 'Action');
    action.resolve({ ok: true, json: async () => ({ data: { Page: { pageInfo: { hasNextPage: false }, media: [{ id: 1, title: { english: 'Action 1' }, coverImage: { large: 'x' } }] } } }) });
    await settle();
    expect(made).not.toContain('Action 1');
  });

  it('D-001: returning to Action within the TTL shows its cards at once: no skeleton, no new request, same nodes', async () => {
    const { discover, root, calls } = setup();
    discover.openCollection({ kind: 'genre', genre: 'Action' });
    await settle();
    const card = root.querySelector('#animeCollection .poster');
    discover.openCollection({ kind: 'genre', genre: 'Romance' });
    await settle();
    discover.openCollection({ kind: 'genre', genre: 'Action' });
    expect(root.querySelector('#animeCollection .an-skel')).toBeNull();
    expect(root.querySelector('#animeCollection .poster')).toBe(card);
    await settle();
    expect(calls.filter((v) => v.genreIn?.[0] === 'Action')).toHaveLength(1);
  });

  it('D-003: repainting collections keeps one live «more» observer, not one per repaint', async () => {
    const { discover, observers } = setup();
    for (let i = 0; i < 30; i++) discover.openCollection({ kind: 'genre', genre: i % 2 ? 'Action' : 'Romance' });
    await settle();
    expect(observers.live).toBeLessThanOrEqual(1);
  });
});

describe('#311 anime genre faces', () => {
  it('D-017: a failed first load is retried later instead of never again', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    let asks = 0;
    const { discover } = setup({ fetchImpl: async () => { asks++; throw new Error('offline'); } });
    discover.genreStrip();
    await settle();
    discover.genreStrip();
    await settle();
    expect(asks).toBe(1); // لا عاصفة طلبات
    vi.setSystemTime(Date.now() + 61_000);
    discover.genreStrip();
    await settle();
    expect(asks).toBe(2);
  });

  it('D-002: cards of rebuilt strips are not retained once the faces are known', async () => {
    const { discover } = setup({ fetchImpl: async () => ({ ok: true, json: async () => ({ data: {} }) }) });
    discover.genreStrip();
    await settle();
    for (let i = 0; i < 50; i++) discover.genreStrip();
    expect(discover.retainedGenreCards()).toBe(0);
  });
});
