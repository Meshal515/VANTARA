// النمط الموحد فوق صفحتي الأنمي والسينما الحقيقيتين (Debug، المحتوى الموحد مفعّل). طبقة CSS + ترتيب، بلا مكوّنات جديدة سوى الألسنة.
import { launch, sleep } from '../../../audit/ux-2026-11-12/scripts/harness.mjs';
import { readFile } from 'node:fs/promises';
const out = process.env.OUT ?? new URL('./', import.meta.url).pathname;
const css = await readFile(out + 'unified-look.css', 'utf8');

// أقرب صورة متناسقة مع إطار البطل (عرض الشاشة × ارتفاعه الأقصى)، والأعلى دقة عند التساوي؛ لا شيء قريب ← الغلاف
const PICK = `window.__pickArt = (cands, fallback) => {
  const W = innerWidth, H = Math.min(innerWidth * 1.5, 600), target = W / H;
  const ok = cands.filter((c) => c && c.w && c.h);
  const score = (c) => Math.abs(Math.log((c.w / c.h) / target));
  ok.sort((a, b) => score(a) - score(b) || (b.w * b.h) - (a.w * a.h));
  const best = ok[0] && score(ok[0]) < 0.35 ? ok[0] : fallback;
  document.documentElement.style.setProperty('--u-hero', Math.round(Math.min(W * best.h / best.w, 600)) + 'px');
  return best;
};
window.__dims = (src) => new Promise((r) => { const i = new Image(); i.onload = () => r({ src, w: i.naturalWidth, h: i.naturalHeight }); i.onerror = () => r(null); i.src = src; });`;
const TOOLS = '<div class="u-tools"><button class="icon-btn" aria-label="ابحث في الحلقات"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/></svg></button><button class="icon-btn" aria-label="الترتيب والتصفية"><svg viewBox="0 0 24 24"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/></svg></button></div>';
const PLAY = '<svg viewBox="0 0 24 24"><path d="M7 4.5v15l13-7.5z"/></svg>';
async function shoot(name, h, scrollSel) {
  await h.page.evaluate(() => scrollTo(0, 0)); await sleep(700);
  await h.page.screenshot({ path: `${out}${name}-0.png` });
  await h.page.evaluate((s) => { const n = document.querySelector('.page.active ' + s); scrollTo(0, n.getBoundingClientRect().top + scrollY - 64); }, scrollSel); await sleep(900);
  await h.page.screenshot({ path: `${out}${name}-1.png` });
}
// ── الأنمي ──
let h = await launch({ section: 'anime', unified: true, viewport: { width: 390, height: 844 } });
await sleep(3000);
await h.page.evaluate(() => window.__shell.openAnimeRef('anime:154587', { title: 'Frieren' }));
await sleep(8000);
await h.page.addStyleTag({ content: css });
await h.page.evaluate(PICK);
const animeArt = await h.page.evaluate(async () => {
  const cover = document.querySelector('.page.active .aw-cover img'), bg = document.querySelector('.page.active .aw-bg-img');
  const tt = (bg?.currentSrc.match(/tt\d+/) || [])[0];
  const cands = [{ src: cover.currentSrc, w: cover.naturalWidth, h: cover.naturalHeight, kind: 'غلاف AniList' }, { src: bg.currentSrc, w: bg.naturalWidth, h: bg.naturalHeight, kind: 'خلفية' }];
  if (tt) { const p = await __dims(`https://images.metahub.space/poster/large/${tt}/img`); if (p) cands.push({ ...p, kind: 'ملصق' }); }
  const best = __pickArt(cands, cands[0]);
  bg.src = best.src; bg.srcset = ''; bg.style.objectPosition = '50% 0%'; if (best.h > best.w) document.querySelector('.page.active article.aw').classList.add('u-poster');
  return { chosen: best.kind, w: best.w, h: best.h, all: cands.map((c) => `${c.kind} ${c.w}×${c.h}`) };
});
console.log('anime art', JSON.stringify(animeArt));
await h.page.evaluate((PLAY) => {
  const a = document.querySelector('.page.active article.aw'); a.dataset.look = 'unified';
  a.querySelector('.aw-hero').append(Object.assign(document.createElement('i'), { className: 'u-fade' }));
  const still = a.querySelector('.aw-still'), cap = still?.querySelector('.aw-still-cap');
  const go = document.createElement('button'); go.className = 'u-go'; go.onclick = () => still?.click();
  const leaves = [...(cap?.querySelectorAll('*') || [])].filter((n) => !n.children.length).map((n) => n.textContent.trim()).filter(Boolean); const lines = leaves.length ? leaves : ['شاهد الحلقة 1'];
  go.innerHTML = `${PLAY}<span>${lines[0]}</span>${lines[1] ? `<small>· ${lines[1]}</small>` : ''}`;
  a.querySelector('.aw-genres').after(go);
  const prog = document.createElement('div'); prog.className = 'u-progress'; prog.innerHTML = '<span>شاهدت 0 من 28</span><i style="--p:0%"></i><span>24 د للحلقة</span>';
  const about = a.querySelector('.aw-about'); go.after(about);
  const tabs = document.createElement('nav'); tabs.className = 'u-tabs';
  tabs.innerHTML = '<button class="on">الحلقات<small>28</small></button><button>التفاصيل</button><button>مشابه</button>';
  a.querySelector('#animeEpisodes').before(tabs);
  // أدوات الحلقات الحقيقية (البحث، الترتيب والتصفية) تنتقل إلى سطر الألسنة
  const tools = a.querySelector('.aw-eps-tools'); if (tools) { tools.classList.add('u-tools'); tabs.append(tools); }
  // مواسم الأنمي الحقيقية كما هي (an-season): نفس اللسان في الأقسام كلها
  a.querySelectorAll('.an-season').forEach((b) => b.classList.add('u-season'));
}, PLAY);
await sleep(1200);
await shoot('anime', h, '.u-tabs');
await h.close();
// ── السينما ──
h = await launch({ section: 'cinema', unified: true, viewport: { width: 390, height: 844 } });
await sleep(3000);
await h.page.evaluate(() => window.__shell.openCinemaRef('cinema:tt0903747', { title: 'Breaking Bad', type: 'series' }));
await sleep(8000);
await h.page.addStyleTag({ content: css });
await h.page.evaluate(PICK);
const cinemaArt = await h.page.evaluate(async () => {
  const img = document.querySelector('.page.active .cn-detail-art > .cn-img');
  const tt = (img.currentSrc.match(/tt\d+/) || [])[0];
  const cands = [{ src: img.currentSrc, w: img.naturalWidth, h: img.naturalHeight, kind: 'خلفية' }];
  const p = await __dims(`https://images.metahub.space/poster/large/${tt}/img`); if (p) cands.push({ ...p, kind: 'ملصق' });
  const best = __pickArt(cands, p ? { ...p, kind: 'ملصق' } : cands[0]);
  img.src = best.src; img.srcset = ''; img.style.objectPosition = '50% 0%'; if (best.h > best.w) document.querySelector('.page.active .cn-detail').classList.add('u-poster');
  return { chosen: best.kind, w: best.w, h: best.h, all: cands.map((c) => `${c.kind} ${c.w}×${c.h}`) };
});
console.log('cinema art', JSON.stringify(cinemaArt));
await h.page.evaluate(async (TOOLS) => {
  const d = document.querySelector('.page.active .cn-detail'); d.dataset.look = 'unified';
  d.querySelector('.cn-detail-art').append(Object.assign(document.createElement('i'), { className: 'u-fade' }));
  const body = d.querySelector('#cinemaBody'), play = d.querySelector('#cinemaPlay');
  const prog = document.createElement('div'); prog.className = 'u-progress'; prog.innerHTML = '<span>شاهدت 0 من 62</span><i style="--p:0%"></i><span>5 مواسم</span>';
  play.after(d.querySelector('section.cn-about'));
  const eps = d.querySelector('#cinemaEpisodes');
  const tabs = document.createElement('nav'); tabs.className = 'u-tabs';
  tabs.innerHTML = '<button class="on">الحلقات<small>62</small></button><button>التفاصيل</button><button>مشابه</button>';
  eps.before(tabs);
  tabs.insertAdjacentHTML('beforeend', TOOLS);
  // المواسم: لسان مواسم الأنمي نفسه بدل زر «الموسم 1 ⌄» وورقته
  const meta = (await (await fetch('https://v3-cinemeta.strem.io/meta/series/tt0903747.json')).json()).meta;
  const by = new Map(); for (const v of meta.videos || []) if (v.season) (by.get(v.season) || by.set(v.season, []).get(v.season)).push(v);
  const strip = document.createElement('div'); strip.className = 'u-seasons';
  for (const [n, list] of [...by].sort((a, b) => a[0] - b[0])) {
    const y = String(list.map((v) => v.released || v.firstAired).filter(Boolean).sort()[0] || '').slice(0, 4);
    const b = document.createElement('button'); b.className = 'u-season' + (n === 1 ? ' active' : '');
    b.innerHTML = `<b>الموسم ${n}</b><span>${[y, list.length + ' حلقات'].filter(Boolean).join(' · ')}</span>`;
    strip.append(b);
  }
  eps.prepend(strip);
}, TOOLS);
await sleep(1500);
await shoot('cinema', h, '.u-tabs');
await h.close();
