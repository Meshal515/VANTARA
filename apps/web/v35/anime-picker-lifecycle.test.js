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
const route = (id = 'ready') => ({ id, sourceId: 'wit', server: 'Megamax', code: 'MMX', quality: 1080, state: 'READY', probed: true, candidates: ['video'], variant: 'SUB' });
const media = { id: 188, title: 'One Piece', episodes: 1200, _sourceCopy: { sourceId: 'wit', url: '/one-piece' } };
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
const expectRetry = body => {
  expect(body.querySelector('.ss-skel-list')).toBeNull();
  expect(body.querySelector('.ss-spin')).toBeNull();
  expect(body.querySelector('.an-pick-best').textContent).toContain('أعد المحاولة');
  expect(body.querySelector('.an-pick-best').disabled).toBe(false);
};

it('settles a prepare error with retry, and retry starts a fresh successful attempt', async () => {
  engine.prepare.mockRejectedValueOnce(new Error('bridge unavailable'));
  const { body, anime } = screen(); anime.play(media, 1);
  await vi.advanceTimersByTimeAsync(1); expectRetry(body);
  engine.routes.mockResolvedValueOnce({ done: true, routes: [route()] });
  body.querySelector('.an-pick-best').click(); await vi.advanceTimersByTimeAsync(1);
  expect(body.querySelectorAll('.an-srv')).toHaveLength(1);
  expect(engine.prepare).toHaveBeenCalledTimes(2);
});

it('keeps a usable prepare result when route recovery fails', async () => {
  engine.prepare.mockResolvedValue({ session: 'test-session', done: false, routes: [route()] });
  engine.routes.mockRejectedValue(new Error('recovery failed'));
  const { body, anime } = screen(); anime.play(media, 1); await vi.advanceTimersByTimeAsync(1);
  expect(body.querySelectorAll('.an-srv')).toHaveLength(1);
  expect(body.querySelector('.ss-spin')).toBeNull();
  expect(body.querySelector('.an-pick-best').disabled).toBe(false);
});

it('retains early routes and prepared events against an older recovery snapshot', async () => {
  engine.prepare.mockImplementation(async () => {
    emit('route', { session: 'test-session', route: route('early') });
    emit('prepared', { session: 'test-session' });
    return { session: 'test-session', done: false, routes: [] };
  });
  engine.routes.mockImplementation(async () => {
    emit('route', { session: 'test-session', route: route('during-snapshot') });
    return { done: false, routes: [] };
  });
  const { body, anime } = screen(); anime.play(media, 1); await vi.advanceTimersByTimeAsync(1);
  expect(body.querySelectorAll('.an-srv')).toHaveLength(2);
  expect(body.querySelector('.ss-spin')).toBeNull();
});

it('ends a hung prepare by deadline, aborts it and ignores late completion after retry', async () => {
  let finish, signal;
  engine.prepare.mockImplementationOnce(options => { signal = options.signal; return new Promise(resolve => { finish = resolve; }); });
  const { body, anime } = screen(); anime.play(media, 1); await vi.advanceTimersByTimeAsync(45001);
  expectRetry(body); expect(signal?.aborted).toBe(true);
  body.querySelector('.an-pick-best').click(); await vi.advanceTimersByTimeAsync(1);
  const text = body.textContent; finish({ session: 'abandoned', routes: [route('late')], done: true });
  await vi.advanceTimersByTimeAsync(1);
  expect(body.textContent).toBe(text); expect(engine.close).toHaveBeenCalledWith('abandoned');
});

