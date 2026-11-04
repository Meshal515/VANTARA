import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

// UI validation on actual work-looks.js + anime.css from the selected checkout,
// never a deployment or an APK publishing step.
const root = resolve(process.env.VANTARA_UI_ROOT || process.cwd());
const fixture = resolve('tools/repository-compat/work-card-fixture.html');
const evidence = resolve(process.env.VANTARA_WORKCARD_EVIDENCE || 'work-card-evidence');
const mode = process.env.VANTARA_WORKCARD_MODE || 'after';
const playwrightModule = process.env.VANTARA_PLAYWRIGHT_MODULE || 'playwright';
const { chromium } = await import(playwrightModule.startsWith('/') ? pathToFileURL(playwrightModule).href : playwrightModule);
const types = { '.html':'text/html', '.css':'text/css', '.js':'text/javascript', '.svg':'image/svg+xml' };
const server = createServer(async (req, res) => {
  const route = decodeURIComponent((req.url || '/').split('?')[0]);
  if (route === '/__fixture') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(await readFile(fixture));
    return;
  }
  const path = resolve(root, '.' + route);
  if (!(path.startsWith(root + sep))) {
    res.statusCode = 403; res.end('forbidden'); return;
  }
  try {
    const body = await readFile(path);
    res.setHeader('Content-Type', (types[extname(path)] || 'application/octet-stream') + '; charset=utf-8');
    res.end(body);
  } catch { res.statusCode = 404; res.end('not found'); }
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const url = 'http://127.0.0.1:' + server.address().port + '/__fixture';
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
await mkdir(evidence, { recursive:true });
let page;
try {
  page = await browser.newPage({ viewport:{ width:390, height:844 }, deviceScaleFactor:1, reducedMotion:'no-preference' });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(url, { waitUntil:'load' });
  await page.waitForFunction(() => window.fixtureReady === true);
  await page.waitForFunction(() => {
    const l = document.querySelector('.wl-logo-layer');
    return l && !l.hidden;
  }, { timeout:10000 });

  const initial = await page.evaluate(() => {
    const l = document.querySelector('.wl-logo-layer');
    const enter = l.querySelector('.wl-logo-entry');
    const image = l.querySelector('.wl-logo-white img');
    return { x:enter?.getBoundingClientRect().x ?? null,
      right:enter?.getBoundingClientRect().right ?? null,
      viewport:innerWidth, running:l.dataset.running, ready:l.dataset.ready,
      entered:l.dataset.entered, filter:getComputedStyle(image).filter };
  });
  await page.screenshot({ path:resolve(evidence, mode + '-initial.png') });

  if (mode === 'after') {
    assert.equal(initial.ready, 'true', 'validated image must have a ready state');
    assert.ok(initial.x >= initial.viewport - 2,
      'first visible logo entrance frame must start beyond the right edge');
    assert.equal(initial.filter, 'none', 'right-hand logo must keep its original colors');
    assert.equal(initial.running, 'false', 'marquee must pause until the entrance ends');
  } else {
    assert.ok(initial.x === null, 'baseline has no offscreen entrance');
    assert.notEqual(initial.filter, 'none', 'baseline forces the logo to white');
  }

  if (mode === 'after') {
    await page.waitForFunction(() => document.querySelector('.wl-logo-layer')?.dataset.entered === 'true');
  } else {
    await page.waitForTimeout(1500);
  }
  await page.screenshot({ path:resolve(evidence, mode + '-settled.png') });
  // GitHub Actions artifact storage can be full. Emit a low-bandwidth screenshot
  // into this private QA job log for visual inspection without external uploads.
  const auditJpeg = await page.screenshot({ type:'jpeg', quality:68 });
  if (process.env.VANTARA_WORKCARD_LOG_IMAGES === 'true') {
    process.stdout.write('WORKCARD_JPEG_' + mode.toUpperCase() + '=' + auditJpeg.toString('base64') + '\n');
  }
  await page.evaluate(() => { window.savedLogo = document.querySelector('.wl-logo-layer'); });
  await page.evaluate(() => window.repaint(10));
  await page.screenshot({ path:resolve(evidence, mode + '-after-repaint.png') });

  const afterRepaint = await page.evaluate(() => {
    const layer = document.querySelector('.wl-logo-layer');
    const btn = document.querySelector('.wl-big');
    btn?.click();
    return { sameLogo:layer === window.savedLogo,
      running:layer?.dataset.running ?? null, entered:layer?.dataset.entered ?? null,
      label:btn?.textContent ?? null, played:window.played };
  });
  if (mode === 'after') {
    assert.equal(afterRepaint.sameLogo, true, 'metadata updates must not replace the moving logo');
    assert.equal(afterRepaint.entered, 'true');
    assert.equal(afterRepaint.played, 10, 'the user-chosen last started episode must be played');
  } else {
    assert.equal(afterRepaint.sameLogo, false, 'baseline used to reset the moving logo');
  }
  assert.deepEqual(errors, [], 'browser console has no uncaught errors');
  const result = { mode, initial, afterRepaint, screenshots:['initial','settled','after-repaint'].map(s => mode + '-' + s + '.png') };
  await writeFile(resolve(evidence, mode + '-results.json'), JSON.stringify(result, null, 2));
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
} finally {
  await page?.close();
  await browser.close();
  await new Promise((done) => server.close(done));
}
