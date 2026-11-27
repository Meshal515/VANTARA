// ورقة السيرفرات تحت تدفق حقيقي: 160 تورنت و40 مباشرًا تصل على دفعات وحالاتها تتبدل وحقائق التسخين تصل، وإصبع يمرّر
// فوق وتحت أثناء ذلك (لمس حقيقي عبر CDP). في كل إطار: موضع كل صف ظاهر داخل المحتوى. «قفزة» = صف على الشاشة تغيّر
// موضعه في المحتوى بين إطارين (لم يحرّكه الإصبع)، و«قص» = موضع التمرير نزل دون حركة إصبع للأعلى.
// node tools/ui-qa/server-sheet-flow.mjs [out.json]   (VANTARA_PLAYWRIGHT_MODULE / VANTARA_CHROMIUM اختياريان)
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = process.env.VANTARA_PLAYWRIGHT_MODULE ? await import(process.env.VANTARA_PLAYWRIGHT_MODULE) : require('playwright');
const WEB = fileURLToPath(new URL('../../apps/web', import.meta.url));
const TYPES = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.svg': 'image/svg+xml' };
const out = process.argv[2] ?? null;

const PAGE = `<!doctype html><html lang="ar" dir="rtl" class="v35" data-motion="on"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/v35/core.css"><link rel="stylesheet" href="/v35/server-sheet.css">
<style>html,body{margin:0;height:100%;background:var(--bg)} #sheet{position:fixed;inset:0;display:flex;flex-direction:column}</style>
</head><body class="v35"><section id="sheet"></section>
<script type="module">
import { createServerSheet } from '/v35/server-sheet.js';
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
const TORR = 'addon|https://torrentio.strem.fun|com.stremio.torrentio.addon';
// بذرة ثابتة: النتائج قابلة للتكرار بين النسختين
let seed = 7; const rnd = () => ((seed = (seed * 48271) % 2147483647) / 2147483647);
const qualities = [2160, 1080, 1080, 720, 480];
const torrents = Array.from({ length: 160 }, (_, i) => {
  const q = qualities[Math.floor(rnd() * qualities.length)];
  const s = Math.floor(rnd() ** 3 * 2000);
  const gb = (q === 2160 ? 6 + rnd() * 40 : 0.7 + rnd() * 4).toFixed(1);
  return { id: 't' + i, sourceId: TORR, sourceName: 'Torrentio', quality: q, state: 'READY', runtimeReady: true,
    infoHash: (i.toString(16) + 'abc').padEnd(40, '0'), label: 'Show.S01E01.' + q + 'p.WEB-DL-G' + i + '.mkv\\n👤 ' + s + ' 💾 ' + gb + ' GB ⚙️ Nyaa' };
});
const direct = Array.from({ length: 40 }, (_, i) => ({ id: 'd' + i, sourceId: i % 2 ? 'witanime' : 'okanime', server: 'host' + i,
  label: 'direct-' + i, quality: [1080, 720, 480][i % 3], state: 'RESOLVING' }));
const ui = createServerSheet(document.getElementById('sheet'), { el, title: 'Show', kicker: 'الحلقة 1', onPick() {}, sourceName: (r) => r.sourceId });
window.__ui = ui;
let routes = [], facts = {};
const push = () => {
  ui.update({ routes, facts, settled: false, status: { text: routes.length + ' سيرفر', spin: true } });
  const keys = (sel) => [...document.querySelectorAll(sel + ' > .an-srv-grid > .ss-row')].map((b) => b.title || b.getAttribute('aria-label'));
  const btn = (sel) => { const b = document.querySelector(sel + ' .ss-more-btn'); return b ? (b.hidden ? 'hidden' : b.textContent) : 'none'; };
  (window.__orders ??= []).push({ t: Math.round(performance.now()), direct: keys('.ss-group--direct'), torrent: keys('.ss-group--torrent'), tmore: btn('.ss-group--torrent'), dmore: btn('.ss-group--direct') });
};
push();
// الوصول: دفعات كل 120ms (تورنت أولًا، ثم المباشر قيد الفحص ثم يصلح أو يتعذّر)، وحقائق تسخين تصل لبعض التورنت
window.__feed = async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < torrents.length; i += 8) { routes = [...routes, ...torrents.slice(i, i + 8)]; push(); await wait(120); }
  for (let i = 0; i < direct.length; i += 5) { routes = [...routes, ...direct.slice(i, i + 5)]; push(); await wait(120); }
  for (let i = 0; i < direct.length; i++) {
    const d = direct[i]; const next = i % 4 === 3 ? { ...d, state: 'UNAVAILABLE', reason: 'Cloudflare' } : { ...d, state: 'READY', probed: true, probeMs: 400 + i * 30 };
    routes = routes.map((r) => (r.id === d.id ? next : r)); push(); await wait(60);
  }
  for (let i = 0; i < 30; i += 3) { facts = { ...facts, ['t' + i]: { pieceLength: 2 << 20, seeds: 50 + i, peers: 9, ready: true } }; push(); await wait(150); }
  window.__fed = true;
};
// قياس كل إطار
window.__frames = [];
const scroller = document.querySelector('.an-pick-scroll');
const tick = () => {
  const view = scroller.getBoundingClientRect();
  const rows = {};
  for (const b of document.querySelectorAll('.ss-row')) {
    const r = b.getBoundingClientRect();
    // مرئي فعلًا: محتوى details المغلق يبقى له موضع في getBoundingClientRect (content-visibility) وهو غير مرسوم
    if (r.bottom < view.top || r.top > view.bottom || !r.height || !b.checkVisibility({ visibilityProperty: true, contentVisibilityAuto: true })) continue;
    const key = b.title || b.getAttribute('aria-label');
    rows[key] = Math.round((r.top - view.top + scroller.scrollTop) * 10) / 10;
    (window.__where ??= {})[key] = (b.closest('section, details')?.className ?? '') + ' > ' + b.parentElement.className;
  }
  const blocks = {};
  for (const n of document.querySelectorAll('.an-srv-list > *, .an-srv-group > *, .ss-tools, .ss-info, .an-pick-scroll > *')) {
    const r = n.getBoundingClientRect();
    blocks[(n.className || n.tagName) + '@' + [...n.parentElement.children].indexOf(n)] = [Math.round(r.top - view.top + scroller.scrollTop), Math.round(r.height)];
  }
  window.__frames.push({ t: performance.now(), y: scroller.scrollTop, max: scroller.scrollHeight - scroller.clientHeight, rows, blocks });
  if (!window.__stop) requestAnimationFrame(tick);
};
requestAnimationFrame(tick);
</script></body></html>`;

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(PAGE); }
  try {
    const file = path.join(WEB, path.normalize(url.pathname));
    if (!file.startsWith(WEB)) throw new Error('outside');
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' }); res.end(body);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch(process.env.VANTARA_CHROMIUM ? { executablePath: process.env.VANTARA_CHROMIUM } : {});
const context = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(base);
await page.waitForFunction(() => window.__ui);
const cdp = await context.newCDPSession(page);
const box = await page.locator('.an-pick-scroll').boundingBox();
// إصبع حقيقي: سحب للأسفل والأعلى، متكرر طوال التدفق
// لمس حقيقي: بدء ثم حركات كل 16ms ثم رفع (السرعة الأخيرة تُطلق انزلاق Chromium نفسه). dy سالب = سحب للأعلى = تمرير للأسفل
const gesture = async (dy, ms = 260) => {
  const x = box.x + box.width / 2, y0 = box.y + box.height * (dy < 0 ? 0.75 : 0.25);
  const steps = Math.max(2, Math.round(ms / 16));
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: y0 }] });
  for (let i = 1; i <= steps; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y0 + (dy * i) / steps }] }); await new Promise((r) => setTimeout(r, 16)); }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await new Promise((r) => setTimeout(r, 450));
};
const gestures = [];
let opened = 0;
await page.evaluate(() => { void window.__feed(); });
const t0 = Date.now();
while (!(await page.evaluate(() => window.__fed)) && Date.now() - t0 < 30000) {
  // للأسفل بقوة حتى آخر الورقة (حيث تظهر «قيد الفحص» و«غير متاح» وتختفي)، ثم رجوع، ثم «عرض N» يُفتح أثناء التدفق
  for (const dy of [-500, -520, -540]) { gestures.push({ at: await page.evaluate(() => performance.now()), dy }); await gesture(dy); }
  // «عرض N» في التورنت يُفتح بلمسة حقيقية أثناء التدفق (القديم: summary في details)
  if (gestures.length === 3 && !opened) {
    const more = page.locator('.ss-group--torrent .ss-more-btn:not([hidden]), .ss-group--torrent .an-srv-more summary').first();
    await more.scrollIntoViewIfNeeded(); await more.tap(); opened = await page.evaluate(() => document.querySelectorAll('.ss-group--torrent .ss-more-grid .ss-row, .ss-group--torrent details[open] .ss-row').length);
  }
}
await page.waitForTimeout(600);
const frames = await page.evaluate(() => { window.__stop = true; return window.__frames; });
const where = await page.evaluate(() => window.__where);
const orders = await page.evaluate(() => window.__orders);
const moved = [];
for (let i = 1; i < orders.length; i++) for (const k of ['direct', 'torrent']) {
  const a = orders[i - 1][k], b = orders[i][k];
  const keep = a.filter((x) => b.includes(x)), stay = b.filter((x) => a.includes(x));
  if (keep.join() !== stay.join() || a.some((x) => !b.includes(x))) moved.push({ t: orders[i].t, k, before: a, after: b });
}
if (process.env.ORDERS) console.error(JSON.stringify(moved.slice(0, 4), null, 1));
if (process.env.DIRECT) for (const o of orders) if (o.t > 3800 && o.t < 4600) console.error(o.t, o.direct.join(' '));
if (process.env.MORE) { let last = ''; for (const o of orders) { const k = o.tmore + ' | ' + o.dmore; if (k !== last) { console.error(o.t, k); last = k; } } }
if (process.env.BLOCKS) {
  const firstJump = frames.findIndex((f, i) => i && Object.entries(f.rows).some(([k, y]) => frames[i - 1].rows[k] != null && Math.abs(y - frames[i - 1].rows[k]) > 1));
  const a = frames[firstJump - 1].blocks, b = frames[firstJump].blocks;
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) console.error(k, a[k], '->', b[k]);
}

