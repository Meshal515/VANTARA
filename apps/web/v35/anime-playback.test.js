import { parseHTML } from 'linkedom';
import { afterEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ find: vi.fn(async () => ({ copies: [{ sourceId: 'shahiid', url: '/rezero', title: 'Re:Zero 4th Season' }] })), listeners: new Map(), open: vi.fn(), best: vi.fn(async () => ({ candidate: 'stream-480', code: 'MMX' })) }));
vi.mock('./motion.js', () => ({ pop() {}, pageIn() {}, revealIn() {}, stripIn() {} }));
vi.mock('../lib/anime-engine.js', async (original) => ({
  ...await original(), available: () => true, sources: async () => [], onNeedsHuman() {},
  on: (event, fn) => { state.listeners.set(event, fn); return () => state.listeners.delete(event); },
  findWorkStream: state.find, withAddonCopies: async () => [],
  prepare: async () => ({ session: 'test-session', routes: [], done: false }),
  routes: async () => ({ routes: [], done: false }), best: state.best,
  pick: async (_session, route) => route === '480' ? 'stream-480' : 'stream-1080',
  open: state.open, closeSession: async () => {},
}));
const { createAnime } = await import('./anime.js');
afterEach(() => { state.listeners.clear(); state.open.mockClear(); state.best.mockClear(); vi.useRealTimers(); vi.unstubAllGlobals(); });
it('APK server events and completed preparation keep the selector open until the user chooses', async () => {
  vi.useFakeTimers();
  const { window, document } = parseHTML('<html><body><main></main></body></html>');
  vi.stubGlobal('window', window); vi.stubGlobal('document', document);
  vi.stubGlobal('Image', function () { return document.createElement('img'); });
  vi.stubGlobal('requestAnimationFrame', (fn) => setTimeout(fn, 0));
  vi.stubGlobal('localStorage', { getItem: () => null, setItem() {} });
  let cleanup;
  const body = document.querySelector('main');
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text) n.textContent = text; return n; };
  const deps = { root: body, q: () => null, el, toast() {}, genreAr: (s) => s, openSheet: (fn) => { cleanup = fn(body); }, closeSheet: vi.fn(() => cleanup?.()), currentPage: () => 'anime' };
  const anime = createAnime(deps);
  anime.play({ id: 1, title: 'Re:ZERO Season 4', episodes: 19, poster: 'https://image.test/x.jpg' }, 3);
  await vi.advanceTimersByTimeAsync(0);
  for (const quality of [1080, 480]) state.listeners.get('route')({ session: 'test-session', route: { id: String(quality), sourceId: 'shahiid', server: 'Megamax', code: 'MMX', quality, state: 'READY', candidates: [`stream-${quality}`], variant: 'SUB' } });
  state.listeners.get('prepared')({ session: 'test-session' });
  await vi.advanceTimersByTimeAsync(1);
  expect(state.open).not.toHaveBeenCalled();
  expect(deps.closeSheet).not.toHaveBeenCalled();
  expect(body.querySelectorAll('.an-srv')).toHaveLength(2);
  await body.querySelectorAll('.an-srv')[1].onclick();
  await vi.advanceTimersByTimeAsync(0);
  expect(state.open).toHaveBeenCalledWith(expect.objectContaining({ candidate: 'stream-480', episode: 3 }));
  cleanup?.();
});

it('keeps uncertain source search distinct from unavailable in the playback sheet', async () => {
  vi.useFakeTimers(); state.listeners.clear(); state.open.mockClear();
  state.find.mockRejectedValueOnce(new Error('sources still cooling'));
  const { window, document } = parseHTML('<html><body><main></main></body></html>');
  vi.stubGlobal('window', window); vi.stubGlobal('document', document);
  vi.stubGlobal('Image', function () { return document.createElement('img'); });
  vi.stubGlobal('requestAnimationFrame', (fn) => setTimeout(fn, 0));
  vi.stubGlobal('localStorage', { getItem: () => null, setItem() {} });
  let cleanup; const body = document.querySelector('main');
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text) n.textContent = text; return n; };
  const anime = createAnime({ root: body, q: () => null, el, toast() {}, genreAr: (s) => s, openSheet: (fn) => { cleanup = fn(body); }, closeSheet() {}, currentPage: () => 'anime' });
  anime.play({ id: 2, title: 'Re:ZERO Season 4', episodes: 19 }, 3);
  await vi.advanceTimersByTimeAsync(0);
  expect(body.textContent).not.toContain('غير متوفر في المصادر العربية');
  expect(body.textContent).toContain('تعذّر البحث');
  expect(body.querySelector('.an-pick-best').disabled).toBe(false);
  expect(state.open).not.toHaveBeenCalled(); cleanup?.();
});
