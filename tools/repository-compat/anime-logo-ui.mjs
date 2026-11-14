#!/usr/bin/env node
/**
 * Chromium proof for the anime floating-card logo. Uses original synthetic SVG
 * fixtures; --live-providers additionally checks public Metahub URLs in-browser.
 * --keep-browser leaves the verified session open and prints its Playwright websocket.
 * Example:
 * node tools/repository-compat/anime-logo-ui.mjs --out /tmp/anime-logo-proof \
 *   --playwright-module /path/to/playwright/index.mjs --chromium /usr/bin/chromium --live-providers
 */
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const flags = new Set(), options = {};
for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i];
  if (arg === '--live-providers' || arg === '--keep-browser') flags.add(arg);
  else if (arg.startsWith('--') && process.argv[i + 1]) options[arg.slice(2)] = process.argv[++i];
  else throw Error(`Unknown or incomplete argument: ${arg}`);
}
const root = path.resolve(options.root ?? fileURLToPath(new URL('../../', import.meta.url)));
const web = path.join(root, 'apps/web');
const out = path.resolve(options.out ?? `/tmp/vantara-anime-logo-ui-${Date.now()}`);
await mkdir(out, { recursive: true });
let playwright;
for (const candidate of [options['playwright-module'], 'playwright', 'playwright-core', '/workspace/vantara-browser-qa/node_modules/playwright/index.mjs'].filter(Boolean)) {
  try { playwright = await import(path.isAbsolute(candidate) ? pathToFileURL(candidate).href : candidate); break; } catch {}
}
if (!playwright) throw Error('Playwright unavailable. Pass --playwright-module /path/to/playwright/index.mjs.');
let executablePath = options.chromium ?? process.env.CHROMIUM_PATH;
if (!executablePath) { try { await access('/usr/bin/chromium'); executablePath = '/usr/bin/chromium'; } catch {} }
const svg = body => `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="310" viewBox="0 0 800 310">${body}</svg>`;
const logo = svg('<path d="M40 220 115 65 185 220 260 65 335 220 410 65 485 220 560 65 635 220" fill="none" stroke="#f5c943" stroke-width="28"/><circle cx="710" cy="155" r="48" fill="#ee536c"/>');
const fixtures = {
  '/fixture/logo.svg': logo,
  '/fixture/opaque.svg': svg('<rect width="800" height="310" fill="#bd3848"/>'),
  '/fixture/poster.svg': '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900"><rect width="600" height="900" fill="#263a56"/><path d="M0 500 600 150V900H0Z" fill="#956174"/><circle cx="350" cy="300" r="120" fill="#c69b77"/></svg>',
  '/fixture/banner.svg': '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900"><defs><linearGradient id="b"><stop stop-color="#263a56"/><stop offset="1" stop-color="#0c141f"/></linearGradient></defs><rect width="1600" height="900" fill="url(#b)"/></svg>',
};
const html = `<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/v35/core.css"><link rel="stylesheet" href="/v35/anime.css"><link rel="stylesheet" href="/v35/anime-episodes.css"><style>body{margin:0}.aw{position:relative;min-height:100vh}</style><div class="v35" data-section="anime"><div class="aw" data-style="card"><div class="aw-hero"><div class="aw-bg"><img class="aw-bg-img in" src="/fixture/banner.svg"></div><div class="aw-shade"></div></div><div id="qa-look"></div></div></div><script type="module">
import {renderLook} from '/v35/work-looks.js';import {glyph} from '/v35/icons.js';
const ctx={m:{id:120377,title:'Synthetic anime fixture',poster:'/fixture/poster.svg',description:'Original geometric artwork for browser verification.',recommendations:[],relations:[]},glyph,logo:'/fixture/logo.svg',meta:['ONA','2022','10 حلقات','مكتمل'],genres:['أكشن','دراما'],facts:[],point:{episode:5,resume:true},label:'تابع الحلقة 5',total:10,ratio:.45,left:24,seenRatio:.4,progressText:'شاهدت 4 من 10',characters:[],epTitle:n=>'Episode '+n,epOverview:()=>null,still:()=>({src:'/fixture/banner.svg',still:true}),seen:n=>n<5,minutes:()=> '28 د',play:()=>{},open:()=>{}};
window.draw=(current=5,logo='/fixture/logo.svg',style='card',id=120377)=>{ctx.m.id=id;ctx.point.episode=current;ctx.label='تابع الحلقة '+current;ctx.logo=logo;document.querySelector('.aw').dataset.style=style;renderLook(style,document.querySelector('#qa-look'),ctx,{center:false})};window.draw();window.ready=true;
</script></html>`;
const mime = { '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png' };
const server = createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, 'http://local').pathname;
    if (pathname === '/') { res.setHeader('Content-Type', 'text/html'); return res.end(html); }
    if (fixtures[pathname]) { res.setHeader('Content-Type', 'image/svg+xml'); return res.end(fixtures[pathname]); }
    const target = path.resolve(web, pathname.slice(1));
    if (!target.startsWith(web + path.sep)) throw Error('Path outside fixture root');
    res.setHeader('Content-Type', mime[path.extname(target)] ?? 'application/octet-stream');
    res.end(await readFile(target));
  } catch { res.statusCode = 404; res.end(); }
}).listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const launchOptions = { headless: true, executablePath, args: ['--no-sandbox'] };
const browserServer = flags.has('--keep-browser') ? await playwright.chromium.launchServer(launchOptions) : null;
const browser = browserServer ? await playwright.chromium.connect(browserServer.wsEndpoint()) : await playwright.chromium.launch(launchOptions);
const page = await browser.newPage({ viewport: { width: 1440, height: 1080 }, ignoreHTTPSErrors: true });
const report = { viewports: [], providers: [], failures: [] };
const frames = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const settled = () => page.waitForFunction(() => ['ready', 'invalid-artwork', 'load-error', 'decode-error'].includes(document.querySelector('.wl-logo-layer')?.dataset.logoState));
const snapshot = () => page.evaluate(() => {
  const layer = document.querySelector('.wl-logo-layer'), train = layer.querySelector('.wl-logo-train');
  const animation = train.getAnimations()[0], rect = layer.getBoundingClientRect(), info = document.querySelector('.wl-info').getBoundingClientRect();
  const logos = [...train.querySelectorAll('img')].map(image => image.getBoundingClientRect());
  const css = name => parseFloat(layer.style.getPropertyValue(name));
  return { hidden: layer.hidden, state: layer.dataset.logoState, phase: layer.dataset.phase, x: logos[0].left, right: rect.right,
    width: logos[0].width, gap: css('--wl-logo-gap'), time: animation?.currentTime, duration: animation?.effect.getTiming().duration, playState: animation?.playState,
    visibleLogos: logos.filter(box => box.right > rect.left && box.left < rect.right).map(box => ({ left: box.left, right: box.right })),
    info: { left: info.left, right: info.right }, fadeStart: css('--wl-logo-fade-start'), fadeEnd: css('--wl-logo-fade-end'),
    fadeOutStart: css('--wl-logo-fade-out-start'), fadeOutEnd: css('--wl-logo-fade-out-end') };
});
const seek = async time => {
  await page.evaluate(time => { const animation = document.querySelector('.wl-logo-train').getAnimations()[0]; animation.pause(); animation.currentTime = time; }, time);
  await frames(); return snapshot();
};
const close = (a, b, tolerance = .05) => assert.ok(Math.abs(a - b) <= tolerance, `Expected ${a} within ${tolerance} of ${b}`);
try {
  await page.goto(origin); await page.waitForFunction(() => window.ready); await settled();
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 1080 });
    await page.evaluate(() => { window.draw(5, null); window.draw(5, '/fixture/logo.svg'); });
    await settled(); await frames();
    const entry0 = await seek(0), entry2 = await seek(2000), entry4 = await seek(4000);
    const endA = await seek(entry0.duration - 2000), endB = await seek(entry0.duration - 1000);
    await page.evaluate(() => document.querySelector('.wl-logo-train').getAnimations()[0].finish());
    await page.waitForFunction(() => document.querySelector('.wl-logo-layer').dataset.phase === 'loop');
    const loop1 = await seek(1000), loop2 = await seek(2000), period = loop1.duration;
    const seamBefore = await seek(period - 1); await page.screenshot({ path: path.join(out, `seam-${width}-before.png`) });
    const seamAfter = await seek(period); await page.screenshot({ path: path.join(out, `seam-${width}-after.png`) });
    await seek(0); await page.screenshot({ path: path.join(out, `seam-${width}-zero.png`) });
    assert.equal(seamBefore.visibleLogos.length, seamAfter.visibleLogos.length, 'Loop seam lost a visible logo');
    seamBefore.visibleLogos.forEach((box, i) => close(box.left - seamAfter.visibleLogos[i].left, .012, .005));
    const speeds = { entry: (entry2.x - entry4.x) / 2, end: endA.x - endB.x, loop: loop1.x - loop2.x };
    Object.values(speeds).forEach(speed => close(speed, 12)); close(entry0.x, entry0.right + 8, .1);
    assert.ok(loop1.gap >= 40 && loop1.gap <= 64); assert.ok(loop1.width < 200, 'Logo uses a percentage-width slot');
    await seek(1300);
    await page.evaluate(() => { window.logoNode = document.querySelector('.wl-logo-layer'); window.logoClock = document.querySelector('.wl-logo-train').getAnimations()[0]; window.draw(6); });
    assert.ok(await page.evaluate(() => window.logoNode === document.querySelector('.wl-logo-layer') && window.logoClock === document.querySelector('.wl-logo-train').getAnimations()[0]), 'Progress replaced logo/clock');
    const progress = await snapshot(); assert.ok(progress.time >= 1300 && progress.time < 1450, 'Progress reset the active clock');
    await page.evaluate(() => {
      window.hiddenForTest = true; Object.defineProperty(document, 'hidden', { configurable: true, get: () => window.hiddenForTest });
      document.dispatchEvent(new Event('visibilitychange')); document.querySelector('.wl-logo-train').getAnimations()[0].currentTime = 3500;
    });
    const hiddenA = await snapshot(); await page.waitForTimeout(100); const hiddenB = await snapshot();
    assert.equal(hiddenA.time, hiddenB.time); assert.equal(hiddenB.playState, 'paused');
    await page.evaluate(() => { window.hiddenForTest = false; document.dispatchEvent(new Event('visibilitychange')); });
    await page.waitForTimeout(100); const resumed = await snapshot(); assert.ok(resumed.time > 3500 && resumed.time < 3750, 'Resume caught up hidden wall time');
    await page.emulateMedia({ reducedMotion: 'reduce' }); await page.waitForFunction(() => document.querySelector('.wl-logo-layer').dataset.running === 'false');
    const reducedA = await snapshot(); await page.waitForTimeout(100); const reducedB = await snapshot(); assert.equal(reducedA.time, reducedB.time);
    await page.emulateMedia({ reducedMotion: 'no-preference' }); await seek(1000);
    const mask = await snapshot(); if (width >= 900) assert.ok(mask.fadeStart > mask.info.right, 'Mask overlaps fixed title');
    await page.screenshot({ path: path.join(out, `viewport-${width}.png`) });
    if (width === 1440) {
      await page.screenshot({ path: path.join(out, 'mask-visible.png') });
      await page.locator('.wl-logo-layer').evaluate(node => node.style.opacity = '0'); await page.screenshot({ path: path.join(out, 'mask-hidden.png') });
      await page.locator('.wl-logo-layer').evaluate(node => node.style.removeProperty('opacity'));
    }
    report.viewports.push({ width, speeds, entry0, seamBefore, seamAfter, progress, hiddenA, hiddenB, resumed, reducedA, reducedB, mask });
  }
  // Responsive resize and direction-only changes must preserve visible phase.
  await page.evaluate(() => { window.hiddenForTest = true; document.dispatchEvent(new Event('visibilitychange')); document.querySelector('.wl-logo-train').getAnimations()[0].currentTime = 11000; });
  await frames(); const resizeBefore = await snapshot();
  report.resize = { before: resizeBefore, after: [] };
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 1080 }); await page.waitForTimeout(100); const after = await snapshot();
    // A narrower responsive stride may reveal an extra preceding tile. The
    // previously visible logo must retain its position among the rendered copies.
    assert.ok(after.visibleLogos.some(box => Math.abs(box.left - resizeBefore.visibleLogos[0].left) <= .01), 'Resize shifted the visible logo anchor');
    assert.equal(after.phase, 'loop'); report.resize.after.push({ width, ...after });
  }
  await page.setViewportSize({ width: 1440, height: 1080 }); await page.waitForTimeout(100);
  const directionClock = await snapshot(); await page.evaluate(() => document.documentElement.dir = 'ltr'); await page.waitForTimeout(100);
  const ltr = await snapshot(); assert.ok(ltr.fadeOutEnd < ltr.info.left, 'Direction-only change left mask over title'); assert.equal(ltr.time, directionClock.time);
  report.ltr = ltr;
  await page.evaluate(() => { document.documentElement.dir = 'rtl'; window.hiddenForTest = false; document.dispatchEvent(new Event('visibilitychange')); });
  await page.waitForTimeout(100);
  if (flags.has('--live-providers')) {
    const providers = { MyHero: 'tt5626028', AOT: 'tt2560140', Naruto: 'tt0409591', OnePiece: 'tt0388629', Bleach: 'tt0434665', DeathNote: 'tt0877057', CodeGeass: 'tt0994314', Jujutsu: 'tt12343534', DemonSlayer: 'tt9335498', Frieren: 'tt22248376', Solo: 'tt21209876', Dandadan: 'tt30217403' };
    for (const [name, id] of Object.entries(providers)) {
      const url = `https://images.metahub.space/logo/medium/${id}/img`;
      await page.evaluate(url => window.draw(5, url), url); await settled(); const result = await snapshot();
      assert.equal(result.state, 'ready', `${name} official logo failed`); assert.equal(result.hidden, false); report.providers.push({ name, url, ...result });
    }
  }
  // Each failure starts a new work: an unavailable upgrade to an already decoded
  // image intentionally retains the current image instead of flashing a fallback.
  let workId = 200000;
  for (const source of ['/fixture/opaque.svg', '/fixture/not-found.svg']) {
    await page.evaluate(({ source, id }) => window.draw(5, source, 'card', id), { source, id: ++workId });
    await settled(); await page.waitForTimeout(100); const result = await snapshot();
    assert.equal(result.hidden, true);
    const title = await page.locator('.wl-info').evaluate(node => ({ image: !!node.querySelector('.wl-logo'), text: !!node.querySelector('.wl-name') }));
    if (source.includes('not-found')) assert.equal(title.text, true); else assert.equal(title.image, true);
    report.failures.push({ source, ...result, title });
  }
  const other = createServer((_req, res) => { res.setHeader('Content-Type', 'image/svg+xml'); res.end(logo); }).listen(0, '127.0.0.1');
  await new Promise(resolve => other.once('listening', resolve));
  try {
    const source = `http://127.0.0.1:${other.address().port}/logo.svg`;
    await page.evaluate(({ source, id }) => window.draw(5, source, 'card', id), { source, id: ++workId });
    await settled(); await page.waitForTimeout(100); const result = await snapshot();
    assert.equal(result.hidden, true); const title = await page.locator('.wl-info .wl-logo').evaluate(node => ({ complete: node.complete, width: node.naturalWidth }));
    assert.equal(title.complete, true); assert.equal(title.width, 800); report.failures.push({ source: 'separate origin without ACAO', ...result, title });
  } finally { other.close(); }
  const decoding = await browser.newPage({ viewport: { width: 1440, height: 1080 }, ignoreHTTPSErrors: true });
  try {
    await decoding.addInitScript(() => {
      window.logoDecodes = []; const original = HTMLImageElement.prototype.decode;
      HTMLImageElement.prototype.decode = function () { return original.call(this).then(() => new Promise(resolve => window.logoDecodes.push(resolve))); };
    });
    await decoding.goto(origin); await decoding.waitForFunction(() => window.ready && window.logoDecodes.length);
    const before = await decoding.locator('.wl-logo-layer').evaluate(node => ({ hidden: node.hidden, animations: node.getAnimations({ subtree: true }).length }));
    assert.equal(before.hidden, true); assert.equal(before.animations, 0);
    await decoding.evaluate(() => window.logoDecodes.forEach(resolve => resolve()));
    await decoding.waitForFunction(() => document.querySelector('.wl-logo-layer').dataset.ready === 'true');
    const after = await decoding.locator('.wl-logo-layer').evaluate(node => ({ hidden: node.hidden, firstLeft: node.querySelector('img').getBoundingClientRect().left, viewportRight: innerWidth }));
    assert.equal(after.hidden, false); assert.ok(after.firstLeft >= after.viewportRight, 'Decoded logo flashed mid-screen'); report.decode = { before, after };
  } finally { await decoding.close(); }
  await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ out, viewports: report.viewports.map(({ width, speeds }) => ({ width, speeds })), liveProviders: report.providers.length, safeFailureCases: report.failures.length, directionAndDecode: 'passed' }, null, 2));
  if (browserServer) {
    await page.evaluate(() => window.draw()); await settled();
    const inspection = { origin, websocket: browserServer.wsEndpoint(), viewport: page.viewportSize(), output: out };
    await writeFile(path.join(out, 'browser-session.json'), JSON.stringify(inspection, null, 2));
    console.log(JSON.stringify({ inspection, close: 'Send SIGINT or SIGTERM to finish this verification process.' }, null, 2));
    await new Promise(resolve => { process.once('SIGINT', resolve); process.once('SIGTERM', resolve); });
  }
} finally { await browser.close(); await browserServer?.close(); server.close(); }
