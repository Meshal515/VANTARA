import { parseHTML } from 'linkedom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const engine = vi.hoisted(() => ({ listeners: new Map(), prepare: vi.fn(), routes: vi.fn(), close: vi.fn(), pick: vi.fn(), best: vi.fn(), open: vi.fn(), extend: vi.fn(), find: vi.fn(), addons: vi.fn(), detail: vi.fn() }));
vi.mock('../lib/anime-meta.js', async original => ({ ...await original(), fetchAnimeDetail: engine.detail }));
vi.mock('./motion.js', () => ({ pop() {}, pageIn() {}, revealIn() {}, stripIn() {} }));
vi.mock('../lib/anime-engine.js', async original => ({
  ...await original(), available: () => true, sources: async () => [], onNeedsHuman() {},
  on: (event, callback) => {
    const listeners = engine.listeners.get(event) ?? new Set(); listeners.add(callback); engine.listeners.set(event, listeners);
    return () => listeners.delete(callback);
  },
  prepare: engine.prepare, routes: engine.routes, closeSession: engine.close,
  pick: engine.pick, best: engine.best, open: engine.open, extend: engine.extend,
  findWorkStream: engine.find, withAddonCopies: engine.addons,
}));
const { createAnime } = await import('./anime.js');
const emit = (event, payload) => { for (const callback of engine.listeners.get(event) ?? []) callback(payload); };
const route = (id = 'ready', state = 'READY', sourceId = rift.sourceId) => ({ id, sourceId, server: 'Megamax', code: 'MMX', quality: 1080, state, probed: state === 'READY', candidates: ['video'], variant: 'SUB' });
const rift = { sourceId: 'addon|cs3|cs3_animerift', url: 'https://rift.example/one-piece', title: 'One Piece', type: 'anime' };
const media = { id: 21, title: 'One Piece', episodes: 1200, _sourceCopy: rift, _officialIdentity: true };
let cleanups;
beforeEach(() => {
  vi.useFakeTimers(); cleanups = []; engine.listeners.clear();
  for (const value of Object.values(engine)) if (vi.isMockFunction(value)) value.mockReset();
  engine.prepare.mockResolvedValue({ session: 'test-session', done: false, routes: [] });
  engine.routes.mockResolvedValue({ done: false, routes: [] }); engine.close.mockResolvedValue({});
  engine.find.mockResolvedValue(null); engine.addons.mockResolvedValue([]); engine.extend.mockResolvedValue(1);
  const { window, document } = parseHTML('<html><body><main></main></body></html>');
  vi.stubGlobal('window', window); vi.stubGlobal('document', document);
  vi.stubGlobal('Image', function () { return document.createElement('img'); });
  vi.stubGlobal('requestAnimationFrame', callback => setTimeout(callback, 0));
  vi.stubGlobal('cancelAnimationFrame', clearTimeout);
  vi.stubGlobal('localStorage', { getItem: () => null, setItem() {} });
});
afterEach(() => { for (const close of cleanups) close(); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });
function screen() {
  const body = document.querySelector('main'); let close;
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text) n.textContent = text; return n; };
  const deps = { root: body, q: () => null, el, toast: vi.fn(), genreAr: s => s,
    openSheet: fn => { body.replaceChildren(); close = fn(body); cleanups.push(close); },
    closeSheet: () => close?.(), currentPage: () => 'anime' };
  const anime = createAnime(deps);
  return { body, anime, deps, close: () => close?.() };
}

/**
 * ورقة سيرفرات الأنمي في وضع المصدر المحدد (طلب المالك 14 نوفمبر 2026): الجلسة منه وحده، والسيرفر الجاهز
 * يظهر قابلًا للاختيار دون انتظار البقية، وفشل سيرفر لا يعطل غيره، وتغيير الحلقة يبقي النطاق نفسه.
 */
const lastPrepare = () => engine.prepare.mock.calls.at(-1)[0];

