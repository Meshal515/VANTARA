import { parseHTML } from 'linkedom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const engine = vi.hoisted(() => ({ prepare: vi.fn(), routes: vi.fn(), open: vi.fn(), close: vi.fn(), pick: vi.fn(), best: vi.fn(), addons: vi.fn(), search: vi.fn(), listeners: new Map() }));
const title = { id: 'tt0137523', type: 'movie', title: 'Fight Club', _sourceCopy: { sourceId: 'aniasia2tv', url: '/fight-club', title: 'Fight Club' } };
vi.mock('./motion.js', () => ({ pop() {}, progressFill() {}, reduced: () => true, revealIn() {}, stripIn() {} }));
vi.mock('../lib/cinema-meta.js', async original => ({ ...await original(), detail: async (_type, id) => ({ id, type: 'movie', title: 'Fight Club' }), search: async () => [], castPhotos: async () => new Map() }));
vi.mock('../lib/anime-engine.js', async original => ({
  ...await original(), available: () => true, sources: async () => [], onNeedsHuman() {},
  on: (event, callback) => { const listeners = engine.listeners.get(event) ?? new Set(); listeners.add(callback); engine.listeners.set(event, listeners); return () => listeners.delete(callback); },
  prepare: engine.prepare, routes: engine.routes, open: engine.open, closeSession: engine.close,
  pick: engine.pick, best: engine.best, withAddonCopies: engine.addons, searchStream: engine.search,
}));
const { createCinema } = await import('./cinema.js');
const emit = (event, payload) => { for (const callback of engine.listeners.get(event) ?? []) callback(payload); };
const ready = id => ({ id, sourceId: 'aniasia2tv', server: 'OK', code: 'OK', state: 'READY', probed: true, quality: 1080, candidates: ['video'] });
let cleanups;
beforeEach(() => {
  vi.useFakeTimers(); cleanups = []; engine.listeners.clear();
  for (const value of Object.values(engine)) if (vi.isMockFunction(value)) value.mockReset();
  engine.prepare.mockImplementation(async options => ({ session: options.session, routes: [], done: false }));
  engine.routes.mockResolvedValue({ routes: [], done: false }); engine.addons.mockResolvedValue([]);
  engine.pick.mockResolvedValue('video'); engine.close.mockResolvedValue({}); engine.open.mockResolvedValue({});
  engine.search.mockImplementation(() => ({ done: new Promise(() => {}), cancel() {} }));
  const { window, document } = parseHTML('<html><body><main id="cinema"></main><div id="sheet"></div></body></html>');
  vi.stubGlobal('window', window); vi.stubGlobal('document', document);
  vi.stubGlobal('requestAnimationFrame', callback => setTimeout(callback, 0)); vi.stubGlobal('cancelAnimationFrame', clearTimeout);
  vi.stubGlobal('Image', function () { return document.createElement('img'); });
  vi.stubGlobal('localStorage', { getItem: () => null, setItem() {} });
});
afterEach(() => { for (const close of cleanups) close?.(); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });
function screen() {
  let close; const body = document.getElementById('sheet');
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const deps = { q: id => document.getElementById(id), el, toast: vi.fn(), showPage() {}, currentPage: () => 'cinema',
    openSheet: fn => { body.replaceChildren(); close = fn(body); cleanups.push(close); }, closeSheet: () => close?.() };
  return { body, cinema: createCinema(deps), close: () => close?.(), deps };
}
const expectRetry = body => {
  expect(body.querySelector('.ss-skel-list')).toBeNull(); expect(body.querySelector('.ss-spin')).toBeNull();
  expect(body.querySelector('.an-pick-best').textContent).toContain('أعد المحاولة'); expect(body.querySelector('.an-pick-best').disabled).toBe(false);
};

it('settles a rejected prepare with retry and retries a fresh attempt', async () => {
  engine.prepare.mockRejectedValueOnce(new Error('bridge offline'));
  const { body, cinema } = screen(); await cinema.openWork(title, { autoplay: true }); await vi.advanceTimersByTimeAsync(1);
  expectRetry(body);
  engine.routes.mockResolvedValueOnce({ routes: [ready('recovered')], done: true });
  body.querySelector('.an-pick-best').click(); await vi.advanceTimersByTimeAsync(1);
  expect(body.querySelectorAll('.an-srv')).toHaveLength(1); expect(engine.prepare).toHaveBeenCalledTimes(2);
});

