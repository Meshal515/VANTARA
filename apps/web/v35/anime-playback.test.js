import { parseHTML } from 'linkedom';
import { afterEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ find: vi.fn(async () => ({ copies: [{ sourceId: 'shahiid', url: '/rezero', title: 'Re:Zero 4th Season' }] })), addons: vi.fn(async () => []), extend: vi.fn(async () => 1), listeners: new Map(), open: vi.fn(), best: vi.fn(async () => ({ candidate: 'stream-480', code: 'MMX' })) }));
vi.mock('./motion.js', () => ({ pop() {}, pageIn() {}, revealIn() {}, stripIn() {} }));
vi.mock('../lib/anime-engine.js', async (original) => ({
  ...await original(), available: () => true, sources: async () => [], onNeedsHuman() {},
  on: (event, fn) => { state.listeners.set(event, fn); return () => state.listeners.delete(event); },
  findWorkStream: state.find, withAddonCopies: state.addons, extend: state.extend,
  prepare: vi.fn(async () => ({ session: 'test-session', routes: [], done: false })),
  routes: async () => ({ routes: [], done: false }), best: state.best,
  pick: async (_session, route) => route === '480' ? 'stream-480' : 'stream-1080',
  open: state.open, closeSession: async () => {},
}));
const { createAnime } = await import('./anime.js');
afterEach(() => { state.listeners.clear(); state.open.mockClear(); state.best.mockClear(); state.addons.mockReset().mockResolvedValue([]); state.extend.mockClear(); vi.useRealTimers(); vi.unstubAllGlobals(); });
it('prepares the explicitly chosen source instead of a cached copy of the same work', async () => {
  vi.useFakeTimers();
  const engine = await import('../lib/anime-engine.js');
  const { window, document } = parseHTML('<html><body><main></main></body></html>');
  vi.stubGlobal('window', window); vi.stubGlobal('document', document);
  vi.stubGlobal('Image', function () { return document.createElement('img'); });
  vi.stubGlobal('requestAnimationFrame', fn => setTimeout(fn, 0));
  vi.stubGlobal('localStorage', { getItem: () => null, setItem() {} });
  const body = document.querySelector('main'); let cleanup;
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text) n.textContent = text; return n; };
  const anime = createAnime({ root: body, q: () => null, el, toast() {}, genreAr: s => s, openSheet: fn => { cleanup = fn(body); }, closeSheet() {}, currentPage: () => 'anime' });
  const m = { id: 234, title: 'Example', episodes: 12 };
  anime.play(m, 1); await vi.advanceTimersByTimeAsync(0); cleanup?.();
  engine.prepare.mockClear();
  const selected = { sourceId: 'chosen-source', url: '/chosen', title: 'Example' };
  anime.play({ ...m, _sourceCopy: selected }, 1); await vi.advanceTimersByTimeAsync(0);
  expect(engine.prepare).toHaveBeenCalledWith(expect.objectContaining({ copies: [selected] }));
  cleanup?.();
  engine.prepare.mockClear();
  anime.play(m, 1); await vi.advanceTimersByTimeAsync(0);
  expect(engine.prepare).toHaveBeenCalledWith(expect.objectContaining({ copies: [{ sourceId: 'shahiid', url: '/rezero', title: 'Re:Zero 4th Season' }] }));
  cleanup?.();
});
it('opens a movie as a movie and resolves its single playable unit without assuming episode number one', async () => {
  vi.useFakeTimers();
  const engine = await import('../lib/anime-engine.js'); engine.prepare.mockClear();
  const { window, document } = parseHTML('<html><body><main></main></body></html>');
  vi.stubGlobal('window', window); vi.stubGlobal('document', document);
  vi.stubGlobal('Image', function () { return document.createElement('img'); });
  vi.stubGlobal('requestAnimationFrame', fn => setTimeout(fn, 0));
  vi.stubGlobal('localStorage', { getItem: () => null, setItem() {} });
  const body = document.querySelector('main'); let cleanup;
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text) n.textContent = text; return n; };
  const anime = createAnime({ root: body, q: () => null, el, toast() {}, genreAr: s => s, openSheet: fn => { cleanup = fn(body); }, closeSheet() {}, currentPage: () => 'anime' });
  anime.play({ id: 245, title: 'A Film', format: 'MOVIE', episodes: 1, _sourceCopy: { sourceId: 'movie-source', url: '/film', title: 'A Film' } }, 1);
  await vi.advanceTimersByTimeAsync(0);
  expect(engine.prepare).toHaveBeenCalledWith(expect.objectContaining({ episode: -1 }));
  expect(body.textContent).toContain('الفيلم');
  expect(body.textContent).not.toContain('الحلقة 1');
  state.listeners.get('route')({ session: 'test-session', route: { id: '480', sourceId: 'movie-source', server: 'Megamax', code: 'MMX', quality: 480, state: 'READY', probed: true, candidates: ['stream-480'] } });
  await vi.advanceTimersByTimeAsync(0);
  await body.querySelector('.an-srv').onclick();
  expect(state.open).toHaveBeenCalledWith(expect.objectContaining({ format: 'MOVIE', total: 1, episode: 1 }));
  cleanup?.();
});
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
  for (const quality of [1080, 480]) state.listeners.get('route')({ session: 'test-session', route: { id: String(quality), sourceId: 'shahiid', server: 'Megamax', code: 'MMX', quality, state: 'READY', probed: true, candidates: [`stream-${quality}`], variant: 'SUB' } });
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

it('joins late ordinary sources to an addon-first picker without autoplay', async () => {
  vi.useFakeTimers();
  let publish, finish;
  state.find.mockImplementationOnce((_titles, onHit) => { publish = onHit; return new Promise(resolve => { finish = resolve; }); });
  state.addons.mockResolvedValueOnce([{sourceId:'addon|kitsu',url:'kitsu:12',id:'kitsu:12',identity:{kind:'anime',format:'TV',externalIds:{kitsu:'12'},episode:1}}]);
  const { window, document } = parseHTML('<html><body><main></main></body></html>');
  vi.stubGlobal('window', window); vi.stubGlobal('document', document);
  vi.stubGlobal('Image', function () { return document.createElement('img'); });
  vi.stubGlobal('requestAnimationFrame', (fn) => setTimeout(fn, 0));
  const persisted = new Map();
  vi.stubGlobal('localStorage', { getItem: key => persisted.get(key) ?? null, setItem: (key, value) => persisted.set(key, value) });
  let cleanup; const body = document.querySelector('main');
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text) n.textContent = text; return n; };
  const anime=createAnime({root:body,q:()=>null,el,toast(){},genreAr:s=>s,openSheet:fn=>{cleanup=fn(body);},closeSheet(){},currentPage:()=> 'anime'});
  anime.play({id:21,title:'One Piece',format:'TV',episodes:1200},2);
  await vi.advanceTimersByTimeAsync(0);
  state.extend.mockClear();
  const core={copies:[{sourceId:'wit',url:'/one-piece'}]};publish(core);finish(core);
  await vi.advanceTimersByTimeAsync(0);
  expect(state.extend).toHaveBeenCalledWith('test-session',expect.arrayContaining([core.copies[0]]));
  expect(JSON.parse(persisted.get('vantara.anime.found.v2'))[21].work.copies.map(c => c.sourceId).sort()).toEqual(['addon|kitsu', 'wit']);
  expect(state.open).not.toHaveBeenCalled();cleanup?.();
});
