// رحلة التنزيلات في القشرة الحقيقية (Chromium، PWA): ⋮ ← «تحميل» ← فصول 1–6 ← «جاري التحميل» ← «على الجهاز»
// ← صفحة العمل المحلي ← حذف فصل ← فشل واستئناف ← إعادة فتح التطبيق بلا إنترنت وقراءة الصفحات من الجهاز.
// المصدر مانجا بديل بنفس جسر الـPWA (VantaraWeb.ExtensionEngine) وصفحات JPEG حقيقية؛ لا يثبت سلوك APK.
// node tools/ui-qa/downloads-e2e.mjs [outDir]
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { boot, launch, sleep } from './rig.mjs';

const out = process.argv[2] ?? 'downloads-e2e';
await mkdir(out, { recursive: true });
const results = [];
const step = async (name, fn) => {
  const t = Date.now();
  try {
    await fn();
    results.push({ name, ok: true, ms: Date.now() - t });
    console.log('✓', name);
  } catch (e) {
    results.push({ name, ok: false, error: String(e?.stack ?? e).slice(0, 800) });
    console.log('✗', name, '\n ', String(e?.message ?? e));
  }
};

const rig = await launch({ section: 'manga', mangaDelay: 50 });
const { page, context, log } = rig;
const shot = (name) => page.screenshot({ path: `${out}/${name}.png` });

// صفحات JPEG حقيقية (تُفك في المتصفح): نلتقطها من عنصر ملوّن
const jpeg = async (color, label) => {
  const p = await context.newPage();
  await p.setViewportSize({ width: 360, height: 520 });
  await p.setContent(`<body style="margin:0"><div id=x style="width:360px;height:520px;background:${color};display:grid;place-items:center;font:700 64px sans-serif;color:#fff">${label}</div></body>`);
  const buf = await p.locator('#x').screenshot({ type: 'jpeg', quality: 70 });
  await p.close();
  return buf;
};
const pages = {};
for (let c = 1; c <= 8; c++) for (let i = 0; i < 4; i++) pages[`${c}-${i}`] = await jpeg(`hsl(${c * 40} 55% 35%)`, `${c}·${i + 1}`);
let failPage = null;
let pageDelay = 450;
const fetched = [];
await page.route('https://pages.fixture/**', async (route) => {
  const key = new URL(route.request().url()).pathname.slice(1).replace('.jpg', '');
  fetched.push(key);
  await sleep(pageDelay);
  if (failPage === key) return route.abort('connectionreset');
  return route.fulfill({ status: 200, contentType: 'image/jpeg', body: pages[key] });
});

const installEngine = () => page.evaluate(() => {
  window.VantaraWeb = window.VantaraWeb ?? {};
  window.VantaraWeb.ExtensionEngine = {
    pages: async ({ chapter }) => ({ pages: Array.from({ length: 4 }, (_, i) => ({ index: i, url: `https://pages.fixture/${chapter.url.split('/').pop()}-${i}.jpg` })) }),
    image: async ({ page: p }) => ({ path: p.url, dataUrl: null }),
    sources: async () => ({ sources: [] }),
  };
});
await installEngine();

await step('⋮ في صفحة المانجا: دائرة «تحميل» أولًا', async () => {
  await page.evaluate(() => window.__open('manga', 1));
  await page.waitForSelector('#detail.active');
  await page.waitForFunction(() => document.querySelector('#detailTools [aria-haspopup]'));
  await sleep(600);
  await page.click('#detailTools [aria-haspopup]');
  await page.waitForSelector('#detailMenu.open');
  await sleep(500);
  const first = await page.$eval('#detailMenu .aw-menu-item', (b) => b.textContent.trim());
  assert.equal(first, 'تحميل');
  await shot('01-menu');
});

await step('ورقة البدء: فصول 1–6 بالتحميل الذكي', async () => {
  await page.click('#detailMenu .aw-menu-item');
  await page.waitForSelector('.dl-start');
  await sleep(350);
  await shot('02-sheet');
  await page.getByRole('button', { name: 'فصول محددة' }).click();
  await page.fill('.dl-range input', '1-6');
  await page.waitForFunction(() => /6 فصول/.test(document.querySelector('.dl-start-go')?.textContent ?? ''));
  await shot('03-sheet-range');
  await page.click('.dl-start-go');
  await page.waitForSelector('.dl-start', { state: 'detached', timeout: 5000 }).catch(() => {});
});

