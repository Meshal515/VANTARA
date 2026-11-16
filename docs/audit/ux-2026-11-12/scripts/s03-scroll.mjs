// Journey: Discover → deep scroll → open work → add to library/favorite → Back. Does the list keep its place?
import { launch, snap, sleep } from './harness.mjs';
const out = process.env.VANTARA_SHOTS ?? 'audit-shots';
const which = process.argv[2] ?? 'anime';
const opts = which === 'unified' ? { unified: true } : { section: which };
const h = await launch(opts);
const { page } = h;
await sleep(3000);
await page.locator('.nav[data-page="discover"]').first().click();
await sleep(3500);
// deep scroll in steps so infinite lists load
for (let i = 0; i < 8; i++) { await page.mouse.wheel(0, 900); await sleep(450); }
await sleep(1500);
const before = await snap(page);
const target = await page.evaluate(() => {
  const n = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
  const c = n?.closest('button, a, [role="button"], [data-ref], [data-id], .card, .an-card, .cn-card, .uv-po');
  if (!c) return null;
  c.setAttribute('data-qa-target', '1');
  const r = c.getBoundingClientRect();
  return { tag: c.tagName, cls: String(c.className).slice(0, 80), text: c.innerText?.slice(0, 40), top: Math.round(r.top), cards: document.querySelectorAll('.page.active img').length };
});
console.log(which, 'before', JSON.stringify(before), 'target', JSON.stringify(target));
await page.screenshot({ path: `${out}/scroll-${which}-1-list.png` });
await page.locator('[data-qa-target]').click();
await sleep(3500);
const inWork = await snap(page);
console.log(' opened', JSON.stringify(inWork));
// try to add to library / favorite inside the work page
const added = await page.evaluate(() => {
  const btn = [...document.querySelectorAll('.page.active button, .page.active [role="button"]')].find((b) => /أتابعها|المفضلة|مكتبتي|أضف/.test(b.innerText || b.getAttribute('aria-label') || ''));
  if (!btn) return null; btn.click(); return (btn.innerText || btn.getAttribute('aria-label')).slice(0, 30);
});
console.log(' added via', added, 'ops', JSON.stringify(await page.evaluate(() => window.__ops.map((o) => o.kind))));
await sleep(1500);
await page.evaluate(() => window.__shell.handleBack());
for (const t of [50, 300, 900, 2000]) { await sleep(t === 50 ? 50 : t - 50); console.log(` back +${t}ms`, JSON.stringify(await snap(page))); }
await page.screenshot({ path: `${out}/scroll-${which}-2-back.png` });
const after = await page.evaluate(() => { const t = document.querySelector('[data-qa-target]'); return t ? { stillSameNode: true, top: Math.round(t.getBoundingClientRect().top) } : { stillSameNode: false }; });
console.log(' target after back', JSON.stringify(after), 'errors', JSON.stringify(h.log.errors.slice(0, 3)));
await h.close();
