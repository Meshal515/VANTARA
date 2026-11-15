// Faithful cinema board: the real cinema page (Debug) with ONLY the agreed deltas as CSS/DOM overrides.
import { launch, sleep } from '../../../audit/ux-2026-11-12/scripts/harness.mjs';
const out = process.env.OUT ?? 'cboard/';
const REF = 'cinema:tt0903747';
async function open(style, prep) {
  const h = await launch({ section: 'cinema' });
  const { page } = h;
  await page.evaluate((s) => localStorage.setItem('vantara.appearance.v1', JSON.stringify({ style: { cinema: s }, accent: {} })), style);
  await sleep(3000);
  await page.evaluate((r) => window.__shell.openCinemaRef(r, { title: 'Breaking Bad', type: 'series' }), REF);
  await sleep(7000);
  if (prep) await page.evaluate(prep);
  await sleep(1500);
  return h;
}
const art = () => document.querySelector('.page.active .cn-detail-art > .cn-img');
const measure = (y) => { const i = document.querySelector('.page.active .cn-detail-art > .cn-img'); const r = i.getBoundingClientRect(); return { y, t: getComputedStyle(i).transform, top: Math.round(r.top) }; };

// ── الشريط العريض: قبل وبعد (نسبة الإطار = نسبة البنر الطبيعية فلا قص) ──
let h = await open('marquee');
const nat = await h.page.evaluate(() => { const i = document.querySelector('.page.active .cn-detail-art > .cn-img'); const a = i.closest('.cn-detail-art').getBoundingClientRect(); return { w: i.naturalWidth, h: i.naturalHeight, frame: [Math.round(a.width), Math.round(a.height)] }; });
nat.lostPct = +(100 * (1 - (nat.w / nat.h) / (nat.frame[0] / nat.frame[1]))).toFixed(1);
console.log('marquee natural', JSON.stringify(nat));
await h.page.screenshot({ path: out + 'mq-before.png' });
await h.page.addStyleTag({ content: `.v35 .cn-detail[data-style='marquee'] .cn-detail-art{aspect-ratio:${nat.w} / ${nat.h};}` });
await sleep(800);
await h.page.screenshot({ path: out + 'mq-after.png' });
await h.close();

// ── الملصق: الخلفية عند تمرير 480 قبل وبعد ──
const calm = `@keyframes cn-poster-calm{from{transform:translate3d(0,0,0) scale(1)}to{transform:translate3d(0,24px,0) scale(1.03)}}
.v35 .cn-detail[data-style='poster'] .cn-detail-art > .cn-img{animation-name:cn-poster-calm}`;
const drift = {};
for (const [k, css] of [['before', null], ['after', calm]]) {
  h = await open('poster');
  if (css) await h.page.addStyleTag({ content: css });
  await sleep(600);
  drift[k] = [];
  for (const y of [0, 160, 320, 480]) { await h.page.evaluate((y) => scrollTo(0, y), y); await sleep(450); drift[k].push(await h.page.evaluate(measure, y)); }
  await h.page.evaluate(() => scrollTo(0, 0)); await sleep(500);
  await h.page.screenshot({ path: out + `ps-${k}-0.png` });
  await h.page.evaluate(() => scrollTo(0, 200)); await sleep(700);
  await h.page.screenshot({ path: out + `ps-${k}-200.png` });
  await h.close();
}
console.log('poster drift', JSON.stringify(drift));

