import { afterEach, describe, expect, it, vi } from 'vitest';
import { morphCover, onScreen } from './page-motion.js';

const box = (rect) => ({ isConnected: true, style: {}, getBoundingClientRect: () => rect, querySelector: () => null, append() {} });
afterEach(() => vi.unstubAllGlobals());

describe('shared work cover', () => {
  it('only morphs from a card that is actually on screen', () => {
    vi.stubGlobal('innerWidth', 390);
    vi.stubGlobal('innerHeight', 844);
    expect(onScreen(box({ top: 100, bottom: 300, left: 10, right: 150, width: 140, height: 200 }))).toBe(true);
    expect(onScreen(box({ top: 900, bottom: 1100, left: 10, right: 150, width: 140, height: 200 }))).toBe(false);
    expect(onScreen(box({ top: 100, bottom: 100, left: 0, right: 0, width: 0, height: 0 }))).toBe(false);
  });

  it('swaps straight away without View Transitions or with reduced motion (no frozen page)', () => {
    const swap = vi.fn();
    const doc = { documentElement: { dataset: {}, classList: { add() {}, remove() {} } } };
    expect(morphCover(box({ top: 0, bottom: 10, left: 0, right: 10, width: 10, height: 10 }), swap, () => null, { doc })).toBe(false);
    expect(swap).toHaveBeenCalledTimes(1);
    const reduced = { ...doc, startViewTransition: vi.fn(), documentElement: { dataset: { motion: 'off' }, classList: { add() {}, remove() {} } } };
    expect(morphCover(box({ top: 0, bottom: 10, left: 0, right: 10, width: 10, height: 10 }), swap, () => null, { doc: reduced })).toBe(false);
    expect(reduced.startViewTransition).not.toHaveBeenCalled();
    expect(swap).toHaveBeenCalledTimes(2);
  });

  it('names the source cover, then hands the name to the destination inside the same transition', () => {
    vi.stubGlobal('innerWidth', 390);
    vi.stubGlobal('innerHeight', 844);
    const from = box({ top: 100, bottom: 300, left: 10, right: 150, width: 140, height: 200 });
    const to = box({ top: 60, bottom: 400, left: 200, right: 380, width: 180, height: 260 });
    let namedAtStart = null;
    let finish;
    const doc = {
      documentElement: { dataset: {}, classList: { add() {}, remove() {} } },
      startViewTransition(update) { namedAtStart = from.style.viewTransitionName; update(); return { finished: new Promise((r) => { finish = r; }) }; },
    };
    expect(morphCover(from, () => {}, () => to, { doc })).toBe(true);
    expect(namedAtStart).toBe('vantara-work-cover');
    expect(from.style.viewTransitionName).toBe('');
    expect(to.style.viewTransitionName).toBe('vantara-work-cover');
    finish();
  });
});
