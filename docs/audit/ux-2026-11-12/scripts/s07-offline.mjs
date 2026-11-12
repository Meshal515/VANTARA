// Real service worker: install online, then reload offline. Does the PWA boot?
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
const ROOT = process.env.VANTARA_WEB ?? 'apps/web';
const T = { '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.html': 'text/html', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml' };
const server = createServer(async (req, res) => {
  let p = new URL(req.url, 'http://x').pathname; if (p === '/') p = '/index.html';
  try { const b = await readFile(path.join(ROOT, p)); res.setHeader('Content-Type', T[path.extname(p)] ?? 'application/octet-stream'); res.end(b); } catch { res.statusCode = 404; res.end(); }
}).listen(0, '127.0.0.1');
await new Promise((r) => server.once('listening', r));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await context.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(String(e).slice(0, 200)));
page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 200)); });
await context.route((u) => !String(u).startsWith(origin), (r) => r.abort());
await page.goto(origin + '/');
const reg = await page.evaluate(async () => {
  const r = await navigator.serviceWorker.register('/sw.js');
  await new Promise((ok) => { const w = r.installing || r.waiting || r.active; if (w?.state === 'activated') return ok(); w?.addEventListener('statechange', () => w.state === 'activated' && ok()); setTimeout(ok, 20000); });
  return { active: Boolean(r.active), state: r.active?.state };
});
console.log('sw', JSON.stringify(reg));
await page.reload(); await page.waitForTimeout(3000);
console.log('online reload shell mounted:', await page.evaluate(() => Boolean(document.querySelector('.v35, .acct, .accounts, .gate'))), await page.evaluate(() => document.querySelector('#root')?.firstElementChild?.className));
const cached = await page.evaluate(async () => { const n = await caches.keys(); const c = await caches.open(n.find((x) => x.startsWith('vantara-shell'))); return { has: Boolean(await c.match('/v35/source-home.js')), hasShell: Boolean(await c.match('/v35/shell.js')) }; });
console.log('cache has source-home.js', JSON.stringify(cached));
errs.length = 0;
await context.setOffline(true);
await page.reload().catch((e) => console.log('reload err', String(e).slice(0, 120)));
await page.waitForTimeout(4000);
const state = await page.evaluate(() => ({ root: document.querySelector('#root')?.firstElementChild?.className, text: document.body.innerText.slice(0, 120).replace(/\s+/g, ' ') }));
console.log('OFFLINE reload', JSON.stringify(state));
console.log('errors', JSON.stringify(errs.slice(0, 5)));
console.log('offline import shell.js:', await page.evaluate(() => import('/v35/shell.js').then(() => 'ok', (e) => 'FAIL ' + String(e).slice(0, 160))));
console.log('offline import app deps lib/config.js:', await page.evaluate(() => import('/lib/config.js').then(() => 'ok', (e) => 'FAIL ' + String(e))));
await browser.close(); server.close();
