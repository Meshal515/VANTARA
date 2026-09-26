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
