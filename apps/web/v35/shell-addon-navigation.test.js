import { parseHTML } from 'linkedom';
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


function typePrompt(work, { active = () => true, contentTypes = ['movie', 'series'] } = {}) {
  const { document } = parseHTML('<main></main>');
  const body = document.querySelector('main');
  const el = (tag, cls, text) => { const node = document.createElement(tag); if (cls) node.className = cls; if (text) node.textContent = text; return node; };
  let chosen = null, closed = false;
  expect(shell.promptSourceWorkType).toBeTypeOf('function');
  const prompted = shell.promptSourceWorkType(work, { contentTypes }, { el, active, openSheet: build => build(body), closeSheet: () => { closed = true; },
    sheetItem: (_icon, label, run) => { const button = el('button', 'sheet-item', label); button.onclick = run; return button; }, onChoose: value => { chosen = value; } });
  return { body, prompted, selected: () => chosen, closed: () => closed };
}

it('lets a person choose series for an untyped native cinema work without changing its identity', () => {
  const work = { sourceId: 'user-asia', url: '/published-work', title: 'Published title' };
  const view = typePrompt(work);
  expect(view.prompted).toBe(true);
  expect([...view.body.querySelectorAll('button')].map(button => button.textContent)).toEqual(['فيلم', 'مسلسل']);
  [...view.body.querySelectorAll('button')].find(button => button.textContent === 'مسلسل').click();
  expect(view.selected()).toEqual({ sourceId: 'user-asia', url: '/published-work', title: 'Published title', type: 'series' });
  expect(view.closed()).toBe(true);
  expect(work.type).toBeUndefined();
});

it('does not prompt or replace a type already declared by the source', () => {
  const view = typePrompt({ url: '/movie', type: 'movie' });
  expect(view.prompted).toBe(false);expect(view.body.children.length).toBe(0);expect(view.selected()).toBeNull();
  expect(typePrompt({ url: '/anime' }, { contentTypes: ['anime'] }).prompted).toBe(false);
});

it('ignores a delayed cinema type choice after leaving the source', () => {
  const view = typePrompt({ url: '/old-work' }, { active: () => false });
  view.body.querySelector('button').click();
  expect(view.selected()).toBeNull();expect(view.closed()).toBe(false);
});