await step('«جاري التحميل»: صفوف بتقدّم حقيقي، والتوازي 2', async () => {
  await page.evaluate(() => window.__shell.showPage?.('library') ?? document.querySelector('[data-act="navTo"][data-arg="library"]')?.click());
  await page.waitForSelector('#library.active');
  await page.click('#library [data-act="openDownloads"]');
  await page.waitForSelector('#downloads.active .dl-row');
  await page.waitForSelector('.dl-row[data-state="downloading"]');
  await sleep(300);
  await shot('04-queue');
  const counts = await page.evaluate(async () => {
    const { downloads } = await import('/lib/downloads/index.js');
    const { manager } = await downloads();
    const l = manager.list();
    return { active: l.filter((i) => ['downloading', 'resolving', 'verifying'].includes(i.state)).length, total: l.length };
  });
  assert.ok(counts.active >= 1 && counts.active <= 2, `active=${counts.active}`);
  assert.equal(counts.total, 6);
});

await step('كلها تكتمل وتنتقل إلى «على الجهاز» بعمل واحد عليه 6 فصول', async () => {
  await page.waitForFunction(() => !document.querySelector('.dl-row'), null, { timeout: 30000 });
  await page.getByRole('tab', { name: /على الجهاز/ }).click();
  await page.waitForSelector('.dl-card');
  await sleep(400);
  const cards = await page.$$eval('.dl-card', (c) => c.map((x) => x.querySelector('.work-meta').textContent));
  assert.deepEqual(cards, ['6 فصول']);
  await shot('05-device');
});

await step('صفحة العمل المحلي تعرض المحفوظ وحده بأرقامه', async () => {
  await page.click('.dl-card');
  await page.waitForSelector('#downloadWork.active .dl-unit-row');
  await sleep(400);
  const nums = await page.$$eval('.dl-unit-num', (n) => n.map((x) => x.textContent));
  assert.deepEqual(nums, ['1', '2', '3', '4', '5', '6']);
  await shot('06-local-work');
});

await step('حذف فصل واحد بتأكيد يحرّر مساحته ويبقي الباقي', async () => {
  await page.click('.dl-unit-row:nth-child(4) .dl-unit-more');
  await page.getByRole('button', { name: 'حذف من الجهاز' }).click();
  await page.waitForSelector('.dl-confirm');
  await shot('07-confirm-delete');
  await page.click('.dl-confirm .btn-danger');
  await page.waitForFunction(() => document.querySelectorAll('.dl-unit-row').length === 5);
  const nums = await page.$$eval('.dl-unit-num', (n) => n.map((x) => x.textContent));
  assert.deepEqual(nums, ['1', '2', '3', '5', '6']);
});

await step('لا تكرار: إعادة طلب 1–6 تنزّل الرابع وحده', async () => {
  const r = await page.evaluate(async () => {
    const { downloads } = await import('/lib/downloads/index.js');
    const { manager } = await downloads();
    const base = manager.list()[0];
    const specs = [1, 2, 3, 4, 5, 6].map((n) => ({ section: 'manga', work: base.work, unit: { key: base.unit.key.replace(/n:\d+$/, `n:${n}`), number: n }, source: { mode: 'smart', sourceId: 'teamx' }, request: { sourceId: 'teamx', chapter: { ...base.request.chapter, url: `/c/${n}`, name: `الفصل ${n}`, chapterNumber: n } } }));
    const { added, skipped } = await manager.enqueue(specs);
    return { added: added.map((i) => i.unit.number), skipped: skipped.length };
  });
  assert.deepEqual(r.added, [4]);
  assert.equal(r.skipped, 5);
});

