import { parseHTML } from 'linkedom';
import { afterEach, expect, it, vi } from 'vitest';
import { createServerSheet } from './server-sheet.js';

afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });
it('destroys scheduled measurements, fling timers, media-query listeners and future callbacks', () => {
  vi.useFakeTimers();
  const { document, Event } = parseHTML('<html><body><main></main></body></html>');
  const listeners = new Set();
  const mq = { matches: false, addEventListener: (_event, fn) => listeners.add(fn), removeEventListener: (_event, fn) => listeners.delete(fn) };
  vi.stubGlobal('matchMedia', () => mq);
  vi.stubGlobal('requestAnimationFrame', fn => setTimeout(fn, 0));
  vi.stubGlobal('cancelAnimationFrame', clearTimeout);
  const body = document.querySelector('main');
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const picked = vi.fn();
  const ui = createServerSheet(body, { el, onPick: picked, media: { title: 'A', description: 'Description', backdrop: 'https://example.test/a.jpg' } });
  ui.update({ routes: [{ id: 'r', sourceId: 'wit', state: 'READY', probed: true, quality: 1080 }], settled: true });
  ui.scroll.dispatchEvent(new Event('scroll'));
  ui.scroll.dispatchEvent(new Event('touchend'));
  expect(vi.getTimerCount()).toBeGreaterThan(0); expect(listeners.size).toBe(2);
  expect(typeof ui.destroy).toBe('function'); ui.destroy(); ui.destroy();
  expect(vi.getTimerCount()).toBe(0); expect(listeners.size).toBe(0);
  const text = body.textContent;
  ui.scroll.dispatchEvent(new Event('scroll')); ui.scroll.dispatchEvent(new Event('touchend'));
  ui.best.click(); ui.update({ routes: [], settled: true }); vi.runAllTimers();
  expect(body.textContent).toBe(text); expect(picked).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
  for (const img of body.querySelectorAll('img')) { expect(img.onload).toBeNull(); expect(img.onerror).toBeNull(); }
});
