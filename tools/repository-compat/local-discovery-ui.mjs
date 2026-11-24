// VANTARA_CHROMIUM=/usr/bin/chromium VANTARA_PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node tools/repository-compat/local-discovery-ui.mjs
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDiscovery } from '../../apps/desktop/discovery-store.cjs';
import { createSqliteDiscoveryStore } from '../../apps/web/lib/discovery-store.js';

const { chromium } = await import(process.env.VANTARA_PLAYWRIGHT_MODULE || 'playwright');
const root = new URL('../../apps/web/', import.meta.url);
const policy = (await readFile(new URL('local-content-policy.txt', root), 'utf8')).trim();
const dir = await mkdtemp(join(tmpdir(), 'vantara-ui-discovery-'));
const file = join(dir, 'discovery.sqlite');
const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  if (path === '/') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Security-Policy', policy);
    return res.end(`<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8">
      <meta name="viewport" content="width=device-width,initial-scale=1">
      <link rel="stylesheet" href="/v35/core.css">
      <style>#scroll{height:440px;overflow:auto;overflow-anchor:none}.up-card{min-height:160px}</style>
      <main class="v35"><h1>آخر التحديثات</h1><div id="scroll"><div id="feed"></div></div></main></html>`);
  }
  res.setHeader('Content-Type', path.endsWith('.js') ? 'text/javascript' : path.endsWith('.json') ? 'application/json' : 'text/css');
  try { res.end(await readFile(new URL('.' + path, root))); }
  catch { res.statusCode = 404; res.end(); }
}).listen(0, '127.0.0.1');
await new Promise((resolve) => server.once('listening', resolve));

const day = 86_400_000;
const now = Date.now();
const previousVisit = now - 7 * day;
const report = (id, number, publishedAt) => ({
  section: 'manga', kind: 'chapter', work: `ext:${id}`, title: id,
  source: { s: 'test.safe#8929911308540155494', u: `/${id}` }, units: [{ number, publishedAt }],
});
const bridge = (input) => db.request(input);
let db = openDiscovery(file);
let browser;
try {
  const store = createSqliteDiscoveryStore(bridge);
  const saved = Array.from({ length: 30 }, (_, i) => report(`Saved ${i}`, 3, previousVisit - (i + 1000)));
  await store.record(saved, previousVisit);
  db.close();
  db = openDiscovery(file);

  browser = await chromium.launch(process.env.VANTARA_CHROMIUM ? { executablePath: process.env.VANTARA_CHROMIUM } : {});
  const page = await browser.newPage({ viewport: { width: 390, height: 800 }, locale: 'ar' });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const unexpected = [];
  await page.route('**/*', (route) => {
    const url = route.request().url();
    if (new URL(url).origin === origin && !new URL(url).pathname.startsWith('/v1/')) return route.continue();
    unexpected.push(url);
    return route.abort();
  });
  await page.exposeFunction('__testSQLite', bridge);
  await page.addInitScript(() => {
    window.VantaraDesktop = { channel: 'local', platform: 'windows', localDiscovery: (query) => window.__testSQLite(query) };
  });
  await page.goto(origin);
  await page.evaluate(async () => {
    const { mountTimeline } = await import('/v35/updates-view.js');
    const el = (tag, css, text) => Object.assign(document.createElement(tag), { className: css ?? '', textContent: text ?? '' });
    mountTimeline(document.querySelector('#feed'), { section: 'manga', el, empty: () => el('p'), open: () => {} });
  });
  await page.getByText('Saved 29', { exact: true }).waitFor();
  const before = await page.evaluate(() => {
    const scroller = document.querySelector('#scroll');
    scroller.scrollTop = 660;
    const top = scroller.getBoundingClientRect().top;
    window.__card = [...document.querySelectorAll('.up-card')].find((card) => card.getBoundingClientRect().bottom > top);
    return window.__card.getBoundingClientRect().top;
  });
  await store.record([
    report('Published during absence', 1, now - 3 * day),
    report('Saved 0', 4),
  ], now);
  const refresh = page.getByRole('button', { name: 'تحديثات جديدة' });
  await refresh.waitFor();
  assert.equal(await page.locator('.up-card').count(), 30);
  assert.equal(await page.evaluate(() => window.__card.getBoundingClientRect().top), before);
  await refresh.evaluate((button) => button.click());
  const recovered = page.locator('.up-card').filter({ has: page.getByText('Published during absence', { exact: true }) });
  await recovered.waitFor({ state: 'attached' });
  assert.match(await recovered.locator('.up-when').innerText(), /قبل/);
  const undated = page.locator('.up-card').filter({ has: page.getByText('Saved 0', { exact: true }) });
  assert.match(await undated.locator('.up-when').innerText(), /^رُصد/);
  assert.ok(Math.abs((await page.evaluate(() => window.__card.getBoundingClientRect().top)) - before) < 1);
  assert.equal(await page.locator('.up-card').count(), 31);
  assert.deepEqual(unexpected, []);
  console.log('SQLite reopen, seven-day catch-up, real scroll anchor, separate dates, and zero VANTARA server requests passed in Chromium.');
} finally {
  await browser?.close();
  db.close();
  server.close();
  await rm(dir, { recursive: true, force: true });
}