it('closes pending preparation, removes subscriptions and allows an independent reopen', async () => {
  let finish, signal;
  engine.prepare.mockImplementationOnce(options => { signal = options.signal; return new Promise(resolve => { finish = resolve; }); });
  const { body, anime, close } = screen(); anime.play(media, 1); await vi.advanceTimersByTimeAsync(0);
  close(); expect(signal?.aborted).toBe(true);
  expect(engine.listeners.get('route')?.size ?? 0).toBe(0);
  expect(engine.listeners.get('prepared')?.size ?? 0).toBe(0);
  engine.routes.mockResolvedValueOnce({ done: true, routes: [route('reopened')] });
  anime.play(media, 2); await vi.advanceTimersByTimeAsync(1);
  finish({ session: 'old', done: true, routes: [route('old')] });
  emit('route', { session: 'old', route: route('old-event') });
  await vi.advanceTimersByTimeAsync(1);
  expect(body.querySelectorAll('.an-srv')).toHaveLength(1);
  expect(engine.close).toHaveBeenCalledWith('old');
});

it('ends hung search and hung snapshot recovery with retry instead of indefinite loading', async () => {
  engine.find.mockImplementation(() => new Promise(() => {}));
  engine.addons.mockImplementation(() => new Promise(() => {}));
  const { body, anime, close } = screen(); anime.play({ ...media, id: 190, _sourceCopy: undefined }, 1);
  await vi.advanceTimersByTimeAsync(45001); expectRetry(body); close();
  engine.routes.mockImplementation(() => new Promise(() => {}));
  // جلسة بدأت: لا تُقتل عند 45 ث (المحرك ما زال يجهّز)، والسقف الأخير يُنهيها بعدها
  anime.play(media, 1); await vi.advanceTimersByTimeAsync(45001);
  expect(body.querySelector('.an-pick-best').textContent).not.toContain('أعد المحاولة');
  await vi.advanceTimersByTimeAsync(50001); expectRetry(body);
});

it('keeps established READY routes playable when other routes reach the deadline', async () => {
  engine.routes.mockResolvedValue({ done: false, routes: [route(), { id: 'pending', state: 'RESOLVING', sourceId: 'shahiid', server: 'slow' }] });
  engine.pick.mockResolvedValue('chosen'); engine.open.mockResolvedValue({});
  const { body, anime } = screen(); anime.play(media, 1);
  // عند 45 ث السيرفر الذي ما زال يُجهَّز يبقى «قيد الفحص» (كان يُعلَّم «تعذّر» والمحرك يعمل)
  await vi.advanceTimersByTimeAsync(45001);
  expect([...body.querySelectorAll('.an-srv')].some(b => b.textContent.includes('قيد الفحص'))).toBe(true);
  await vi.advanceTimersByTimeAsync(50001);
  expect(body.querySelector('.ss-spin')).toBeNull();
  await body.querySelector('.an-srv').onclick(); await vi.advanceTimersByTimeAsync(1);
  expect(engine.open).toHaveBeenCalledWith(expect.objectContaining({ candidate: 'chosen' }));
});

it('does not launch a late pick after closing the selector', async () => {
  let finish;
  engine.routes.mockResolvedValue({ done: true, routes: [route()] });
  engine.pick.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const { body, anime, close } = screen(); anime.play(media, 1); await vi.advanceTimersByTimeAsync(1);
  const picking = body.querySelector('.an-srv').onclick(); close(); finish('too-late');
  await picking; await vi.advanceTimersByTimeAsync(1);
  expect(engine.open).not.toHaveBeenCalled();
});

it('releases a hung pick so another server remains selectable', async () => {
  engine.routes.mockResolvedValue({ done: true, routes: [route()] });
  engine.pick.mockImplementationOnce(() => new Promise(() => {}));
  const { body, anime } = screen(); anime.play(media, 1); await vi.advanceTimersByTimeAsync(1);
  const choosing = body.querySelector('.an-srv').onclick();
  await vi.advanceTimersByTimeAsync(15001); await choosing;
  expect(body.querySelector('.an-pick-best').textContent).not.toContain('نجهّز التشغيل');
  expect(body.querySelector('.an-pick-best').disabled).toBe(false);
});


