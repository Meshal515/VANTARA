// يركّب لقطات المعرض في صفحات مقارنة بعناوين عربية ويصوّرها PNG
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const dir = path.resolve('shots/gallery');
const img = f => `file://${dir}/${f}`;
const page = (title, rows) => `<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><style>
body{margin:0;padding:28px;background:#0b0a10;color:#eee;font-family:'Noto Sans Arabic',system-ui,sans-serif}
h1{font-size:30px;margin:0 0 22px}.row{margin:0 0 30px}.row h2{font-size:22px;margin:0 0 10px;color:#fff}
.row h2 small{font-weight:400;color:#aaa;font-size:15px;margin-inline-start:10px}.pair{display:flex;gap:18px;align-items:flex-start}
figure{margin:0}figcaption{font-size:14px;color:#bbb;margin-bottom:6px}img{display:block;border-radius:8px;border:1px solid #333}
</style><h1>${title}</h1>${rows.join('')}</html>`;
const NAMES = { core: 'المحور', platform: 'المنصة', card: 'البطاقة الطائرة', screen: 'شاشة السينما', episode: 'الحلقة أولًا', page: 'كلاسيكي', gallery: 'المعرض', profile: 'الملف', resume: 'من حيث وقفت', webtoon: 'ويبتوني', current: 'الأساسي', premiere: 'العرض الأول', poster: 'الملصق', marquee: 'الشريط العريض', series: 'المسلسل أولًا', unified: 'النمط الموحد' };
const SEC = { anime: 'الأنمي', cinema: 'السينما', manga: 'المانجا' };
const pair = (label, sub, pc, mob) => `<div class="row"><h2>${label}<small>${sub}</small></h2><div class="pair"><figure><figcaption>كمبيوتر 1366×768</figcaption><img src="${img(pc)}" width="1100"></figure><figure><figcaption>جوال 412×915</figcaption><img src="${img(mob)}" width="276"></figure></div></div>`;
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1460, height: 900 } });
  const out = [];
  const render = async (name, html) => { fs.writeFileSync(`${dir}/${name}.html`, html); await p.goto(`file://${dir}/${name}.html`); await p.waitForTimeout(800); await p.screenshot({ path: `${dir}/${name}.png`, fullPage: true }); out.push(name); };
  for (const [sec, styles] of Object.entries({ anime: ['core', 'platform', 'card', 'screen', 'episode'], cinema: ['current', 'premiere', 'poster', 'marquee', 'series'], manga: ['page', 'gallery', 'profile', 'resume', 'webtoon'] })) {
    const rows = styles.filter(s => fs.existsSync(`${dir}/${sec}-${s}-pc.png`)).map(s => pair(`${SEC[sec]} · ${NAMES[s]}`, 'صفحة العمل', `${sec}-${s}-pc.png`, `${sec}-${s}-mobile.png`));
    if (fs.existsSync(`${dir}/${sec}-unified-pc.png`)) rows.push(pair(`${SEC[sec]} · ${NAMES.unified}`, 'إعداد مستقل', `${sec}-unified-pc.png`, `${sec}-unified-mobile.png`));
    await render(`compare-${sec}`, page(`أنماط ${SEC[sec]}: الكمبيوتر مقابل الجوال`, rows));
  }
  const ab = (sec, w, rail) => `<div class="row"><h2>رئيسية ${SEC[sec]} · ${w}${rail ? ' · الشريط مقفل' : ' · الشريط مفتوح'}</h2><div class="pair"><figure><figcaption>قبل تعديلي (commit 838e4b1)</figcaption><img src="${img(`banner-${sec}-before-${w}${rail ? '-rail' : ''}.png`)}" width="690"></figure><figure><figcaption>الحالي</figcaption><img src="${img(`banner-${sec}-after-${w}${rail ? '-rail' : ''}.png`)}" width="690"></figure></div></div>`;
  for (const sec of ['cinema', 'anime']) await render(`banner-${sec}-compare`, page(`بنر رئيسية ${SEC[sec]}: قبل وبعد`, [ab(sec, 1366, false), ab(sec, 1366, true), ab(sec, 1920, false), ab(sec, 1920, true)]));
  console.log(out.join('\n'));
  await b.close();
})();
