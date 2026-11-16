// صفحة عمل المانجا بأنماطها الأربعة في Chromium بكود التطبيق نفسه، بلا شبكة (فصول وأغلفة مولّدة):
//   1) «علّم فصول» والزر الجانبي: العلامة تظهر فورًا في القائمة والشبكة والتقدّم، في كل نمط.
//   2) ثبات التحميل: مجموع layout-shift داخل #detail أثناء التحميل البطيء (≈0)، على ثلاثة مقاسات.
// VANTARA_CHROMIUM=<chrome> VANTARA_PLAYWRIGHT_MODULE=<playwright/index.mjs> node tools/repository-compat/manga-work-ui.mjs
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const { chromium } = await import(process.env.VANTARA_PLAYWRIGHT_MODULE || 'playwright');
const root = fileURLToPath(new URL('../../apps/web', import.meta.url));
const LOOKS = ['page', 'gallery', 'profile', 'resume'];
const css = ['styles.css', 'v35/core.css', 'v35.css', 'v35/anime.css', 'v35/server-sheet.css', 'v35/manga.css', 'v35/wide.css'];
const cover = '<svg xmlns="http://www.w3.org/2000/svg" width="460" height="690"><rect width="460" height="690" fill="#5b3a8f"/><circle cx="230" cy="300" r="120" fill="#d9a"/></svg>';
const banner = '<svg xmlns="http://www.w3.org/2000/svg" width="1900" height="400"><rect width="1900" height="400" fill="#2a3550"/></svg>';
const fake = `export async function loadWork(v, { onUpdate = () => {} } = {}) {
  const day = 86400000, now = Date.now();
  const rows = Array.from({ length: 201 }, (_, i) => { const n = 201 - i; return { sourceId: 'teamx', number: n, lang: 'ar', chapter: { name: 'الفصل ' + n, url: '/c/' + n, chapterNumber: n, dateUpload: now - (i * 7 + 3) * day, scanlator: 'Team X' } }; });
  const srcs = [['teamx', 'Team X', 201], ['azora', 'Azora', 198]];
  const editions = srcs.map(([id, label, c]) => ({ sourceId: id, label, manga: { url: '/m' }, chapters: rows.filter((r) => r.number <= c).map((r) => ({ ...r.chapter, sourceId: id })) }));
  // التفاصيل تصل متأخرة: النبذة والمؤلف والحالة والتصنيفات (كما يحدث من المصادر)
  const full = { ...v, description: 'In a world where awakened beings called Hunters must battle deadly monsters to protect humanity, the weakest hunter of all mankind finds himself in a constant struggle for survival.', staff: { edges: [{ role: 'Story', node: { name: { full: 'Writer A' } } }] }, status: 'FINISHED', genres: ['Action', 'Fantasy'], _chapters: rows, chapters: 201, _editions: editions, _sources: srcs.map(([sourceId, label, count]) => ({ sourceId, label, count, lang: 'ar' })), _failedSources: [] };
  await new Promise((r) => setTimeout(r, 1800));
  onUpdate(full, { settled: true });
  return full;
}
async function __realLoadWork(`;
const server = createServer(async (req, res) => {
  try {
    const p = new URL(req.url, 'http://l').pathname;
    if (p === '/__ui') return res.end('<html dir="rtl" lang="ar"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' + css.map((c) => `<link rel="stylesheet" href="/${c}">`).join('') + '<body></body></html>');
    if (p === '/__cover.svg' || p === '/__banner.svg') {
      await new Promise((r) => setTimeout(r, 1200)); // شبكة بطيئة للصور
      res.setHeader('Content-Type', 'image/svg+xml');
      return res.end(p === '/__cover.svg' ? cover : banner);
    }
    let body = await readFile(root + p);
    if (p === '/v35/works.js') body = String(body).replace('export const available = () => engine.isAvailable();', 'export const available = () => true;').replace('export async function loadWork(', fake);
    // إلى أن تعرف إعدادات المظهر أنماط المانجا: النمط المخزّن كما هو
    if (p === '/v35/appearance.js') body = String(body).replace("return WORK_STYLES.some((s) => s.id === id) ? id : 'core';", "return section === 'manga' ? (id ?? 'page') : WORK_STYLES.some((s) => s.id === id) ? id : 'core';");
    res.setHeader('Content-Type', p.endsWith('.js') ? 'text/javascript' : p.endsWith('.css') ? 'text/css' : 'application/octet-stream');
    res.end(body);
  } catch {
    res.statusCode = 404;
    res.end();
  }
}).listen(0, '127.0.0.1');
await new Promise((r) => server.once('listening', r));
const browser = await chromium.launch(process.env.VANTARA_CHROMIUM ? { executablePath: process.env.VANTARA_CHROMIUM } : {});
const errors = [];
const results = [];
const base = `http://127.0.0.1:${server.address().port}`;