// ── المسلسل أولًا: نفس صفحة «الأساسي» بمكوّناتها، والمواسم قبل القصة ──
h = await open('current');
const seasonsCss = `.v35 .cn-detail[data-style='series']{--look-r:4px}
.v35 .cn-detail[data-style='series'] .cn-detail-art{aspect-ratio:16/9}
.v35 .cn-detail[data-style='series'] :is(.cn-ep-art,.cn-season-btn,#cinemaPlay){border-radius:var(--look-r)}
.qa-seasons{margin:22px calc(-1*var(--cn-gutter,16px)) 6px;padding:0 var(--cn-gutter,16px);display:flex;gap:12px;overflow-x:auto;scrollbar-width:none}
.qa-seasons::-webkit-scrollbar{display:none}
.qa-season{flex:none;width:150px;background:none;border:0;padding:0;font:inherit;text-align:start;color:var(--text-1)}
.qa-season .art{position:relative;display:block;aspect-ratio:16/9;border-radius:var(--look-r);overflow:hidden;background:var(--surface-1)}
.qa-season .art img{width:100%;height:100%;object-fit:cover;display:block}
.qa-season .bar{position:absolute;inset:auto 0 0 0;height:3px;background:rgba(255,255,255,.18)}
.qa-season .bar i{display:block;height:100%;width:var(--p);background:var(--accent)}
.qa-season b{display:block;font-size:14px;font-weight:800;margin-top:9px}
.qa-season small{display:block;font-size:12px;color:var(--text-3);margin-top:2px}
.qa-season.on .art{outline:2px solid var(--accent);outline-offset:2px}
.qa-head{display:flex;align-items:baseline;justify-content:space-between;margin-top:26px}
.qa-head h2{font-size:20px;font-weight:800;margin:0}
.qa-tools{display:flex;gap:2px;margin-inline-start:auto}.qa-tools button{width:40px;height:40px;display:grid;place-items:center;border:0;background:none;color:var(--text-2)}.qa-tools svg{width:22px;height:22px;stroke:currentColor;fill:none;stroke-width:1.8;stroke-linecap:round}
.v35 .cn-detail[data-style='series'] .cn-eps-head{display:flex;align-items:center;gap:10px}.qa-head span{font-size:12.5px;color:var(--text-3)}`;
await h.page.addStyleTag({ content: seasonsCss });
const built = await h.page.evaluate(async () => {
  const d = document.querySelector('.page.active .cn-detail'); d.dataset.style = 'series';
  const meta = (await (await fetch('https://v3-cinemeta.strem.io/meta/series/tt0903747.json')).json()).meta;
  const by = new Map(); for (const v of meta.videos || []) { if (!v.season) continue; (by.get(v.season) || by.set(v.season, []).get(v.season)).push(v); }
  const progress = { 1: 43 }; // مثال للعرض فقط
  const head = document.createElement('div'); head.className = 'qa-head';
  head.innerHTML = `<h2>المواسم</h2><span>${by.size} مواسم · ${meta.videos.filter((v) => v.season).length} حلقة</span>`;
  const rail = document.createElement('div'); rail.className = 'qa-seasons';
  for (const [n, eps] of [...by].sort((a, b) => a[0] - b[0])) {
    eps.sort((a, b) => a.episode - b.episode);
    const p = progress[n] ?? 0;
    const b = document.createElement('button'); b.className = 'qa-season' + (n === 1 ? ' on' : '');
    b.innerHTML = `<span class="art"><img src="${eps[0].thumbnail}"><span class="bar"><i style="--p:${p}%"></i></span></span><b>الموسم ${n}</b><small>${p === 100 ? 'شاهدته' : p ? Math.round(eps.length * p / 100) + ' من ' + eps.length : eps.length + ' حلقات'}</small>`;
    rail.append(b);
  }
  const play = d.querySelector('#cinemaPlay'); play.after(head, rail);
  const about = d.querySelector('section.cn-about'), eps = d.querySelector('#cinemaEpisodes');
  // البحث والترتيب والتصفية في رأس الحلقات (مطلوبة في كل الأنماط الجديدة؛ السينما الحالية بلا أدوات)
  const tools = document.createElement('div'); tools.className = 'qa-tools';
  tools.innerHTML = '<button aria-label="ابحث في الحلقات"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/></svg></button><button aria-label="الترتيب والتصفية"><svg viewBox="0 0 24 24"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/></svg></button>';
  d.querySelector('.cn-eps-head').append(tools);
  eps.after(about);
  return by.size;
});
console.log('seasons', built);
await sleep(2500);
await h.page.screenshot({ path: out + 'sf-0.png' });
await h.page.evaluate(() => scrollTo(0, 560)); await sleep(800);
await h.page.screenshot({ path: out + 'sf-1.png' });
await h.close();
