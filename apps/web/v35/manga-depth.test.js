import { describe, expect, it } from 'vitest';
import { MANGA_LOOKS, mangaScrollProgress, mountMangaScrollDepth } from './manga-work.js';

function fixture() {
  const listeners = new Map();
  const frames = new Map();
  let frameId = 0;
  const styleValues = new Map();
  const page = {
    isConnected: true,
    active: true,
    classList: { contains(name) { return name === 'active' && page.active; } },
    dataset: {},
    style: {
      setProperty(name, value) { styleValues.set(name, value); },
      removeProperty(name) { styleValues.delete(name); },
    },
    removeAttribute(name) { if (name === 'data-scroll-depth') delete this.dataset.scrollDepth; },
  };
  const doc = {
    hidden: false,
    addEventListener(name, fn) { listeners.set('doc:' + name, fn); },
    removeEventListener(name, fn) { if (listeners.get('doc:' + name) === fn) listeners.delete('doc:' + name); },
  };
  const reduced = {
    matches: false,
    addEventListener(name, fn) { listeners.set('motion:' + name, fn); },
    removeEventListener(name, fn) { if (listeners.get('motion:' + name) === fn) listeners.delete('motion:' + name); },
  };
  const win = {
    scrollY: 0,
    matchMedia() { return reduced; },
    addEventListener(name, fn) { listeners.set('win:' + name, fn); },
    removeEventListener(name, fn) { if (listeners.get('win:' + name) === fn) listeners.delete('win:' + name); },
    requestAnimationFrame(fn) { const id = ++frameId; frames.set(id, fn); return id; },
    cancelAnimationFrame(id) { frames.delete(id); },
  };
  const root = { dataset: { section: 'manga' }, querySelector() { return page; } };
  const flush = () => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(fn => fn()); };
  const emit = (event) => listeners.get(event)?.();
  return { page, root, win, doc, reduced, listeners, frames, styleValues, flush, emit };
}

describe('manga detail 3D scroll depth', () => {
  it('keeps every look but does not change page enter/exit animation', () => {
    expect(MANGA_LOOKS).toEqual(['page', 'gallery', 'profile', 'resume', 'webtoon', 'direct']);
  });

  it('clamps and normalizes scroll without overshoot', () => {
    expect(mangaScrollProgress(-20)).toBe(0);
    expect(mangaScrollProgress(0)).toBe(0);
    expect(mangaScrollProgress(190)).toBe(0.5);
    expect(mangaScrollProgress(380)).toBe(1);
    expect(mangaScrollProgress(9000)).toBe(1);
    expect(mangaScrollProgress(NaN)).toBe(0);
  });

  it('updates once per frame even during rapid passive scrolling', () => {
    const e = fixture();
    const motion = mountMangaScrollDepth(e.root, e.win, e.doc);
    expect(e.listeners.has('win:scroll')).toBe(true);
    e.flush();
    expect(e.styleValues.get('--mw-scroll-depth')).toBe('0.000');
    e.win.scrollY = 190;
    e.emit('win:scroll');
    e.emit('win:scroll');
    e.emit('win:scroll');
    expect(e.frames.size).toBe(1);
    e.flush();
    expect(e.styleValues.get('--mw-scroll-depth')).toBe('0.500');
    expect(e.page.dataset.scrollDepth).toBe('on');
    motion.destroy();
  });

  it('suspends when away from manga detail, hidden, or reduced motion', () => {
    const e = fixture();
    const motion = mountMangaScrollDepth(e.root, e.win, e.doc);
    e.flush();
    e.page.active = false;
    motion.sync();
    e.flush();
    expect(e.page.dataset.scrollDepth).toBeUndefined();
    expect(e.styleValues.has('--mw-scroll-depth')).toBe(false);
    e.page.active = true;
    e.reduced.matches = true;
    e.emit('motion:change');
    e.flush();
    expect(e.page.dataset.scrollDepth).toBeUndefined();
    e.reduced.matches = false;
    e.root.dataset.section = 'anime';
    motion.sync();
    e.flush();
    expect(e.page.dataset.scrollDepth).toBeUndefined();
    e.root.dataset.section = 'manga';
    e.doc.hidden = true;
    motion.sync();
    e.flush();
    expect(e.page.dataset.scrollDepth).toBeUndefined();
    e.doc.hidden = false;
    e.win.scrollY = 380;
    e.emit('doc:visibilitychange');
    e.flush();
    expect(e.styleValues.get('--mw-scroll-depth')).toBe('1.000');
    motion.destroy();
  });

  it('cancels scheduled frames and cleans every listener on remount/destroy', () => {
    const e = fixture();
    const motion = mountMangaScrollDepth(e.root, e.win, e.doc);
    expect(e.frames.size).toBe(1);
    motion.destroy();
    motion.destroy();
    expect(e.frames.size).toBe(0);
    expect(e.listeners.size).toBe(0);
    expect(e.styleValues.size).toBe(0);
    expect(e.page.dataset.scrollDepth).toBeUndefined();
    motion.sync();
    expect(e.frames.size).toBe(0);
  });
});
