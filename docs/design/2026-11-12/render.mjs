// يصوّر كل .phone في صفحة نموذج: node render.mjs unified.html
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
const WEB = process.env.VANTARA_WEB ?? 'apps/web';
const MOCK = path.dirname(new URL(import.meta.url).pathname);
const T = { '.css': 'text/css', '.html': 'text/html', '.woff2': 'font/woff2', '.js': 'text/javascript', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = createServer(async (req, res) => {
  const p = new URL(req.url, 'http://x').pathname;
  const file = p.startsWith('/mock/') ? path.join(MOCK, p.slice(6)) : path.join(WEB, p);
  try { const b = await readFile(file); res.setHeader('Content-Type', T[path.extname(file)] ?? 'application/octet-stream'); res.end(b); } catch { res.statusCode = 404; res.end(); }
}).listen(0, '127.0.0.1');
await new Promise((r) => server.once('listening', r));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ args: ['--no-sandbox'], proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: '127.0.0.1' } : undefined });
const page = await browser.newPage({ viewport: { width: 1800, height: 1000 }, deviceScaleFactor: 2, ignoreHTTPSErrors: true });
const out = path.join(MOCK, 'out'); await mkdir(out, { recursive: true });
for (const f of process.argv.slice(2)) {
  await page.goto(`${origin}/mock/${f}`, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1500);
  const broken = await page.evaluate(() => [...document.images].filter((i) => !i.naturalWidth).map((i) => i.src.slice(0, 90)));
  if (broken.length) console.log('broken images', broken);
  for (const el of await page.$$('.phone')) {
    const id = await el.getAttribute('id');
    await el.screenshot({ path: path.join(out, `${id}.png`) });
    console.log('shot', id);
  }
}
await browser.close(); server.close();
