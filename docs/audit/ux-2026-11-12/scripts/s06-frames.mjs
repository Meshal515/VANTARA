// Frame strip of a section boot: what moves during the first 3 seconds?
import { launch, sleep } from './harness.mjs';
const out = process.env.VANTARA_SHOTS ?? 'audit-shots';
const section = process.argv[2] ?? 'anime';
const h = await launch(section === 'unified' ? { unified: true } : { section });
const { page } = h;
const t0 = Date.now();
const rows = [];
for (let i = 0; i < 14; i++) {
  const s = await page.evaluate(() => {
    const home = document.querySelector('.page.active');
    const kids = [...(home?.querySelectorAll(':scope .home-view:not([hidden]) > *, :scope #allHome > * > *') ?? [])].slice(0, 6).map((n) => `${String(n.className).split(' ')[0]}@${Math.round(n.getBoundingClientRect().top)}h${Math.round(n.getBoundingClientRect().height)}`);
    return kids.join(' | ');
  });
  rows.push(`${Date.now() - t0}ms ${s}`);
  if (i % 3 === 0) await page.screenshot({ path: `${out}/frames-${section}-${i}.png` });
  await sleep(180);
}
console.log(rows.join('\n'));
await h.close();
