// النمط الموحد فوق صفحتي الأنمي والسينما الحقيقيتين (Debug، المحتوى الموحد مفعّل). طبقة CSS + ترتيب، بلا مكوّنات جديدة سوى الألسنة.
import { launch, sleep } from '../../../audit/ux-2026-11-12/scripts/harness.mjs';
import { readFile } from 'node:fs/promises';
const out = process.env.OUT ?? new URL('./', import.meta.url).pathname;
const css = await readFile(out + 'unified-look.css', 'utf8');
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
await h.page.evaluate(async () => {
  const d = document.querySelector('.page.active .cn-detail'); d.dataset.look = 'unified';
  d.querySelector('.cn-detail-art').append(Object.assign(document.createElement('i'), { className: 'u-fade' }));
  const body = d.querySelector('#cinemaBody'), play = d.querySelector('#cinemaPlay');
  const prog = document.createElement('div'); prog.className = 'u-progress'; prog.innerHTML = '<span>شاهدت 0 من 62</span><i style="--p:0%"></i><span>5 مواسم</span>';
  play.after(d.querySelector('section.cn-about'));
  const eps = d.querySelector('#cinemaEpisodes');
  const tabs = document.createElement('nav'); tabs.className = 'u-tabs';
  tabs.innerHTML = '<button class="on">الحلقات<small>62</small></button><button>التفاصيل</button><button>مشابه</button>';
  eps.before(tabs);
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
});
await sleep(1500);
await shoot('cinema', h, '.u-tabs');
await h.close();