it('preserves early routes and prepared events against a stale recovery snapshot', async () => {
  engine.prepare.mockImplementation(async options => {
    emit('route', { session: options.session, route: ready('early') }); emit('prepared', { session: options.session });
    return { session: options.session, routes: [], done: false };
  });
  engine.routes.mockImplementation(async session => { emit('route', { session, route: ready('during-recovery') }); return { routes: [], done: false }; });
  const { body, cinema } = screen(); await cinema.openWork(title, { autoplay: true }); await vi.advanceTimersByTimeAsync(1);
  expect(body.querySelectorAll('.an-srv')).toHaveLength(2); expect(body.querySelector('.ss-spin')).toBeNull();
});

it('keeps returned READY routes playable after snapshot recovery fails', async () => {
  engine.prepare.mockImplementation(async options => ({ session: options.session, routes: [ready('usable')], done: false }));
  engine.routes.mockRejectedValue(new Error('snapshot unavailable'));
  const { body, cinema } = screen(); await cinema.openWork(title, { autoplay: true }); await vi.advanceTimersByTimeAsync(1);
  expect(body.querySelector('.ss-spin')).toBeNull(); await body.querySelector('.an-srv').onclick();
  expect(engine.open).toHaveBeenCalledWith(expect.objectContaining({ candidate: 'video', section: 'cinema' }));
});

it('bounds hung discovery and retries independently after its streams are cancelled', async () => {
  let cancelled = 0;
  engine.search.mockImplementation(() => ({ done: new Promise(() => {}), cancel() { cancelled++; } }));
  engine.addons.mockImplementation(() => new Promise(() => {}));
  const { body, cinema } = screen(); await cinema.openWork({ ...title, _sourceCopy: undefined }, { autoplay: true });
  await vi.advanceTimersByTimeAsync(45001); expectRetry(body); expect(cancelled).toBeGreaterThan(0);
});

it('bounds hung preparation, aborts on close and closes a late abandoned native session', async () => {
  let finish, signal, session;
  engine.prepare.mockImplementationOnce(options => { signal = options.signal; session = options.session; return new Promise(resolve => { finish = resolve; }); });
  const { body, cinema, close } = screen(); await cinema.openWork(title, { autoplay: true }); await vi.advanceTimersByTimeAsync(45001);
  expectRetry(body); expect(signal?.aborted).toBe(true); close();
  const text = body.textContent; finish({ session, routes: [ready('late')], done: true }); await vi.advanceTimersByTimeAsync(1);
  expect(engine.close).toHaveBeenCalledWith(session); expect(body.textContent).toBe(text);
});

it('preserves partial READY success when pending sources reach the deadline', async () => {
  engine.prepare.mockImplementation(async options => ({ session: options.session, routes: [ready('usable'), { id: 'slow', sourceId: 'other', state: 'RESOLVING' }], done: false }));
  const { body, cinema } = screen(); await cinema.openWork(title, { autoplay: true }); await vi.advanceTimersByTimeAsync(45001);
  expect(body.querySelector('.ss-spin')).toBeNull(); await body.querySelector('.ss-row--top').onclick();
  expect(engine.open).toHaveBeenCalledWith(expect.objectContaining({ candidate: 'video' }));
});

it('ignores late picks after close and destroys selector events and timers', async () => {
  let finish;
  engine.prepare.mockImplementation(async options => ({ session: options.session, routes: [ready('usable')], done: true }));
  engine.pick.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const { body, cinema, close } = screen(); await cinema.openWork(title, { autoplay: true }); await vi.advanceTimersByTimeAsync(3000);
  const choosing = body.querySelector('.an-srv').onclick(); close(); finish('late'); await choosing; await vi.advanceTimersByTimeAsync(1);
  expect(engine.open).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  expect(engine.listeners.get('route')?.size ?? 0).toBe(0); expect(engine.listeners.get('prepared')?.size ?? 0).toBe(0);
});

