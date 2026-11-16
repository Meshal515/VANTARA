import { openSnap } from './snap.mjs';
import { readFile } from 'node:fs/promises';
const C = process.env.CAPTURE_DIR ?? 'capture-evidence/';
const out = process.env.OUT ?? new URL('./', import.meta.url).pathname;
const COVER = 'https://s4.anilist.co/file/anilistcdn/media/manga/cover/large/bx105778-euxXZEIfDY2u.png';
const h = await openSnap({ root: '/home/user/VANTARA-debug/apps/web', file: C + 'd/dom-gallery.html', cover: COVER });
await h.page.addStyleTag({ content: await readFile(out + 'webtoon.css', 'utf8') });
const info = await h.page.evaluate(() => {
  const d = document.querySelector('#detail'); d.dataset.v = 'wt';
  const img = d.querySelector('.mw-cover img');
  if (img?.naturalWidth) document.documentElement.style.setProperty('--wt-hero', Math.round(Math.min(innerWidth * img.naturalHeight / img.naturalWidth, 600)) + 'px');
  d.querySelector('.mw-stage').append(Object.assign(document.createElement('i'), { className: 'wt-fade' }));
  // التواريخ من صفوف الفصول الحقيقية (تنازليًا)، والسنة تُستنتج حين يعبر الشهر حدّ السنة
  const M = { 'يناير': 0, 'فبراير': 1, 'مارس': 2, 'أبريل': 3, 'ابريل': 3, 'مايو': 4, 'يونيو': 5, 'يوليو': 6, 'أغسطس': 7, 'اغسطس': 7, 'سبتمبر': 8, 'أكتوبر': 9, 'اكتوبر': 9, 'نوفمبر': 10, 'ديسمبر': 11 };
  const rows = [...d.querySelectorAll('.mw-ch')];
  let year = 2026, prevMonth = null; const dated = [];
  for (const r of rows) {
    const t = r.querySelector('.t')?.innerText || '';
    const name = Object.keys(M).find((k) => t.includes(k)); const day = Number((t.match(/(\d{1,2})\s*(?:يناير|فبراير|مارس|أبريل|ابريل|مايو|يونيو|يوليو|أغسطس|اغسطس|سبتمبر|أكتوبر|اكتوبر|نوفمبر|ديسمبر)/) || [])[1]);
    if (!name || !day) { dated.push(null); continue; }
    const m = M[name]; if (prevMonth !== null && m > prevMonth) year--; prevMonth = m;
    dated.push(new Date(Date.UTC(year, m, day)));
  }
  // إيقاع الإصدار: وسيط الفروق بين آخر 8 فصول مؤرخة
  const ds = dated.filter(Boolean).slice(0, 9); const gaps = [];
  for (let i = 1; i < ds.length; i++) gaps.push(Math.round((ds[i - 1] - ds[i]) / 864e5));
  const g = gaps.filter((x) => x > 0).sort((a, b) => a - b); const med = g.length ? g[Math.floor(g.length / 2)] : null;
  const last = ds[0]; const next = med && last ? new Date(+last + med * 864e5) : null;
  const ar = (dt) => dt.toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', { day: 'numeric', month: 'long' });
  const beat = document.createElement('div'); beat.className = 'wt-beat';
  beat.innerHTML = `<i></i><span>${med ? (med <= 8 ? 'يصدر <b>أسبوعيًا</b>' : `يصدر كل <b>~${med} يومًا</b>`) : 'يصدر باستمرار'}${next ? ` · القادم <b>${ar(next)}</b>` : ''}</span>`;
  d.querySelector('.mw-center').after(beat);
  // الشهور محطات، و«جديد» لما صدر في آخر 14 يومًا من أحدث فصل
  let lastKey = null; const counts = new Map(); const heads = [];
  rows.forEach((r, i) => {
    const dt = dated[i]; if (!dt) return;
    const key = dt.toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', { month: 'long', year: 'numeric' });
    if (key !== lastKey) { const hd = document.createElement('div'); hd.className = 'wt-month'; hd.dataset.k = key; hd.textContent = key; r.before(hd); heads.push(hd); lastKey = key; }
    counts.set(key, (counts.get(key) || 0) + 1);
    if (last && (last - dt) / 864e5 <= 14) { r.classList.add('wt-new'); const b = r.querySelector('.t b, .t span'); const tag = document.createElement('span'); tag.className = 'wt-tag'; tag.textContent = 'جديد'; (r.querySelector('.t') || r).firstElementChild?.append(tag); }
  });
  for (const hd of heads) { const s = document.createElement('small'); const n = counts.get(hd.dataset.k); s.textContent = n === 1 ? 'فصل واحد' : `${n} فصول`; hd.append(s); }
  return { med, gaps, last: last?.toISOString().slice(0, 10), next: next?.toISOString().slice(0, 10), months: heads.length };
});
console.log(JSON.stringify(info));
await h.page.waitForTimeout(700);
await h.page.screenshot({ path: out + 'wt2-0.png' });
await h.page.evaluate(() => { const n = document.querySelector('#detailTabs'); scrollTo(0, n.getBoundingClientRect().top + scrollY - 60); });
await h.page.waitForTimeout(500); await h.page.screenshot({ path: out + 'wt2-1.png' });
await h.page.evaluate(() => scrollBy(0, 760)); await h.page.waitForTimeout(500); await h.page.screenshot({ path: out + 'wt2-2.png' });
await h.close();
