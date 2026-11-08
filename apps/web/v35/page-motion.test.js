import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindTabMotion, finishPageMotion, pageIn, pageOut } from './page-motion.js';

afterEach(() => { finishPageMotion(); vi.unstubAllGlobals(); });

function page(rect = { top: -900, left: 0, width: 390, height: 3000 }) {
  const anims = [];
  const classes = new Set();
  return {
    style: {},
    classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c) },
    getBoundingClientRect: () => rect,
    animate: vi.fn((frames, opts) => { const a = { frames, opts, cancel: vi.fn(), finished: new Promise(() => {}) }; anims.push(a); return a; }),
    anims,
    classes,
  };
}
const doc = (motion) => ({ documentElement: { dataset: motion ? { motion } : {} } });

describe('page fade with motion (owner: fade in moving in, fade out moving out; no flying cover)', () => {
  it('deeper: the new page rises in, the old one shrinks out', () => {
    const a = page(); const b = page();
    pageOut(a, { doc: doc() }); pageIn(b, { doc: doc() });
    expect(a.anims[0].frames.at(-1)).toMatchObject({ opacity: 0, transform: 'scale(0.97)' });
    expect(b.anims[0].frames[0]).toMatchObject({ opacity: 0, transform: 'translateY(14px)' });
  });
  it('back: exactly the reverse', () => {
    const a = page(); const b = page();
    pageOut(a, { back: true, doc: doc() }); pageIn(b, { back: true, doc: doc() });
    expect(a.anims[0].frames.at(-1).transform).toBe('translateY(14px)');
    expect(b.anims[0].frames[0].transform).toBe('scale(0.97)');
  });
  it('the leaving page stays where it was on screen (scroll and side rail), then is restored', () => {
    const a = page({ top: -924, left: 260, width: 1180, height: 3000 });
    pageOut(a, { doc: doc() });
    expect(a.classes.has('page-out')).toBe(true);
    expect(a.style).toMatchObject({ top: '-924px', left: '260px', width: '1180px' });
    finishPageMotion();
    expect(a.classes.has('page-out')).toBe(false);
    expect(a.style).toMatchObject({ top: '', left: '', width: '' });
    expect(a.anims[0].cancel).toHaveBeenCalled();
  });
  it('reduced motion: nothing animates', () => {
    const a = page(); const b = page();
    pageOut(a, { doc: doc('off') }); pageIn(b, { doc: doc('off') });
    expect(a.animate).not.toHaveBeenCalled();
    expect(b.animate).not.toHaveBeenCalled();
  });
});

describe('tabs inside a page (one rule for all of VANTARA)', () => {
  it('fades in what follows the tab bar after the handler re-renders it; the bar itself stays still', async () => {
    const { parseHTML } = await import('linkedom');
    const { document } = parseHTML('<div id="r"><section><nav role="tablist"><button role="tab" id="t">أ</button></nav><div id="c"></div></section></div>');
    const root = document.getElementById('r');
    const animated = [];
    for (const n of root.querySelectorAll('*')) n.animate = () => { animated.push(n.id || n.tagName); return {}; };
    vi.stubGlobal('requestAnimationFrame', (fn) => fn());
    bindTabMotion(root, { doc: doc() });
    document.getElementById('t').dispatchEvent(new document.defaultView.Event('click', { bubbles: true }));
    expect(animated).toEqual(['c']);
  });
});