async function open(look, [w, h, touch]) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, isMobile: touch, hasTouch: touch, locale: 'ar' });
  // الرئيسية خلف الصفحة تسأل محرّك الإضافات (غير موجود في المتصفح): ليس من صفحة العمل
  page.on('pageerror', (e) => /محرّك الإضافات غير متاح/.test(e.message) || errors.push(`${look}: ${e.message}`));
  await page.goto(`${base}/__ui`);
  await page.evaluate(async ({ look, base }) => {
    localStorage.setItem('vantara.appearance.v1', JSON.stringify({ style: { manga: look }, accent: {}, pureBlack: false }));
    const { chapterKeyOf } = await import('/v35/reading.js');
    const { projectQueue } = await import('/lib/optimistic.js');
    const ref = 'ext:fixture work';
    const read = 142;
    const prog = [{ user_id: 'u1', series_ref: ref, chapter_key: chapterKeyOf(ref, { sourceId: 'teamx', chapter: { chapterNumber: read, url: '/c/' + read } }), ratio: 1, updated_at: Date.now() - 2 * 86400000 }];
    const queue = (window.__queue = []);
    const marked = (k) => { const m = /#n:([\d.]+)$/.exec(k); return m && Number(m[1]) <= read ? { read: 1 } : null; };
    const sync = { user: { userId: 'u1' }, rows: (t, f) => (t === 'progress' ? prog : []).filter(f || (() => true)), row: (t, k) => projectQueue(queue, {}, 'u1')[t]?.[k] ?? (t === 'chapter_marks' ? marked(k) : null), onChange: () => () => {}, enqueue: (kind, payload) => queue.push({ kind, payload }), translation: async () => ({ status: 200, body: { rows: [] } }), latestSnapshots: async () => ({ sources: [] }), presence: async () => [], stats: async () => ({}), insights: async () => ({}), topWorks: async () => [], pendingDevices: async () => [], privacyCapability: async () => ({}), authorizationHeader: null };
    const { mountV35 } = await import('/v35/shell.js');
    window.__shell = mountV35({ sync, mount: (n) => document.body.replaceChildren(n), go: async () => {}, friends: () => [], presence: async () => [], version: 'ui', switchAccount: () => {}, openReader: () => {} }, { page: 'home' });
    window.__work = { id: ref, title: { english: 'Fixture Work' }, coverImage: { large: `${base}/__cover.svg`, extraLarge: `${base}/__cover.svg` }, bannerImage: `${base}/__cover.svg`, wideBanner: `${base}/__banner.svg`, genres: [], status: null, averageScore: 84, startDate: { year: 2018 }, staff: { edges: [] }, description: undefined, chapters: 201, _work: { key: 'fixture work', title: 'Fixture Work', thumbnailUrl: `${base}/__cover.svg`, editions: [{ sourceId: 'teamx', label: 'Team X', manga: { url: '/m' } }] } };
  }, { look, base });
  await page.waitForTimeout(800);
  await page.evaluate(() => {
    window.__shifts = [];
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) if (!e.hadRecentInput && e.sources?.some((s) => s.node?.closest?.('#detail') || s.node?.parentElement?.closest?.('#detail'))) { window.__shifts.push(e.value); (window.__shiftNodes ??= []).push(e.sources.map((s) => `${s.node?.id || s.node?.className || s.node?.nodeName} ${JSON.stringify(s.previousRect)}→${JSON.stringify(s.currentRect)}`).join(' | ')); }
    }).observe({ type: 'layout-shift' });
    window.__shell.openWork(window.__work);
  });
  await page.waitForTimeout(4200);
  return page;
}

for (const look of LOOKS) {
  for (const [dev, vp] of [['phone', [390, 844, true]], ['ipad', [820, 1180, true]], ['pc', [1440, 900, false]]]) {
    const page = await open(look, vp);
    const cls = await page.evaluate(() => window.__shifts.reduce((a, b) => a + b, 0));
    results.push(`${look} ${dev} CLS=${cls.toFixed(4)}`);
    if (process.env.VANTARA_DEBUG && cls) results.push(...(await page.evaluate(() => window.__shiftNodes)));
    assert.ok(cls < 0.01, `${look} ${dev}: layout shift ${cls}`);
    if (dev === 'phone') {
      const r = await page.evaluate(async () => {
        const $ = (s) => document.querySelector(s);
        const num = (n) => (n.querySelector?.('.n')?.textContent ?? n.textContent).trim();
        const cells = () => [...document.querySelectorAll('#chapterPanel .mw-ch, #chapterPanel .mw-cell')];
        const isRead = (n) => cells().some((x) => num(x) === n && x.classList.contains('read'));
        const unread = () => [...document.querySelectorAll('#chapterPanel .mw-ch:not(.read) .mw-ch-open, #chapterPanel .mw-cell:not(.read)')];
        const menu = (label) => { [...$('#detailTools').children].at(-1).click(); [...document.querySelectorAll('#detailMenu .aw-menu-item')].find((b) => b.textContent.includes(label)).click(); };
        const btn = (t) => [...document.querySelectorAll('#markBar .mw-selbtn')].find((x) => x.textContent === t);
        const out = {};
        const first = unread()[0];
        const n1 = num(first);
        const side = first.closest('.mw-ch')?.querySelector('.st');
        if (side) side.click();
        else first.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
        out.side = isRead(n1);
        menu('علّم فصول');
        const u = unread();
        const a = num(u[0]);
        const b = num(u[3]);
        u[0].click();
        unread().find((x) => num(x) === b).click();
        btn('ما بينهما').click();
        btn('مقروء').click();
        out.range = isRead(a) && isRead(b) && !$('#markBar');
        menu('علّم فصول');
        [...document.querySelectorAll('#chapterPanel .mw-ch.read .mw-ch-open, #chapterPanel .mw-cell.read')].find((x) => num(x) === a).click();
        btn('غير مقروء').click();
        out.unmark = !isRead(a);
        out.ops = window.__queue.filter((o) => o.kind.startsWith('chapter.')).map((o) => `${o.kind}:${o.payload.keys?.length ?? 1}:${o.payload.read}`);
        return out;
      });
      assert.deepEqual([r.side, r.range, r.unmark], [true, true, true], `${look}: ${JSON.stringify(r)}`);
      assert.deepEqual(r.ops, ['chapter.mark:1:true', 'chapter.markMany:4:true', 'chapter.markMany:1:false'], look);
      results.push(`${look} marks: side ✓ range ✓ unmark ✓`);
    }
    await page.close();
  }
}
await browser.close();
server.close();
assert.deepEqual(errors, []);
console.log(results.join('\n'));
console.log(`PASS: ${results.length} checks`);
