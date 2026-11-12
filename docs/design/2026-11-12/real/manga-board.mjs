import { openSnap } from './snap.mjs';
import { readFile } from 'node:fs/promises';
const C = process.env.CAPTURE_DIR ?? 'capture-evidence/';
const out = process.env.OUT ?? new URL('./', import.meta.url).pathname;
const css = await readFile(out + 'manga-looks.css', 'utf8');
const COVER = 'https://s4.anilist.co/file/anilistcdn/media/manga/cover/large/bx105778-euxXZEIfDY2u.png';
for (const v of (process.argv[2] || 'unified,webtoon,direct').split(',')) {
  const h = await openSnap({ root: '/home/user/VANTARA-debug/apps/web', file: C + 'd/dom-gallery.html', cover: COVER });
  await h.page.addStyleTag({ content: css });
  await h.page.evaluate((v) => {
    const d = document.querySelector('#detail'); d.dataset.v = v;
    const p = d.querySelector('#detailProgress'); if (/لم تبدأ/.test(p?.innerText || '')) p.classList.add('u-empty');
    if (v !== 'direct') d.querySelector('.mw-stage').append(Object.assign(document.createElement('i'), { className: 'u-fade' }));
    if (v === 'webtoon') {
      const M = { 'يناير': 1, 'فبراير': 2, 'مارس': 3, 'أبريل': 4, 'ابريل': 4, 'مايو': 5, 'يونيو': 6, 'يوليو': 7, 'أغسطس': 8, 'اغسطس': 8, 'سبتمبر': 9, 'أكتوبر': 10, 'اكتوبر': 10, 'نوفمبر': 11, 'ديسمبر': 12 };
      const rows = [...d.querySelectorAll('.mw-ch')];
      let last = null, counts = new Map(), heads = [];
      for (const r of rows) {
        const t = r.querySelector('.t')?.innerText || '';
        const m = Object.keys(M).find((k) => t.includes(k)); const y = (t.match(/20\d\d/) || [''])[0];
        const key = m ? `${m} ${y}`.trim() : null;
        if (key && key !== last) { const hd = document.createElement('div'); hd.className = 'wt-month'; hd.dataset.k = key; hd.textContent = key; r.before(hd); heads.push(hd); last = key; }
        if (key) counts.set(key, (counts.get(key) || 0) + 1);
      }
      for (const hd of heads) { const s = document.createElement('small'); s.textContent = `${counts.get(hd.dataset.k)} فصول`; hd.append(s); }
      const cad = document.createElement('div'); cad.className = 'wt-cadence'; cad.innerHTML = '<i></i><span>يصدر <b>أسبوعيًا</b> · آخر فصل 26 مارس</span>';
      d.querySelector('.mw-acts').after(cad);
    }
  }, v);
  await h.page.waitForTimeout(800);
  await h.page.screenshot({ path: `${out}manga-${v}-0.png` });
  await h.page.evaluate(() => { const n = document.querySelector('#detailTabs'); scrollTo(0, n.getBoundingClientRect().top + scrollY - 60); });
  await h.page.waitForTimeout(600);
  await h.page.screenshot({ path: `${out}manga-${v}-1.png` });
  await h.close();
}
