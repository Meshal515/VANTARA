// Cold start on a slow network: user opens unified Discover before data arrives.
import { launch, snap, sleep } from './harness.mjs';
const out = process.env.VANTARA_SHOTS ?? 'audit-shots';
const h = await launch({ unified: true, slowMs: 3500 });
const { page } = h;
await sleep(600);
await page.locator('.nav[data-page="discover"]').first().click();
await sleep(500);
const early = await page.evaluate(() => ({ txt: document.querySelector('#unifiedDiscover')?.innerText.replace(/\s+/g, ' ').slice(0, 200), imgs: document.querySelectorAll('#unifiedDiscover img').length }));
console.log('early', JSON.stringify(early));
await sleep(20000);
const late = await page.evaluate(() => ({ txt: document.querySelector('#unifiedDiscover')?.innerText.replace(/\s+/g, ' ').slice(0, 300), imgs: document.querySelectorAll('#unifiedDiscover img').length, rows: document.querySelectorAll('#unifiedDiscover .us-rank-row').length }));
console.log('after 20s still on page', JSON.stringify(late), JSON.stringify(await snap(page)));
await page.screenshot({ path: `${out}/slow-unified-discover.png` });
// section leak: unified mode, open cinema work, back, then read persisted section
await page.locator('.nav[data-page="home"]').first().click();
await sleep(1500);
console.log('section before', await page.evaluate(() => localStorage.getItem('vantara.section')));
await page.evaluate(() => window.__shell.openCinemaRef('cinema:tt0816692', { title: 'Interstellar', type: 'movie' }));
await sleep(2500);
await page.evaluate(() => window.__shell.handleBack());
await sleep(1500);
console.log('section after cinema work in unified', await page.evaluate(() => ({ stored: localStorage.getItem('vantara.section'), ds: document.querySelector('.v35').dataset.section, html: document.documentElement.dataset.section })));
await h.close();