it('cancels an active source search on close and a fresh search can retry', async () => {
  let searchSignal;
  engine.find.mockImplementationOnce((_titles, _onHit, criteria) => { searchSignal = criteria.signal; return new Promise(() => {}); });
  const { body, anime, close } = screen();
  const searching = { ...media, id: 220, _sourceCopy: undefined };
  anime.play(searching, 1); await vi.advanceTimersByTimeAsync(0); close();
  expect(searchSignal?.aborted).toBe(true);
  engine.find.mockResolvedValueOnce({ copies: [media._sourceCopy] });
  engine.routes.mockResolvedValueOnce({ done: true, routes: [route()] });
  anime.play(searching, 1); await vi.advanceTimersByTimeAsync(1);
  expect(body.querySelectorAll('.an-srv')).toHaveLength(1);
});

it('clears its deadline and queued paint when closed', async () => {
  const { anime, close } = screen();
  await vi.advanceTimersByTimeAsync(2500); // The app-level outbox timer belongs to createAnime.
  anime.play(media, 1); await vi.advanceTimersByTimeAsync(0);
  emit('route', { session: 'test-session', route: route() });
  close(); await Promise.resolve();
  expect(vi.getTimerCount()).toBe(0);
});

it('offers retry after a successful search returns no matching work', async () => {
  const { body, anime } = screen();
  anime.play({ ...media, id: 221, _sourceCopy: undefined }, 1);
  await vi.advanceTimersByTimeAsync(1);
  expect(body.textContent).toContain('لم نجد هذه الحلقة');
  expectRetry(body);
});

it('reports a player launch failure even though launch closes the selector', async () => {
  engine.routes.mockResolvedValue({ done: true, routes: [route()] });
  engine.pick.mockResolvedValue('chosen'); engine.open.mockRejectedValue(new Error('player rejected launch'));
  const { body, anime, deps } = screen(); anime.play(media, 1); await vi.advanceTimersByTimeAsync(1);
  await body.querySelector('.an-srv').onclick();
  expect(deps.toast).toHaveBeenCalledWith(expect.stringContaining('player rejected launch'));
});


it('recovers a native READY route from the live session after both the initial snapshot and WebView event were missed', async () => {
  const start = Date.now();
  engine.routes.mockImplementation(async () => Date.now() - start < 1000
    ? { done: false, routes: [] }
    : { done: true, routes: [route('late-native-ready')] });
  const { body, anime, close } = screen();
  // createAnime also schedules an unrelated app-wide outbox flush at 2500ms.
  // Drain it before opening the sheet so this regression only measures timers
  // owned by the live server-sheet lifecycle, not the application outbox.
  await vi.advanceTimersByTimeAsync(2500);
  anime.play(media, 1);
  await vi.advanceTimersByTimeAsync(1300);
  expect(body.querySelectorAll('.an-srv--ready')).toHaveLength(1);
  close();
  expect(vi.getTimerCount()).toBe(0);
});

it('renders a probed native READY route when Android pauses WebView animation frames', async () => {
  // Android may have just returned from the native player: CDP and bridge
  // promises resume before requestAnimationFrame is allowed to run.
  vi.stubGlobal('requestAnimationFrame', () => 1);
  engine.prepare.mockResolvedValue({ session: 'test-session', done: true, routes: [route('native-ready-with-paused-raf')] });
  const { body, anime, close } = screen();
  anime.play(media, 1);
  await vi.advanceTimersByTimeAsync(1);
  expect(body.querySelectorAll('.an-srv--ready')).toHaveLength(1);
  close();
});

it('does not expose a previous sheet session while a new native preparation is pending', async () => {
  let resolve;
  engine.prepare.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const { body, anime, close } = screen();
  body.dataset.vantaraPlaybackSession = 'previous-cinema-session';
  anime.play(media, 1);
  await vi.advanceTimersByTimeAsync(1);
  expect(body.dataset.vantaraPlaybackSession).toBeUndefined();
  resolve({ session: 'new-anime-session', done: true, routes: [route()] });
  await vi.advanceTimersByTimeAsync(1);
  expect(body.dataset.vantaraPlaybackSession).toBe('new-anime-session');
  close();
  expect(body.dataset.vantaraPlaybackSession).toBeUndefined();
});

