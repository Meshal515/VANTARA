// Dock switcher timing: after choosing a section, how soon does a new tap on the switcher open it again?
import { launch, sleep } from './harness.mjs';
const h = await launch({ section: 'anime' });
const { page } = h;
await sleep(5000);
const state = () => page.evaluate(() => {
  const picks = [...document.querySelectorAll('[data-act="pickSection"]')].filter((n) => n.getClientRects().length && getComputedStyle(n).visibility !== 'hidden' && Number(getComputedStyle(n).opacity) > 0.05);
  return { open: picks.length > 0, section: document.querySelector('.v35').dataset.section, toggles: [...document.querySelectorAll('[data-act="toggleSections"]')].map((n) => `${n.id || n.className.split(' ')[0]}:${n.hidden ? 'h' : 'v'}`).join(',') };
});
const toggle = () => page.evaluate(() => { const t = [...document.querySelectorAll('[data-act="toggleSections"]')].find((n) => !n.hidden && n.getClientRects().length && n.id !== 'dockScrim'); t?.click(); return t?.className; });
console.log('initial', JSON.stringify(await state()), 'toggle el', await toggle());
await sleep(500);
console.log('after open', JSON.stringify(await state()));
for (const gap of [100, 250, 400, 700, 1000, 1500]) {
  // ensure open, choose a different section, then tap the switcher again after `gap`
  let s = await state();
  if (!s.open) { await toggle(); await sleep(450); s = await state(); }
  const to = s.section === 'cinema' ? 'anime' : 'cinema';
  await page.evaluate((to) => [...document.querySelectorAll(`[data-act="pickSection"][data-arg="${to}"]`)].find((n) => n.getClientRects().length)?.click(), to);
  await sleep(gap);
  await toggle();
  await sleep(450);
  const after = await state();
  console.log(`picked ${to}, tapped switcher after ${gap}ms -> open=${after.open} section=${after.section}`);
  if (after.open) { await toggle(); await sleep(500); }
}
await h.close();
