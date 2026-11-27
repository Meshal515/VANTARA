// ورقة السيرفرات: تثبيت ما على الشاشة حين يصل صف فوقه وحجز الارتفاع يتغير في التحديث نفسه.
// holdHeight كان يكتب min-height على .an-srv-list، وهي أصل كل الصفوف؛ تغيير خاصية ارتفاع على أصل العنصر المثبِّت يوقف
// تثبيت التمرير (scroll anchoring) في Chromium لذلك التخطيط، فيتحرك ما على الشاشة بارتفاع ما أُضيف فوقه («تطلعني لفوق»).
// السيناريو: قسم «قيد الفحص» في الأسفل يختفي والإصبع قريب من الآخر (يُحجز الارتفاع)، ثم يصل تورنت 4K فوق الصف الظاهر.
// node tools/ui-qa/server-sheet-anchor.mjs  → يطبع إزاحة الصف الظاهر؛ يفشل إن تجاوزت 1px
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = process.env.VANTARA_PLAYWRIGHT_MODULE ? await import(process.env.VANTARA_PLAYWRIGHT_MODULE) : require('playwright');
const WEB = fileURLToPath(new URL('../../apps/web', import.meta.url));
const PAGE = `<!doctype html><html lang="ar" dir="rtl" class="v35"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/v35/core.css"><link rel="stylesheet" href="/v35/server-sheet.css">
<style>html,body{margin:0;height:100%;background:var(--bg)} #sheet{position:fixed;inset:0;display:flex;flex-direction:column}</style></head>
<body class="v35"><section id="sheet"></section><script type="module">
import { createServerSheet } from '/v35/server-sheet.js';
const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c; if (x != null) n.textContent = x; return n; };
const T = 'addon|https://torrentio.strem.fun|com.stremio.torrentio.addon';
const tor = (i, q = 1080) => ({ id: 't' + i, sourceId: T, sourceName: 'Torrentio', quality: q, state: 'READY', runtimeReady: true, infoHash: String(i).padEnd(40, '0'), label: 'Show.S01E01.' + q + 'p.WEB-G' + i + '.mkv\\n👤 ' + (900 - i) + ' 💾 1.2 GB ⚙️ Nyaa' });
const dir = (i, state) => ({ id: 'd' + i, sourceId: 'witanime', server: 'h' + i, label: 'd' + i, quality: 720, state, ...(state === 'READY' ? { probed: true, probeMs: 400 } : {}) });
window.__ui = createServerSheet(document.getElementById('sheet'), { el, title: 'Show', onPick() {} });
window.__tor = tor; window.__dir = dir;
</script></body></html>`;
const server = createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(PAGE); }
  try {
    const f = path.join(WEB, path.normalize(u.pathname));
    if (!f.startsWith(WEB)) throw new Error('outside');
    const body = await readFile(f);
    res.writeHead(200, { 'content-type': f.endsWith('.css') ? 'text/css' : 'text/javascript' }); res.end(body);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch(process.env.VANTARA_CHROMIUM ? { executablePath: process.env.VANTARA_CHROMIUM } : {});
const page = await (await browser.newContext({ viewport: { width: 412, height: 800 }, isMobile: true, hasTouch: true })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(`http://127.0.0.1:${server.address().port}/`);
await page.waitForFunction(() => window.__ui, { timeout: 10_000 });
const out = await page.evaluate(async () => {
  const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const sc = __ui.scroll;
  const torrents = Array.from({ length: 10 }, (_, i) => __tor(i));
  const ready = Array.from({ length: 30 }, (_, i) => __dir(i, 'READY'));
  const pending = Array.from({ length: 20 }, (_, i) => __dir(100 + i, 'RESOLVING'));
  // الصف الظاهر: صف مباشر في منتصف الشاشة، وكل قسم التورنت فوق الشاشة
  const watch = async (routes, label) => {
    const v = sc.getBoundingClientRect();
    const [row, r0] = [...sc.querySelectorAll('.ss-group--direct .ss-row')].filter((b) => b.checkVisibility()).map((b) => [b, b.getBoundingClientRect()]).filter(([, r]) => r.top > v.top && r.bottom < v.bottom).at(-1);
    const hold0 = [document.querySelector('.an-srv-list').style.minHeight, document.querySelector('.ss-hold')?.style.height ?? null];
    const m0 = [Math.round(sc.scrollTop), Math.round(sc.scrollHeight), Math.round(document.querySelector('.an-srv-list').getBoundingClientRect().height)];
    __ui.update({ routes, settled: false, status: { text: label } });
    const deadline = performance.now() + 1_000;
    while (sc.querySelector('.an-srv-status span').textContent !== label && performance.now() < deadline) await frame();
    await frame();
    if (sc.querySelector('.an-srv-status span').textContent !== label) throw Error('لم يُرسم التحديث: ' + label);
    window.__m = [m0, [Math.round(sc.scrollTop), Math.round(sc.scrollHeight), Math.round(document.querySelector('.an-srv-list').getBoundingClientRect().height)]];
    const shift = Math.round(row.getBoundingClientRect().top - r0.top);
    return { label, shift, m: window.__m, hold: [hold0, [document.querySelector('.an-srv-list').style.minHeight, document.querySelector('.ss-hold')?.style.height ?? null]] };
  };
  const results = [];
  // 1) ضابط: تورنت 4K يصل فوق الشاشة، والحجز لا يتغير
  __ui.update({ routes: [...torrents, ...ready], settled: false, status: { text: '' } }); await frame();
  // «عرض N من الروابط الإضافية» مفتوح: قائمة طويلة تحت التورنت
  document.querySelector('.ss-group--direct .ss-more-btn')?.click(); await frame();
  sc.scrollTop = 1400; await frame();
  results.push(await watch([__tor(99, 2160), ...torrents, ...ready], 'تورنت فوق الشاشة وحده'));
  // 2) «قيد الفحص» في الأسفل يصغر والإصبع قريب من الآخر (يُحجز الارتفاع)، ثم في التحديث نفسه يصل تورنت فوق الشاشة
  __ui.update({ routes: [__tor(99, 2160), ...torrents, ...ready, ...pending], settled: false, status: { text: '' } }); await frame();
  sc.scrollTop = sc.scrollHeight - sc.clientHeight - 300; await frame();
  results.push(await watch([__tor(99, 2160), __tor(98, 2160), ...torrents, ...ready, ...pending.slice(0, 15).map((r) => ({ ...r, state: 'UNAVAILABLE', reason: 'x' })), ...pending.slice(15)], 'تورنت فوق الشاشة و«قيد الفحص» يصغر تحتها'));
  // 3) أول تقلص بلا حجز سابق: المحتوى في أقصاه والإصبع في آخر الورقة، وسطر «قيد الفحص» في الأسفل يختفي (صارت كلها صالحة
  //    في «الروابط الإضافية» المفتوحة فوقه). كان holdHeight يقيس بعد التقليص فيُقص التمرير في القياس نفسه قبل أن يُحجز
  const routes3 = [__tor(99, 2160), __tor(98, 2160), ...torrents, ...ready];
  const extra = Array.from({ length: 6 }, (_, i) => __dir(200 + i, 'RESOLVING'));
  __ui.update({ routes: [...routes3, ...extra], settled: false, status: { text: '' } }); await frame();
  // «قيد الفحص» مفتوح (لمسه المستخدم): صفوفه في آخر الورقة
  for (const d of sc.querySelectorAll('details')) if (/قيد الفحص/.test(d.querySelector('summary')?.textContent ?? '')) d.open = true;
  await frame();
  __ui.update({ routes: [...routes3, ...extra], settled: false, status: { text: '' } }); await frame();
  sc.scrollTop = sc.scrollHeight; await frame();
  results.push(await watch([...routes3, ...extra.map((r) => ({ ...r, state: 'UNAVAILABLE', reason: 'x' }))], 'أول تقلص في آخر الورقة بلا حجز سابق («قيد الفحص» المفتوح يتعذّر كله)'));
  return results;
});
console.log(JSON.stringify(out));

await browser.close(); server.close();
if (errors.length) { console.error(errors); process.exitCode = 1; }
else process.exitCode = out.some((r) => Math.abs(r.shift) > 1) ? 1 : 0;
