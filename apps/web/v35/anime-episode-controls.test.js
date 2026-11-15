import { parseHTML } from 'linkedom';
import { afterEach, expect, it, vi } from 'vitest';
import { createEpisodeControls } from './anime-episode-controls.js';
import { episodePage } from './anime-episodes.js';
afterEach(() => vi.useRealTimers());
function fixture() {
  vi.useFakeTimers();
  const { document, window } = parseHTML('<html><body></body></html>');
  const el = (tag, cls, text) => { const n=document.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=text;return n; };
  const onQuery=vi.fn(), onPage=vi.fn();
  const controls=createEpisodeControls({document,el,glyph:()=>'',onQuery,onPage,onTools:()=>{}});
  document.body.append(controls.root);
  return {controls,onQuery,onPage,window};
}
it('debounces typing and cancels the pending query when the page leaves', async () => {
  const {controls,onQuery,window}=fixture();
  controls.input.value='one';controls.input.dispatchEvent(new window.Event('input'));
  await vi.advanceTimersByTimeAsync(200);expect(onQuery).not.toHaveBeenCalled();
  controls.suspend();await vi.advanceTimersByTimeAsync(100);expect(onQuery).not.toHaveBeenCalled();
  controls.input.value='two';controls.input.dispatchEvent(new window.Event('input'));
  await vi.advanceTimersByTimeAsync(220);expect(onQuery).toHaveBeenCalledExactlyOnceWith('two');
});
it('waits for IME composition and cancels pending work on destruction', async () => {
  const {controls,onQuery,window}=fixture();
  controls.input.dispatchEvent(new window.Event('compositionstart'));
  controls.input.value='حلقة';controls.input.dispatchEvent(new window.Event('input'));
  await vi.advanceTimersByTimeAsync(300);expect(onQuery).not.toHaveBeenCalled();
  controls.input.dispatchEvent(new window.Event('compositionend'));expect(onQuery).toHaveBeenCalledExactlyOnceWith('حلقة');
  controls.input.value='old';controls.input.dispatchEvent(new window.Event('input'));controls.destroy();
  await vi.advanceTimersByTimeAsync(300);expect(onQuery).toHaveBeenCalledTimes(1);
});
it('retains group controls and scroll on an unchanged metadata update', () => {
  const {controls,onPage}=fixture();const page=episodePage({total:1000});
  controls.update({page});const ranges=controls.root.querySelector('.aw-ranges');
  ranges.scrollLeft=-200;const last=ranges.lastElementChild;
  controls.update({page:episodePage({total:1000,pageIndex:39})});
  expect(ranges.lastElementChild).toBe(last);expect(ranges.scrollLeft).toBe(-200);
  expect(last.getAttribute('aria-current')).toBe('page');expect(last.dir).toBe('ltr');
  last.click();expect(onPage).toHaveBeenCalledWith(39);
});