it('settles a hung pick so another attempt remains possible', async () => {
  engine.prepare.mockImplementation(async options => ({ session: options.session, routes: [ready('usable')], done: true }));
  engine.pick.mockImplementationOnce(() => new Promise(() => {}));
  const { body, cinema } = screen(); await cinema.openWork(title, { autoplay: true }); await vi.advanceTimersByTimeAsync(1);
  const choosing = body.querySelector('.an-srv').onclick(); await vi.advanceTimersByTimeAsync(15001);
  await choosing; expect(body.querySelector('.an-pick-best').disabled).toBe(false);
});

it('cancels a hung recovery wait when a READY route is handed to the player', async () => {
  let snapshotSignal;
  engine.prepare.mockImplementation(async options => ({ session: options.session, routes: [ready('usable')], done: false }));
  engine.routes.mockImplementation((_session, { signal }) => { snapshotSignal = signal; return new Promise(() => {}); });
  const { body, cinema } = screen(); await cinema.openWork(title, { autoplay: true }); await vi.advanceTimersByTimeAsync(1);
  await body.querySelector('.an-srv').onclick();
  expect(snapshotSignal.aborted).toBe(true);
  expect(engine.open).toHaveBeenCalledWith(expect.objectContaining({ candidate: 'video' }));
});

it('aborts a pending warm request on close and reopens independently of its late reply', async () => {
  let finish, signal, abandoned;
  engine.prepare.mockImplementationOnce(options => { signal = options.signal; abandoned = options.session; return new Promise(resolve => { finish = resolve; }); });
  const { body, cinema, close } = screen(); await cinema.openWork(title, { autoplay: true }); await vi.advanceTimersByTimeAsync(1);
  close(); expect(signal?.aborted).toBe(true);
  engine.prepare.mockImplementationOnce(async options => ({ session: options.session, routes: [ready('new')], done: true }));
  await cinema.openWork(title, { autoplay: true }); await vi.advanceTimersByTimeAsync(1);
  finish({ session: abandoned, routes: [ready('old')], done: true });
  emit('route', { session: abandoned, route: ready('old-event') }); await vi.advanceTimersByTimeAsync(1);
  expect(body.querySelectorAll('.an-srv')).toHaveLength(1); expect(engine.close).toHaveBeenCalledWith(abandoned);
});


it('opens a fully loaded provider-local cinema work while another source read is offline', async () => {
  const { sourceWorkModel } = await import('../addons/work-view.js');
  const work = sourceWorkModel({ url: 'https://provider.example/drama/local', type: 'series', title: 'Native drama' }, {
    addon: { key: 'core|user-native-drama', sourceId: 'user-native-drama', contentTypes: ['series'] },
    episodes: [{ number: 1, season: 1 }, { number: 2, season: 1 }],
  });
  const { cinema, deps } = screen();
  deps.restoreSourceWork = async () => { throw new Error('Source is offline after catalogue navigation'); };
  await cinema.openWork(work);
  const play = document.querySelector('.cn-btn--play.cn-btn--block');
  expect(play).not.toBeNull();
  expect(play.textContent).toContain('الحلقة 1');
});

it('rehydrates a saved provider-local cinema reference that has no source copy', async () => {
  const work = { id: 'addon-saved-drama', type: 'series', title: 'Saved drama', seasons: [{ n: 1, episodes: [{ n: 1 }] }], _sourceCopy: { sourceId: 'user-native-drama', url: '/drama/saved' } };
  const { cinema, deps } = screen();
  deps.restoreSourceWork = async ref => { expect(ref).toBe('cinema:addon-saved-drama'); return work; };
  await cinema.openWork({ id: work.id, type: work.type, title: work.title });
  expect(document.querySelector('.cn-btn--play.cn-btn--block')).not.toBeNull();
});


it('restores a native READY route missed by early events and initial server-sheet snapshot', async () => {
  const start = Date.now();
  engine.routes.mockImplementation(async () => Date.now() - start < 1000
    ? { done: false, routes: [] }
    : { done: true, routes: [ready('late-cinema-native')] });
  const { body, cinema, close } = screen();
  await cinema.openWork(title, { autoplay: true });
  await vi.advanceTimersByTimeAsync(1);
  expect(body.querySelectorAll('.an-srv--ready')).toHaveLength(0);
  await vi.advanceTimersByTimeAsync(1300);
  expect(body.querySelectorAll('.an-srv--ready')).toHaveLength(1);
  close();
  expect(vi.getTimerCount()).toBe(0);
});
