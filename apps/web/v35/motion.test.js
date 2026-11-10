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

it('in-app motion off disables shared GSAP list motion', async () => {
  const {stripIn,reduced}=await import('./motion.js');
  const before=globalThis.document;
  try {
    globalThis.document={documentElement:{dataset:{motion:'off'}}};
    gsap.fromTo.mockClear();
    expect(reduced()).toBe(true);
    stripIn([{style:{}}]);
    expect(gsap.fromTo).not.toHaveBeenCalled();
  }finally{globalThis.document=before;}
});

it('runs the original GSAP cover entrance once for a reused DOM card', async () => {
  const {stripIn}=await import('./motion.js');
  gsap.fromTo.mockClear();
  gsap.killTweensOf.mockClear();
  const a={style:{},isConnected:true}, b={style:{},isConnected:true};
  stripIn([a,b]); stripIn([a,b]);
  expect(gsap.fromTo).toHaveBeenCalledTimes(1);
  expect(gsap.fromTo.mock.calls[0][0]).toEqual([a,b]);
  expect(gsap.fromTo.mock.calls[0][2]).toMatchObject({duration:0.4,stagger:0.04});
  stripIn([{style:{},isConnected:false}]);
  expect(gsap.fromTo).toHaveBeenCalledTimes(1);
  const c={style:{},isConnected:true};
  stripIn([a,c]);
  expect(gsap.fromTo).toHaveBeenCalledTimes(2);
  expect(gsap.fromTo.mock.calls[1][0]).toEqual([c]);
});
