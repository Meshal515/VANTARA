// يعرض نسخة DOM من الجهاز محليًا بـCSS التطبيق الحقيقي. الغلاف المخزّن على الجهاز ← غلاف AniList العام نفسه.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
const TYPES = { '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.html': 'text/html' };
export async function openSnap({ root, file, cover, viewport = { width: 393, height: 852 } }) {
  let html = (await readFile(file, 'utf8')).replaceAll('https://localhost/', '/');
  const server = createServer(async (req, res) => {
    const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (u === '/__snap.html') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(html); }
    try { const b = await readFile(path.join(root, u)); res.writeHead(200, { 'content-type': TYPES[path.extname(u)] || 'application/octet-stream' }); res.end(b); }
    catch { res.writeHead(404); res.end(); }
  }).listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const browser = await chromium.launch({ args: ['--no-sandbox'], proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: '127.0.0.1,localhost' } : undefined });
  const context = await browser.newContext({ viewport, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'ar' });
  const page = await context.newPage();
  const coverBytes = cover ? Buffer.from(await (await fetch(cover)).arrayBuffer()) : null;
  await page.route('**/_capacitor_file_/**', async (route) => {
    const main = cover && route.request().url().includes(process.env.SNAP_MAIN || 'd5c3d8de');
    if (main) return route.fulfill({ status: 200, contentType: 'image/png', body: coverBytes });
    return route.fulfill({ status: 404, body: '' });
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/__snap.html`);
  await page.waitForTimeout(2500);
  return { page, close: async () => { await browser.close(); server.close(); } };
}
