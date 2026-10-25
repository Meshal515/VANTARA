import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { parseHTML } from 'linkedom';

vi.mock('../lib/update-engine.js', () => ({ timeline: vi.fn() }));
vi.mock('../lib/manga-alias-store.js', () => ({ loadAliases: vi.fn(async () => {}) }));
import { timeline } from '../lib/update-engine.js';
import { loadAliases } from '../lib/manga-alias-store.js';
import { mountTimeline, paintWithScrollAnchor } from './updates-view.js';

let document, host, api;
const event = (id, work = id) => ({ id, work, section: 'manga', title: work, kind: 'chapter', number: Number(id) || 1, at: Date.now(), publishedAt: Date.now(), cover: '/cover.jpg', sources: [] });
const page = (events, next = null) => ({ events, next, snapshotAt: Date.now() });
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text) n.textContent = text; return n; };
const mount = (options = {}) => (api = mountTimeline(host, { section: 'manga', el, open: () => {}, empty: () => el('p', '', 'empty'), image: () => el('img'), ...options }));
beforeEach(() => {
  ({ document } = parseHTML('<html><body><section id="host"></section></body></html>'));
  host = document.getElementById('host');
  vi.stubGlobal('document', document);
  vi.stubGlobal('IntersectionObserver', undefined);
  timeline.mockReset();
  loadAliases.mockReset().mockResolvedValue(undefined);
});
afterEach(() => { api?.dispose(); api = null; vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('releases loading after a thrown request and allows a successful retry', async () => {
  timeline.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(page([event('1')], 'older'));
  mount();
  await vi.waitFor(() => expect(host.querySelector('.up-error')).not.toBeNull());
  expect(await api.refresh()).toBe(true);
  expect(host.querySelectorAll('.up-card')).toHaveLength(1);
  expect(host.querySelector('.up-load-more').disabled).toBe(false);
});
it('discards an earlier poll that resolves after a newer manual refresh',async()=>{
  let poll,release;
  vi.spyOn(globalThis,'setInterval').mockImplementation(fn=>{poll=fn;return 0;});
  const now=Date.now(),old={...event('old'),at:now-7200000,publishedAt:now-7200000};
  const backfilled={...event('backfilled'),at:now-3600000,publishedAt:now-3600000};
  timeline.mockResolvedValueOnce(page([old])).mockImplementationOnce(()=>new Promise(r=>{release=r;})).mockResolvedValueOnce(page([backfilled,old]));
  mount();await vi.waitFor(()=>expect(host.querySelectorAll('.up-card')).toHaveLength(1));
  const olderPoll=poll();await vi.waitFor(()=>expect(timeline).toHaveBeenCalledTimes(2));
  await api.refresh();expect(host.querySelectorAll('.up-card')).toHaveLength(2);
  release(page([old]));await olderPoll;
  expect(host.querySelectorAll('.up-card')).toHaveLength(2);
});

it('keeps a grouped work card and its cover mounted when a newer chapter arrives', async () => {
  const art = vi.fn((target) => target.append(el('img')));
  timeline.mockResolvedValueOnce(page([event('1', 'one')])).mockResolvedValueOnce(page([event('2', 'one'), event('1', 'one')]));
  mount({ mountCover: art });
  await vi.waitFor(() => expect(host.querySelectorAll('.up-card')).toHaveLength(1));
  const card = host.querySelector('.up-card'), cover = card.querySelector('img');
  await api.refresh();
  expect(host.querySelector('.up-card')).toBe(card);
  expect(card.querySelector('img')).toBe(cover);
  expect(art).toHaveBeenCalledTimes(1);
  expect(card.querySelector('.up-unit').textContent).toBe('الفصل 2');
  expect(card.querySelector('.up-plus').textContent).toBe('+1');
});

it('continues pagination while the sentinel remains visible after grouped pages', async () => {
  let intersection;
  vi.stubGlobal('IntersectionObserver', class { constructor(fn) { intersection = fn; } observe() {} disconnect() {} });
  timeline.mockResolvedValueOnce(page([event('1', 'one')], 'p2'))
    .mockResolvedValueOnce(page([event('2', 'one')], 'p3'))
    .mockResolvedValueOnce(page([event('3', 'two')]));
  mount();
  document.defaultView.innerHeight = 800;
  host.querySelector('.up-more').getBoundingClientRect = () => ({ top: 400, bottom: 440 });
  intersection([{ isIntersecting: true }]);
  await vi.waitFor(() => expect(timeline).toHaveBeenCalledTimes(3));
  expect(timeline.mock.calls.map(([, options]) => options.before)).toEqual([null, 'p2', 'p3']);
  expect(host.querySelectorAll('.up-card')).toHaveLength(2);
});

it('provides a pagination retry separate from refreshing the newest page', async () => {
  timeline.mockResolvedValueOnce(page([event('1')], 'p2')).mockResolvedValueOnce(null).mockResolvedValueOnce(page([event('0')], null));
  mount();
  await vi.waitFor(() => expect(host.querySelectorAll('.up-card')).toHaveLength(1));
  await api.loadMore();
  expect(host.querySelector('.up-load-more').disabled).toBe(false);
  await api.loadMore();
  expect(timeline.mock.calls.map(([, options]) => options.before)).toEqual([null, 'p2', 'p2']);
  expect(host.querySelectorAll('.up-card')).toHaveLength(2);
});

it('anchors the card inside its scrolling element instead of moving the window', () => {
  const moves = [];
  const view = { innerHeight: 700, scrollBy: () => { throw new Error('window must stay still'); }, getComputedStyle: () => ({ overflowY: 'auto' }) };
  const scroller = { parentElement: null, clientHeight: 300, clientTop: 0, scrollTop: 500, getBoundingClientRect: () => ({ top: 100, bottom: 400 }), scrollBy: (x, y) => moves.push([x, y]) };
  const card = (id, top) => ({ dataset: { eventId: id }, getBoundingClientRect: () => ({ top, bottom: top + 60 }) });
  const list = { parentElement: scroller, ownerDocument: { defaultView: view }, children: [card('clipped', 0), card('visible', 120)] };
  paintWithScrollAnchor(list, () => { list.children = [card('clipped', 50), card('visible', 370)]; });
  expect(moves).toEqual([[0, 250]]);
});

it('marks an undated chapter as observed instead of claiming its publication time', async () => {
  timeline.mockResolvedValueOnce(page([{ ...event('1'), publishedAt: null }]));
  mount();
  await vi.waitFor(() => expect(host.querySelector('.up-when')?.textContent).toMatch(/^رُصد /));
});

it('bridges more than a head page of new events before resuming the original older cursor', async () => {
  const initial = event('1', 'old');
  const head = Array.from({ length: 100 }, (_, i) => event(String(300 - i)));
  timeline.mockResolvedValueOnce(page([initial], 'old-page'))
    .mockResolvedValueOnce(page(head, 'new-bridge'))
    .mockResolvedValueOnce(page([event('150', 'missing'), initial], 'unneeded'))
    .mockResolvedValueOnce(page([event('0', 'oldest')]));
  mount();
  await vi.waitFor(() => expect(host.querySelectorAll('.up-card')).toHaveLength(1));
  await api.refresh();
  await api.loadMore();
  await api.loadMore();
  expect(timeline.mock.calls.map(([, options]) => options.before)).toEqual([null, undefined, 'new-bridge', 'old-page']);
  expect(host.querySelectorAll('.up-card')).toHaveLength(103);
});
