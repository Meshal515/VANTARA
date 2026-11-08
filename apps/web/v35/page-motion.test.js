import { afterEach, describe, expect, it, vi } from 'vitest';
import { morphCover, onScreen } from './page-motion.js';

afterEach(() => vi.unstubAllGlobals());

function node(rect, { img = true } = {}) {
  const kids = [];
  const n = {
    isConnected: true,
    style: {},
    getBoundingClientRect: () => rect,
    querySelector: (s) => (s === 'img' ? kids.find((k) => k.tag === 'img') ?? null : null),
    append: (k) => kids.push(k),
    kids,
  };
  if (img) kids.push(fakeImg());
  return n;
}
function fakeImg() {
  return {
    tag: 'img',
    dataset: {},
    style: {},
    getAttribute: (k) => (k === 'src' ? 'cover.jpg' : null),
    removeAttribute() {},
    cloneNode() { return fakeImg(); },
    animate: vi.fn(() => ({ finished: new Promise(() => {}), cancel: vi.fn() })),
    remove: vi.fn(),
  };
}
const doc = (extra = {}) => ({ documentElement: { dataset: extra.dataset ?? {} }, body: { append: vi.fn() } });
const R = (top, left, w, h) => ({ top, left, width: w, height: h, bottom: top + h, right: left + w });

describe('shared work cover (FLIP: one image moved with transform, no page snapshots)', () => {
  it('only moves from a card that is actually on screen', () => {
    vi.stubGlobal('innerWidth', 390);
    vi.stubGlobal('innerHeight', 844);
    expect(onScreen(node(R(100, 10, 140, 200)))).toBe(true);
    expect(onScreen(node(R(900, 10, 140, 200)))).toBe(false);
    expect(onScreen(node(R(100, 0, 0, 0)))).toBe(false);
  });

  it('just swaps with reduced motion, or from a card off screen: no ghost, no frozen page', () => {
    vi.stubGlobal('innerWidth', 390);
    vi.stubGlobal('innerHeight', 844);
    const swap = vi.fn();
    const d = doc({ dataset: { motion: 'off' } });
    expect(morphCover(node(R(100, 10, 140, 200)), swap, () => null, { doc: d })).toBe(false);
    expect(morphCover(node(R(1200, 10, 140, 200)), swap, () => null, { doc: doc() })).toBe(false);
    expect(swap).toHaveBeenCalledTimes(2);
    expect(d.body.append).not.toHaveBeenCalled();
  });

  it('flies one copy of the same image from the card to the cover, hiding the destination until it lands', () => {
    vi.stubGlobal('innerWidth', 390);
    vi.stubGlobal('innerHeight', 844);
    const from = node(R(600, 20, 100, 150));
    const to = node(R(80, 200, 180, 270), { img: false });
    const d = doc();
    expect(morphCover(from, () => {}, () => to, { doc: d })).toBe(true);
    expect(d.body.append).toHaveBeenCalledTimes(1);
    const ghost = d.body.append.mock.calls[0][0];
    expect(ghost.style.position).toBe('absolute');
    expect(ghost.animate).toHaveBeenCalledTimes(1);
    const [frames] = ghost.animate.mock.calls[0];
    expect(frames[0].transform).toBe('translate(-180px, 520px) scale(0.5555555555555556, 0.5555555555555556)');
    expect(frames[1].transform).toBe('none');
    expect(to.style.visibility).toBe('hidden');
    expect(to.kids).toHaveLength(1); // the same image placed in the cover so nothing blank is revealed
  });

  it('places the flying copy in page coordinates, so scrolling during the return carries it with the card', () => {
    // Owner: back, then scroll: the cover flew to the card's old screen spot, vanished, and the card appeared
    // higher (down, then up in one jump). A fixed ghost ignores scrolling; a page-positioned one moves with it.
    vi.stubGlobal('innerWidth', 390);
    vi.stubGlobal('innerHeight', 844);
    vi.stubGlobal('scrollX', 0);
    vi.stubGlobal('scrollY', 924);
    const d = doc();
    morphCover(node(R(80, 200, 180, 270)), () => {}, () => node(R(380, 20, 100, 150)), { doc: d });
    const ghost = d.body.append.mock.calls[0][0];
    expect(ghost.style.position).toBe('absolute');
    expect(ghost.style.top).toBe(`${380 + 924}px`);
  });
});
