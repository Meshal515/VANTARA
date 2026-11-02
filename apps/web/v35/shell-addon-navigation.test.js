import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as shell from './shell.js';

const navigation = () => {
  expect(shell.createAddonNavigation).toBeTypeOf('function');
  return shell.createAddonNavigation();
};
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it('cancels an earlier source lookup while a replacement navigation stays usable', async () => {
  const nav = navigation(), old = nav.begin(), pending = deferred();
  let oldSignal;
  const outcome = old.wait(signal => { oldSignal = signal; return pending.promise; }).catch(error => error);
  await vi.advanceTimersByTimeAsync(0);
  const next = nav.begin();
  expect((await outcome).name).toBe('AbortError');
  expect(oldSignal.aborted).toBe(true);
  old.finish();
  expect(await next.wait(signal => signal.aborted ? 'cancelled' : 'new source')).toBe('new source');
  pending.resolve('stale source');
  await vi.advanceTimersByTimeAsync(0);
  expect(next.signal.aborted).toBe(false);
  next.finish();nav.cancel();
});

it('ends a stalled source phase at fifteen seconds and permits an independent retry', async () => {
  const nav = navigation(), lookup = nav.begin();
  const outcome = lookup.wait(() => new Promise(() => {}), 'SOURCE_DISCOVERY_TIMEOUT').catch(error => error);
  await vi.advanceTimersByTimeAsync(15_001);
  expect((await outcome).code).toBe('SOURCE_DISCOVERY_TIMEOUT');
  expect(lookup.signal.aborted).toBe(true);
  const retry = nav.begin();
  expect(await retry.wait(() => ({ status: 'ready' }))).toEqual({ status: 'ready' });
  retry.finish();nav.cancel();
});

it('caps a sequence of individually responsive source phases at forty seconds total', async () => {
  const nav = navigation(), lookup = nav.begin();
  const phase = () => lookup.wait(() => new Promise(resolve => setTimeout(resolve, 14_000)));
  const outcome = (async () => { await phase(); await phase(); await phase(); return 'opened'; })().catch(error => error);
  await vi.advanceTimersByTimeAsync(40_001);
  expect((await outcome).code).toBe('ADDON_TOTAL_TIMEOUT');
  expect(lookup.signal.aborted).toBe(true);
  nav.cancel();
});

it('cancels a pending work detail lookup when leaving its source and suppresses late adoption', async () => {
  const nav = navigation(), lookup = nav.begin(), pending = deferred();
  let adopted = false;
  const outcome = lookup.wait(() => pending.promise).then(() => { adopted = true; }, error => error);
  await vi.advanceTimersByTimeAsync(0);
  nav.cancel();
  pending.resolve({ title: 'Old work' });
  expect((await outcome).name).toBe('AbortError');
  expect(adopted).toBe(false);
  expect(vi.getTimerCount()).toBe(0);
});