const minimalConan = { id: 235, title: 'Detective Conan' };
const fullConan = { ...minimalConan, romaji: 'Meitantei Conan', synonyms: [], genres: [], episodes: 1200, aired: 1200, relations: [], recommendations: [] };
function pendingMetadataScreen() {
  document.body.innerHTML = '<main><section id="anime"></section></main><div id="playbackSheet"></div>';
  const root = document.querySelector('main'), body = document.getElementById('playbackSheet');
  let resolveDetail, close;
  engine.detail.mockImplementationOnce(() => new Promise(resolve => { resolveDetail = resolve; }));
  const el = (tag, cls, text) => { const node = document.createElement(tag); if (cls) node.className = cls; if (text != null) node.textContent = text; return node; };
  const anime = createAnime({ root, q: id => root.querySelector('#'+id), el, toast() {}, genreAr: value => value,
    showPage() {}, currentPage: () => 'anime', sync: { user: null, rows: () => [], enqueue() {} },
    openSheet: build => { body.replaceChildren(); close = build(body); cleanups.push(close); }, closeSheet: () => close?.() });
  const opening = anime.openAnime(minimalConan);
  return { anime, body, opening, close: () => close?.(), finish: () => resolveDetail(fullConan) };
}

it('uses canonical aliases when play is tapped before AniList details arrive', async () => {
  engine.find.mockImplementation(async titles => titles.includes('Meitantei Conan') ? { copies: [{ sourceId: 'wit', url: '/conan', title: 'Meitantei Conan' }] } : null);
  engine.routes.mockResolvedValue({ done: true, routes: [route()] });
  const view = pendingMetadataScreen();
  view.anime.play(minimalConan, 1);
  await vi.advanceTimersByTimeAsync(1);
  view.finish(); await view.opening;
  await vi.advanceTimersByTimeAsync(2);
  expect(engine.find).toHaveBeenCalledWith(expect.arrayContaining(['Meitantei Conan']), expect.any(Function), expect.any(Object));
  expect(view.body.querySelectorAll('.an-srv--ready')).toHaveLength(1);
  view.anime.leaveDetail();
});

it('prepares copies validated by the current matcher while unrelated metadata is still pending', async () => {
  const values = new Map([['vantara.anime.found.v2', JSON.stringify({235: {at: Date.now(), work: {title: 'Meitantei Conan', copies: [{sourceId: 'wit', url: '/conan'}]}}})]]);
  vi.stubGlobal('localStorage', { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) });
  engine.routes.mockResolvedValue({ done: true, routes: [route()] });
  const view = pendingMetadataScreen();
  view.anime.play(minimalConan, 1);
  await vi.advanceTimersByTimeAsync(1);
  expect(engine.prepare).toHaveBeenCalledTimes(1);
  expect(view.body.querySelectorAll('.an-srv--ready')).toHaveLength(1);
  view.close(); view.finish(); await view.opening;
  view.anime.leaveDetail();
});

it('does not prepare after the sheet closes while metadata is pending', async () => {
  engine.find.mockResolvedValue({ copies: [{sourceId: 'wit', url: '/conan'}] });
  const view = pendingMetadataScreen();
  view.anime.play(minimalConan, 1);
  await vi.advanceTimersByTimeAsync(1);
  view.close(); view.finish(); await view.opening;
  await vi.advanceTimersByTimeAsync(1);
  expect(engine.prepare).not.toHaveBeenCalled();
  expect(engine.listeners.get('route')?.size ?? 0).toBe(0);
  view.anime.leaveDetail();
});

it('settles pending metadata at the sheet deadline and ignores its late completion', async () => {
  engine.find.mockResolvedValue({ copies: [{sourceId: 'wit', url: '/conan'}] });
  const view = pendingMetadataScreen();
  view.anime.play(minimalConan, 1);
  await vi.advanceTimersByTimeAsync(45001);
  expectRetry(view.body);
  view.finish(); await view.opening;
  await vi.advanceTimersByTimeAsync(1);
  expect(engine.prepare).not.toHaveBeenCalled();
  expectRetry(view.body);
  view.anime.leaveDetail();
});
