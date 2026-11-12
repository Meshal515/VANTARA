// Social pages: repeated open/close, leak indicators (DOM nodes, intervals, listeners).
import { launch, sleep } from './harness.mjs';
const h = await launch({ section: 'anime' });
const { page } = h;
await page.evaluate(() => {
  const si = window.setInterval, ci = window.clearInterval, st = window.setTimeout;
  window.__iv = new Set();
  window.setInterval = (f, t, ...a) => { const id = si(f, t, ...a); window.__iv.add(id); return id; };
  window.clearInterval = (id) => { window.__iv.delete(id); return ci(id); };
  const add = EventTarget.prototype.addEventListener, rem = EventTarget.prototype.removeEventListener;
  window.__ls = 0;
  EventTarget.prototype.addEventListener = function (...a) { if (this === window || this === document) window.__ls++; return add.apply(this, a); };
  EventTarget.prototype.removeEventListener = function (...a) { if (this === window || this === document) window.__ls--; return rem.apply(this, a); };
});
await sleep(4000);
const m = () => page.evaluate(() => ({ nodes: document.getElementsByTagName('*').length, intervals: window.__iv.size, winDocListeners: window.__ls, sheets: document.querySelectorAll('.sheet, [role=dialog]').length }));
console.log('start', JSON.stringify(await m()));
for (let i = 0; i < 25; i++) {
  await page.evaluate(() => window.__shell.showPage('majlis')); await sleep(250);
  await page.evaluate(() => window.__shell.openMajlis()); await sleep(250);
  await page.evaluate(() => window.__shell.handleBack()); await sleep(150);
  await page.evaluate(() => window.__shell.openProfile()); await sleep(250);
  await page.evaluate(() => window.__shell.handleBack()); await sleep(150);
  await page.evaluate(() => window.__shell.showPage('home')); await sleep(200);
  if (i === 4 || i === 24) console.log('after', i + 1, JSON.stringify(await m()));
}
console.log('errors', JSON.stringify(h.log.errors.slice(0, 4)));
await h.close();
