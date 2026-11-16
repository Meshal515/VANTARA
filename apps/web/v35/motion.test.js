import { expect, it, vi } from 'vitest';

const gsap = vi.hoisted(() => ({ killTweensOf: vi.fn(), fromTo: vi.fn() }));
vi.mock('../vendor/gsap.esm.js', () => ({ gsap }));
import { swapViews } from './motion.js';

it('makes the destination visible synchronously even if animation frames never run', () => {
  const from = { hidden: false, opacity: 1, scale: 1, filter: '' };
  const to = { hidden: true, querySelectorAll: () => [] };
  let called = 0;
  swapViews(from, to, { onSwap: () => { called += 1; } });
  expect(from.hidden).toBe(true);
  expect(to.hidden).toBe(false);
  expect(called).toBe(1);
  expect(gsap.fromTo).toHaveBeenCalled();
});

// #323 D4: ظهور الشبكات بعقد الحركة نفسه (تلاشٍ واندفاع 96%، MOTION)، مرة لكل عنصر، ولا شيء مع إيقاف الحركة
const card = () => ({ style: {}, isConnected: true, animate: vi.fn() });
it('in-app motion off disables list motion', async () => {
  const { stripIn, reduced } = await import('./motion.js');
  const before = globalThis.document;
  try {
    globalThis.document = { documentElement: { dataset: { motion: 'off' } } };
    expect(reduced()).toBe(true);
    const c = card(); stripIn([c]);
    expect(c.animate).not.toHaveBeenCalled();
  } finally { globalThis.document = before; }
});

it('cards push in with the page motion contract, once per DOM identity', async () => {
  const { stripIn } = await import('./motion.js');
  const { MOTION } = await import('./page-motion.js');
  const a = card(), b = card();
  stripIn([a, b]); stripIn([a, b]);
  expect(a.animate).toHaveBeenCalledTimes(1);
  expect(a.animate.mock.calls[0][0]).toEqual([{ opacity: 0, transform: `scale(${MOTION.push})` }, { opacity: 1, transform: 'none' }]);
  expect(a.animate.mock.calls[0][1]).toMatchObject({ duration: MOTION.ms, easing: MOTION.enter, delay: 0 });
  expect(b.animate.mock.calls[0][1]).toMatchObject({ delay: 40 });
  const gone = { ...card(), isConnected: false }; stripIn([gone]);
  expect(gone.animate).not.toHaveBeenCalled();
  const c = card(); stripIn([a, c]);
  expect(a.animate).toHaveBeenCalledTimes(1);
  expect(c.animate).toHaveBeenCalledTimes(1);
});
