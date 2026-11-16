// Deep infinite lists: load several pages, open a work deep down, favorite, Back. Position + loaded count kept?
import { launch, snap, sleep } from './harness.mjs';
const out = process.env.VANTARA_SHOTS ?? 'audit-shots';
const mode = process.argv[2] ?? 'unified-all';
const h = await launch(mode.startsWith('unified') ? { unified: true } : { section: mode.split('-')[0] });
const { page } = h;
await sleep(4500);
let scroller = 'window';
if (mode === 'unified-all') {
  await page.evaluate(() => [...document.querySelectorAll('.uv-door')].find((d) => d.textContent.includes('كل الأعمال'))?.click());
  await sleep(3000);
  scroller = await page.evaluate(() => { const p = document.querySelector('.uv-page'); const s = [...(p?.querySelectorAll('*') ?? [])].find((n) => /(auto|scroll)/.test(getComputedStyle(n).overflowY) && n.scrollHeight > n.clientHeight); if (s) { s.setAttribute('data-qa-scroller', '1'); return 'inner'; } return p ? (getComputedStyle(p).overflowY.match(/auto|scroll/) ? (p.setAttribute('data-qa-scroller', '1'), 'page') : 'window') : 'none'; });
} else if (mode === 'anime-genre') {
  await page.locator('.nav[data-page="discover"]').first().click(); await sleep(2500);
  await page.evaluate(() => [...document.querySelectorAll('.page.active button')].find((b) => /أكشن/.test(b.textContent))?.click());
  await sleep(3000);
} else {
  await page.locator('.nav[data-page="discover"]').first().click(); await sleep(3000);
}
const getY = () => page.evaluate(() => { const s = document.querySelector('[data-qa-scroller]'); return s ? Math.round(s.scrollTop) : Math.round(scrollY); });
const count = () => page.evaluate(() => document.querySelectorAll('.uv-page .uv-po, .page.active .cn-poster, .page.active .an-card, .page.active [class*="grid"] > button').length);
for (let i = 0; i < 14; i++) {
  await page.evaluate(() => { const s = document.querySelector('[data-qa-scroller]'); if (s) s.scrollBy(0, 1100); else scrollBy(0, 1100); });
  await sleep(700);
}
await sleep(2000);
const y0 = await getY(); const n0 = await count();
const target = await page.evaluate(() => { const n = document.elementFromPoint(innerWidth / 2, innerHeight * 0.45); const c = n?.closest('button'); c?.setAttribute('data-qa-t', '1'); return c?.innerText?.split('\n')[0]; });
console.log(mode, 'scroller', scroller, 'before y', y0, 'cards', n0, 'target', target);
await page.screenshot({ path: `${out}/deep-${mode}-1.png` });
await page.locator('[data-qa-t]').click();
await sleep(3500);
console.log(' in work', JSON.stringify(await snap(page)));
await page.evaluate(() => [...document.querySelectorAll('.page.active button')].find((b) => /المفضلة/.test(b.innerText || b.getAttribute('aria-label') || ''))?.click());
await sleep(1200);
await page.evaluate(() => window.__shell.handleBack());
await sleep(2500);
const y1 = await getY(); const n1 = await count();
const t = await page.evaluate(() => { const c = document.querySelector('[data-qa-t]'); return c ? Math.round(c.getBoundingClientRect().top) : null; });
console.log(' after back y', y1, 'cards', n1, 'target top', t, JSON.stringify(await snap(page)));
await page.screenshot({ path: `${out}/deep-${mode}-2.png` });
console.log(' errors', JSON.stringify(h.log.errors.slice(0, 3)));
await h.close();
