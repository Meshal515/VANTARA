// لوحات الفحص الشامل: لكل قسم لوحة لكل نمط (أول شاشة على 1366 و1920 مقفل والجوال، ثم الصفحة كاملة)،
// وجدول القياسات لكل المقاسات. الاستعمال: node compose-full.cjs anime|cinema|manga
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const section = process.argv[2];
const dir = path.resolve(`shots/full/${section}`);
const report = JSON.parse(fs.readFileSync(`${dir}/report.json`, 'utf8'));
const NAMES = { core: 'المحور', platform: 'المنصة', card: 'البطاقة الطائرة', screen: 'شاشة السينما', episode: 'الحلقة أولًا', page: 'كلاسيكي', gallery: 'المعرض', profile: 'الملف', resume: 'من حيث وقفت', webtoon: 'ويبتوني', current: 'الأساسي', premiere: 'العرض الأول', poster: 'الملصق', marquee: 'الشريط العريض', series: 'المسلسل أولًا', unified: 'النمط الموحد' };
const SEC = { anime: 'الأنمي', cinema: 'السينما', manga: 'المانجا' };
const VIEW = { pc1366: '1366 مفتوح', 'pc1366-rail': '1366 مقفل', pc1920: '1920 مفتوح', 'pc1920-rail': '1920 مقفل', 'pc2560-rail': '2560 مقفل', m412: 'جوال 412', m390: 'جوال 390' };
const f = (n) => fs.existsSync(`${dir}/${n}`) ? `file://${dir}/${n}` : null;
const cell = (v) => v === true ? '✓' : v === false ? '✗' : v ?? '—';
const table = (style) => {
  const r = report.styles[style] ?? {};
  const head = '<tr><th>المقاس</th><th>لف أفقي</th><th>قص</th><th>أكبر فراغ</th><th>عرض المحتوى</th><th>التشغيل بأول شاشة</th><th>فصول/حلقات مرسومة</th><th>فيض</th></tr>';
  const rows = Object.entries(VIEW).map(([id, name]) => { const m = r[id]; if (!m) return ''; if (m.error) return `<tr><td>${name}</td><td colspan=7>خطأ: ${m.error}</td></tr>`; return `<tr><td>${name}</td><td class="${m.rows.length ? 'bad' : ''}">${m.rows.length ? m.rows.join('<br>') : '0'}</td><td class="${m.crops.length ? 'bad' : ''}">${m.crops.length ? m.crops.join('<br>') : '0'}</td><td class="${m.maxGap > 260 ? 'bad' : ''}">${m.maxGap}px</td><td>${m.contentPct}%</td><td class="${m.playFirstScreen === false ? 'bad' : ''}">${cell(m.playFirstScreen)}</td><td>${m.units}</td><td class="${m.overflowX ? 'bad' : ''}">${cell(m.overflowX)}</td></tr>`; }).join('');
  const j = r.pc1366 ?? {};
  const s = j.seasonSwitch, e = j.exit;
  const journey = `<p class="j">العمل: ${j.work ?? '—'} · CLS الدخول ${j.enterCls ?? '—'} · تبويبات المواسم ${j.seasonTabs ?? 0}${s ? ` · تبديل الموسم: أضيف ${s.added} وأزيل ${s.removed} عنصرًا، صور ${s.imageRequests}، وعند الرجوع للموسم الأول ${s.backImageRequests} صورة، قفزة تمرير ${s.scrollJump}px` : ''}${e ? ` · الخروج: موضع الرئيسية ${e.homeScrollBefore} ← ${e.homeScrollAfter}` : ''}</p>`;
  return `<table>${head}${rows}</table>${journey}`;
};
const html = (style) => `<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><style>
body{margin:0;padding:24px;background:#0b0a10;color:#eee;font-family:'Noto Sans Arabic',system-ui,sans-serif}h1{font-size:30px;margin:0 0 14px}
.first{display:flex;gap:14px;align-items:flex-start;margin-bottom:16px}figure{margin:0}figcaption{font-size:14px;color:#bbb;margin-bottom:5px}
img{display:block;border-radius:6px;border:1px solid #333}table{border-collapse:collapse;font-size:13px;margin:10px 0;width:100%}
td,th{border:1px solid #333;padding:5px 8px;text-align:right;vertical-align:top}th{background:#16141d}td.bad{color:#ff8a8a;font-weight:700}.j{font-size:13px;color:#ccc}
.full{display:flex;gap:14px;align-items:flex-start}</style>
<h1>${SEC[section]} · ${NAMES[style]}</h1>
<div class="first">${[['pc1366', '1366×768 الشريط مفتوح', 620], ['pc1920-rail', '1920×1080 الشريط مقفل', 620], ['m412', 'جوال 412×915', 190]].map(([id, cap, w]) => f(`${style}-${id}.png`) ? `<figure><figcaption>${cap} · أول شاشة</figcaption><img src="${f(`${style}-${id}.png`)}" width="${w}"></figure>` : '').join('')}</div>
${table(style)}
<div class="full">${[['pc1366', 'الصفحة كاملة 1366', 700], ['pc1920-rail', 'الصفحة كاملة 1920 مقفل', 560], ['m412', 'الصفحة كاملة جوال', 170]].map(([id, cap, w]) => f(`${style}-${id}-full.png`) ? `<figure><figcaption>${cap}</figcaption><img src="${f(`${style}-${id}-full.png`)}" width="${w}"></figure>` : '').join('')}</div></html>`;
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1500, height: 900 } });
  fs.mkdirSync('shots/boards', { recursive: true });
  for (const style of Object.keys(report.styles)) {
    fs.writeFileSync(`${dir}/board-${style}.html`, html(style));
    await p.goto(`file://${dir}/board-${style}.html`); await p.waitForTimeout(1200);
    // سقف الطول: الصفحات الطويلة جدًا (1000+ فصل) تُقص من الأسفل في اللوحة؛ الصورة الكاملة باقية في المجلد
    const h = Math.min(await p.evaluate(() => document.documentElement.scrollHeight), 9000);
    await p.setViewportSize({ width: 1500, height: h }); await p.screenshot({ path: `shots/boards/${section}-${style}.png` });
    await p.setViewportSize({ width: 1500, height: 900 });
    console.log(`shots/boards/${section}-${style}.png`, h);
  }
  await b.close();
})();
