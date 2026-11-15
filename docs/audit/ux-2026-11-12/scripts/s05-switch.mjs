// Section switching: does coming back to a section re-request data / images? Does it keep scroll?
import { launch, snap, sleep, instrument } from './harness.mjs';
const out = process.env.VANTARA_SHOTS ?? 'audit-shots';
const h = await launch({ section: 'anime' });
const { page, log } = h;
await sleep(9000); // let warm-up of all sections finish
await instrument(page);
const pick = async (id) => {
  await page.locator('[data-act="toggleSections"]:visible').first().click();
  await sleep(450);
  await page.locator(`[data-act="pickSection"][data-arg="${id}"]:visible`).first().click();
};
await page.evaluate(() => scrollTo(0, 1400)); await sleep(800);
const mark = () => log.requests.length;
let m = mark();
await pick('cinema'); await sleep(4000);
console.log('->cinema', JSON.stringify(await snap(page)), 'new external requests', log.requests.length - m, JSON.stringify(log.requests.slice(m, m + 6).map((r) => r.u.slice(0, 90))));
await page.evaluate(() => scrollTo(0, 2000)); await sleep(600);
m = mark();
await pick('anime'); await sleep(4000);
console.log('->anime', JSON.stringify(await snap(page)), 'new external requests', log.requests.length - m, JSON.stringify(log.requests.slice(m, m + 6).map((r) => r.u.slice(0, 90))));
m = mark();
await pick('cinema'); await sleep(4000);
console.log('->cinema again', JSON.stringify(await snap(page)), 'new', log.requests.length - m);
m = mark();
await pick('manga'); await sleep(4000);
console.log('->manga', JSON.stringify(await snap(page)), 'new', log.requests.length - m);
// work round trip within anime home
await pick('anime'); await sleep(3000);
await page.evaluate(() => scrollTo(0, 1200)); await sleep(700);
m = mark();
const y0 = (await snap(page)).y;
const clicked = await page.evaluate(() => { const n = document.elementFromPoint(innerWidth / 2, innerHeight / 2)?.closest('button,[role=button]'); n?.click(); return n?.className?.slice?.(0, 60); });
await sleep(3000);
await page.evaluate(() => window.__shell.handleBack()); await sleep(1500);
console.log('anime home work round trip from', y0, 'clicked', clicked, JSON.stringify(await snap(page)), 'new requests', log.requests.length - m);
const perf = await page.evaluate(() => ({ cls: window.__cls.filter((x) => !x.recent).reduce((a, b) => a + b.v, 0).toFixed(3), shifts: window.__cls.filter((x) => x.v > 0.01), long: window.__long.length, longMax: Math.max(0, ...window.__long.map((x) => x.d)) }));
console.log('perf', JSON.stringify(perf), 'errors', JSON.stringify(log.errors.slice(0, 3)));
await h.close();