it('entering from a source prepares that source alone, as a pinned session', async () => {
  const { anime } = screen(); anime.play(media, 3); await vi.advanceTimersByTimeAsync(1);
  expect(lastPrepare()).toMatchObject({ pinned: true, episode: 3 });
  expect(lastPrepare().copies.map(c => c.sourceId)).toEqual([rift.sourceId]);
  // لا بحث عام ولا اكتشاف إضافات من صفحة مصدر محدد
  expect(engine.find).not.toHaveBeenCalled();
  expect(engine.addons).not.toHaveBeenCalled();
});

it('the general card (no source copy) keeps the all-sources sheet', async () => {
  const general = { id: 21, title: 'One Piece', episodes: 1200 };
  engine.detail.mockResolvedValue(general);
  engine.find.mockImplementation(async (_titles, onWork) => {
    const work = { title: 'One Piece', copies: [{ sourceId: 'anime4up', url: '/a' }, { sourceId: 'witanime', url: '/w' }] };
    onWork?.(work); return work;
  });
  engine.addons.mockResolvedValue([{ sourceId: 'addon|torrentio', url: 'kitsu:12', id: 'kitsu:12' }]);
  const { anime } = screen(); anime.play(general, 3); await vi.advanceTimersByTimeAsync(6000);
  expect(engine.prepare).toHaveBeenCalled();
  expect(lastPrepare().pinned).toBe(false);
  expect(lastPrepare().copies.map(c => c.sourceId)).toEqual(expect.arrayContaining(['anime4up', 'witanime']));
});

it('a ready server is selectable at once while others are still resolving, and a failed one blocks nothing', async () => {
  engine.prepare.mockImplementation(async () => {
    emit('route', { session: 'test-session', route: route('slow', 'RESOLVING') });
    return { session: 'test-session', done: false, routes: [] };
  });
  const { body, anime } = screen(); anime.play(media, 3); await vi.advanceTimersByTimeAsync(1);
  emit('route', { session: 'test-session', route: route('broken', 'FAILED') });
  emit('route', { session: 'test-session', route: route('fast', 'READY') });
  await vi.advanceTimersByTimeAsync(1);
  const fast = [...body.querySelectorAll('.an-srv')].find(b => !b.disabled && !b.classList.contains('is-checking'));
  expect(fast).toBeTruthy();
  expect(body.querySelector('.an-pick-best').disabled).toBe(false);
  // بقية السيرفرات لم تنتهِ بعد: الحالة تقول ذلك، ولا يُنتظر تورنت أو مصدر آخر
  expect(body.textContent).not.toMatch(/Torrentio/);
});

it('late duplicate route events update in place instead of duplicating servers', async () => {
  engine.prepare.mockResolvedValue({ session: 'test-session', done: false, routes: [route('a', 'RESOLVING')] });
  const { body, anime } = screen(); anime.play(media, 3); await vi.advanceTimersByTimeAsync(1);
  emit('route', { session: 'test-session', route: route('a', 'READY') });
  emit('route', { session: 'test-session', route: route('a', 'READY') });
  emit('prepared', { session: 'test-session' });
  await vi.advanceTimersByTimeAsync(1);
  expect(body.querySelectorAll('.an-srv')).toHaveLength(1);
});

it('changing the episode keeps the pinned source scope', async () => {
  const { anime, close } = screen();
  anime.play(media, 3); await vi.advanceTimersByTimeAsync(1); close();
  anime.play(media, 4); await vi.advanceTimersByTimeAsync(1);
  expect(engine.prepare).toHaveBeenCalledTimes(2);
  for (const [args] of engine.prepare.mock.calls) {
    expect(args.pinned).toBe(true);
    expect(args.copies.map(c => c.sourceId)).toEqual([rift.sourceId]);
  }
  expect(engine.prepare.mock.calls.map(([a]) => a.episode)).toEqual([3, 4]);
});
