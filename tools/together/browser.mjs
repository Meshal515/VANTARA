/**
 * اختبار متصفح حي لـ«قراءة معًا»: نافذتان (مضيف وصديق) وثالثة لغير مدعو، على خادم
 * Together محلي (wrangler dev على 8787، انظر services/sync-worker/tools/together-e2e.mjs).
 * يحتاج Playwright العام وChromium المثبّت: node tools/together/browser.mjs
 */
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
const require = createRequire('/opt/node22/lib/node_modules/');
const { chromium } = require('playwright');
const { mintIdentityToken } = await import(new URL('../../packages/domain/dist/index.js', import.meta.url).href);
const WEB = new URL('../../apps/web/', import.meta.url).pathname, H = new URL('./', import.meta.url).pathname, OUT = process.env.TOGETHER_SHOTS ?? '/tmp/';
const index = await readFile(join(WEB, 'index.html'), 'utf8');
const head = index.slice(index.indexOf('<head>') + 6, index.indexOf('</head>')).replace(/<script[\s\S]*?<\/script>/g, '');
const types = { '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };
createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x'); const path = decodeURIComponent(u.pathname);
  try {
    if (path === '/__tg') { res.setHeader('content-type', 'text/html'); return res.end(`<!doctype html><html lang="ar" dir="rtl"><head>${head}</head><body><script type="module" src="/__tg/harness.js"></script></body></html>`); }
    const file = path.startsWith('/__tg/') ? join(H, path.slice(6)) : join(WEB, path);
    res.setHeader('content-type', types[extname(file)] ?? 'application/octet-stream'); res.end(await readFile(file));
  } catch { res.statusCode = 404; res.end(); }
}).listen(4173, '127.0.0.1');
const SECRET = process.env.TOGETHER_SECRET ?? 'dev-identity-secret-at-least-32-characters-long';
const U = { ngm: 'bedcf897-a6f0-4730-b757-402b14891ca5', dahmi: '07588797-a471-44d1-99ce-7fb4f188c196', mansour: '9e4b51d9-4ca0-4da2-9b1f-2205e67134ed' };
const people = [{ userId: U.ngm, displayName: 'مشعل', avatarKey: null }, { userId: U.dahmi, displayName: 'دحمي', avatarKey: null }, { userId: U.mansour, displayName: 'منصور', avatarKey: null }];
const results = []; const check = (n, ok, x = '') => { results.push(ok); console.log(`${ok ? '✓' : '✗'} ${n} ${x}`); };
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const open = async (who, extra = {}) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: 'dark' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.error(`[${who}] pageerror`, e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.error(`[${who}]`, m.text()); });
  const token = await mintIdentityToken({ userId: U[who], deviceId: 'dev-' + who }, SECRET);
  const q = new URLSearchParams({ token, me: U[who], people: JSON.stringify(people), source: extra.source ?? 'teamx', ...(extra.card ? { card: JSON.stringify(extra.card) } : {}) });
  await page.goto(`http://localhost:4173/__tg?${q}`);
  await page.waitForFunction(() => window.tg);
  return page;
};
const host = await open('ngm');
await host.click('#invite');
await host.waitForSelector('.tg-person');
await host.screenshot({ path: OUT + '1-picker-empty.png' });
await host.click('.tg-person[data-user="' + U.dahmi + '"]');
await host.click('.tg-mode[data-mode="sync"]');
await host.screenshot({ path: OUT + '2-picker-picked.png' });
check('زر الإرسال يقول «أرسل (1)»', (await host.textContent('.tg-send')).includes('أرسل (1)'));
await host.click('.tg-send');
await host.waitForFunction(() => window.tg.enqueued.length === 1);
const inv = await host.evaluate(() => window.tg.enqueued[0]);
check('عملية together.invite بالمدعو والنوع', inv.k === 'together.invite' && inv.payload.invitees[0] === U.dahmi && inv.payload.mode === 'sync', inv.payload.code);
await host.waitForFunction(() => window.tg.hub.session?.room.status === 'live');
check('المضيف في الغرفة', true);
await host.evaluate(() => { window.tg.move(4); });
await host.waitForTimeout(800);
const card = { code: inv.payload.code, host_id: U.ngm, invitees_json: JSON.stringify([U.dahmi]), mode: 'sync', kind: 'manga', media_json: JSON.stringify(inv.payload.media), created_at: Date.now() };
const friend = await open('dahmi', { card, source: 'mangalek' });
await friend.waitForFunction(() => document.querySelector('.tg-card-status')?.textContent?.includes('يقرؤون'), null, { timeout: 8000 }).catch(() => {});
const status = await friend.textContent('.tg-card-status');
check('البطاقة: النوع والحالة الحية', (await friend.textContent('.tg-card-kind')) === 'قراءة معًا · متزامنة' && status.includes('يقرؤون'), `«${status}»`);
await friend.screenshot({ path: OUT + '3-card.png' });
await friend.click('.tg-enter');
await friend.waitForFunction(() => window.tg.hub.session?.room.status === 'live');
await friend.waitForFunction(() => window.tg.reader.index === 4, null, { timeout: 5000 }).catch(() => {});
check('دحمي يدخل على صفحة المضيف مباشرة (صفحة 5)', (await friend.evaluate(() => window.tg.reader.index)) === 4, String(await friend.evaluate(() => window.tg.reader.index)));
await host.waitForFunction(() => [...document.querySelectorAll('.tg-pop')].some((n) => n.textContent.includes('دحمي دخل')), null, { timeout: 5000 }).catch(() => {});
check('المضيف يرى كبسولة «دحمي دخل» أعلى الشاشة', await host.evaluate(() => [...document.querySelectorAll('.tg-pop')].some((n) => n.textContent.includes('دحمي دخل'))));
await host.waitForSelector('#strip .tg-face');
check('أفاتاران في الشريط', (await host.$$('#strip .tg-face')).length === 2);
await host.screenshot({ path: OUT + '4-strip.png', clip: { x: 0, y: 0, width: 390, height: 120 } });
// المضيف يقلّب: دحمي يتبعه
for (let i = 0; i < 3; i++) { await host.click('#next'); await host.waitForTimeout(120); }
const t0 = Date.now();
await friend.waitForFunction(() => window.tg.reader.index === 7, null, { timeout: 5000 }).catch(() => {});
check('المضيف قلّب 3 صفحات ودحمي تبعه', (await friend.evaluate(() => window.tg.reader.index)) === 7, `بعد ${Date.now() - t0}ms`);
// دحمي يقلّب وحده في المتزامن: لا يحرّك المضيف
await friend.click('#next'); await host.waitForTimeout(700);
check('غير المضيف لا يحرّك الغرفة', (await host.evaluate(() => window.tg.reader.index)) === 7);
// لوحة الغرفة
await host.click('#strip');
await host.waitForSelector('.tg-row');
await host.waitForTimeout(1200);
const rows = await host.$$eval('.tg-row', (rs) => rs.map((r) => r.textContent));
check('اللوحة: صفحة وفصل وسيرفر كل شخص', rows.some((t) => t.includes('mangalek') && t.includes('الفصل 110')), JSON.stringify(rows));
await host.screenshot({ path: OUT + '5-panel.png' });
// تحويلها منفصلة: دحمي يقلّب وحده والمضيف يراه في اللوحة
await host.click('.tg-switch');
await friend.waitForFunction(() => window.tg.hub.session?.room.info?.mode === 'free');
for (let i = 0; i < 5; i++) { await friend.click('#next'); await friend.waitForTimeout(80); }
await host.waitForTimeout(2200);
const freeRows = await host.$$eval('.tg-row', (rs) => rs.map((r) => r.textContent));
check('منفصلة: المضيف يرى دحمي في صفحة 14 وهو باقٍ في 8', freeRows.some((t) => t.includes('صفحة 14')) && (await host.evaluate(() => window.tg.reader.index)) === 7, JSON.stringify(freeRows));
await host.screenshot({ path: OUT + '6-panel-free.png' });
// غير المدعو
const stranger = await open('mansour', { card: { ...card } });
await stranger.click('.tg-enter');
await stranger.waitForFunction(() => window.tg.toasts.length > 0, null, { timeout: 6000 }).catch(() => {});
check('منصور (غير مدعو) لا يدخل', (await stranger.evaluate(() => window.tg.toasts)).includes('هالغرفة لأشخاص محددين'), JSON.stringify(await stranger.evaluate(() => window.tg.toasts)));
await browser.close();
console.log(`\n${results.filter(Boolean).length}/${results.length} نجح`);
process.exit(results.every(Boolean) ? 0 : 1);