// القفزات: صف ظاهر في إطارين متتاليين تغيّر موضعه في المحتوى
const jumps = [];
let clamps = 0, clampPx = 0;
for (let i = 1; i < frames.length; i++) {
  const a = frames[i - 1], b = frames[i];
  for (const [key, y] of Object.entries(b.rows)) {
    const prev = a.rows[key];
    if (prev != null && Math.abs(y - prev) > 1) jumps.push({ t: Math.round(b.t), key, dy: Math.round(y - prev) });
  }
  // قص: التمرير نزل لأن أقصاه قصُر (ليس سحبًا للأعلى): الموضع السابق صار فوق الأقصى الجديد
  if (b.y < a.y - 1 && a.y > b.max + 0.5) { clamps++; clampPx = Math.max(clampPx, Math.round(a.y - b.y)); }
}
const framesWithJump = new Set(jumps.map((j) => j.t)).size;
const report = {
  frames: frames.length, gestures: gestures.length, errors, extraRowsOpened: opened,
  jumps: jumps.length, framesWithJump, maxJumpPx: jumps.reduce((m, j) => Math.max(m, Math.abs(j.dy)), 0),
  clamps, maxClampPx: clampPx, where: Object.fromEntries([...new Set(jumps.map((j) => j.key))].map((k) => [k, where[k]])), scrollRange: [Math.round(Math.min(...frames.map((f) => f.y))), Math.round(Math.max(...frames.map((f) => f.y)))], rowsOnScreen: Math.round(frames.reduce((n, f) => n + Object.keys(f.rows).length, 0) / frames.length), sample: jumps.slice(0, 8),
};
console.log(JSON.stringify(report, null, 2));
if (out) await writeFile(out, JSON.stringify({ report, jumps }, null, 2));
await browser.close(); server.close();
process.exitCode = errors.length || jumps.length || clamps ? 1 : 0;