await step('انقطاع صفحة: فشل بسبب واضح، ثم إعادة المحاولة تكمل دون إعادة الصفحات المحفوظة', async () => {
  failPage = '7-2';
  fetched.length = 0;
  await page.evaluate(async () => {
    const { downloads } = await import('/lib/downloads/index.js');
    const { manager } = await downloads();
    const base = manager.list()[0];
    await manager.enqueue([{ section: 'manga', work: base.work, unit: { key: base.unit.key.replace(/n:\d+$/, 'n:7'), number: 7 }, source: { mode: 'smart', sourceId: 'teamx' }, request: { sourceId: 'teamx', chapter: { ...base.request.chapter, url: '/c/7', chapterNumber: 7 } } }]);
  });
  await page.evaluate(() => document.querySelector('[data-act="goBack"]')?.click());
  await page.evaluate(async () => { const { downloads } = await import('/lib/downloads/index.js'); (await downloads()); });
  await page.click('#library [data-act="openDownloads"]').catch(() => {});
  await page.waitForSelector('#downloads.active');
  await page.getByRole('tab', { name: /جاري التحميل/ }).click().catch(() => {});
  await page.waitForSelector('.dl-row[data-state="reconnecting"]', { timeout: 20000 });
  await shot('08a-reconnecting');
  await page.waitForSelector('.dl-row[data-state="failed"]', { timeout: 60000 });
  await shot('08b-failed');
  const before = fetched.filter((k) => k.startsWith('7-')).length;
  failPage = null;
  fetched.length = 0;
  await page.click('.dl-row[data-state="failed"] .dl-ctl');
  await page.waitForFunction(() => !document.querySelector('.dl-row'), null, { timeout: 30000 });
  const again = fetched.filter((k) => k.startsWith('7-'));
  assert.ok(!again.includes('7-0') || before === 0, `refetched saved pages: ${again}`);
});

await step('ⓘ التفاصيل والإعدادات (التوازي 1–4، Wi-Fi فقط)', async () => {
  await page.getByRole('tab', { name: /على الجهاز/ }).click();
  await page.click('.dl-card');
  await page.waitForSelector('#downloadWork.active .dl-unit-row');
  await page.click('.dl-unit-row:first-child .dl-unit-more');
  await page.getByRole('button', { name: 'التفاصيل' }).click();
  await page.waitForSelector('.dl-info-sheet');
  await sleep(350);
  await shot('09-info');
  const text = await page.textContent('.dl-info-sheet');
  assert.match(text, /سليم ومكتمل/);
  await page.keyboard.press('Escape');
});

await step('إعادة فتح التطبيق بلا إنترنت: «على الجهاز» بأغلفتها، والقارئ يقرأ من الجهاز', async () => {
  // القشرة نفسها من الخادم المحلي (كما من كاش الـPWA أو أصول الـAPK)، وكل شبكة خارجية مقطوعة
  await page.unroute('https://pages.fixture/**');
  await page.addInitScript(() => Object.defineProperty(Navigator.prototype, 'onLine', { get: () => false }));
  await page.reload();
  await boot(page, { section: 'manga' });
  await page.waitForSelector('#home.active');
  await page.evaluate(() => document.querySelector('[data-act="navTo"][data-arg="library"]')?.click());
  await page.waitForSelector('#library.active');
  await page.click('#library [data-act="openDownloads"]');
  await page.waitForSelector('#downloads.active .dl-card img', { timeout: 8000 });
  await sleep(400);
  await shot('10-offline-device');
  const meta = await page.$$eval('.dl-card .work-meta', (m) => m.map((x) => x.textContent));
  assert.deepEqual(meta, ['7 فصول']);
  await page.click('.dl-card');
  await page.waitForSelector('#downloadWork.active .dl-unit-row');
  await sleep(300);
  await shot('11-offline-work');
  await page.click('.dl-unit-row:first-child');
  await page.waitForFunction(() => window.__reader);
  const read = await page.evaluate(async () => {
    const [target] = window.__reader;
    const list = await target.engine.pages(target.row.sourceId, target.row.chapter);
    const sizes = [];
    for (const p of list) {
      const { src } = await target.engine.pageImage(target.row.sourceId, p);
      const img = new Image();
      img.src = src;
      await img.decode();
      sizes.push(`${img.naturalWidth}x${img.naturalHeight}`);
    }
    return { numbers: target.rows.map((r) => r.number), first: target.row.number, sizes, offline: target.offline };
  });
  assert.deepEqual(read.numbers, [1, 2, 3, 4, 5, 6, 7]);
  assert.equal(read.first, 1);
  assert.deepEqual(read.sizes, ['360x520', '360x520', '360x520', '360x520']);
});

await writeFile(`${out}/report.json`, JSON.stringify({ results, errors: log.errors, console: log.console.filter((c) => !/ERR_INTERNET_DISCONNECTED|net::/.test(c)) }, null, 2));
await rig.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed; page errors: ${log.errors.length}`);
if (log.errors.length) console.log(log.errors.slice(0, 5).join('\n---\n'));
process.exit(failed.length ? 1 : 0);
