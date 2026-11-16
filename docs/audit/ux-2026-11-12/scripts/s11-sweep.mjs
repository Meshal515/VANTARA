// Visual sweep of main pages: horizontal overflow, clipped/overlapping text, empty states.
import { launch, sleep } from './harness.mjs';
const out = process.env.VANTARA_SHOTS ?? 'audit-shots';
const now = Date.now();
const rows = {
  work_views: [
    { user_id: 'qa', series_ref: 'anime:21', series_title: 'One Piece', chapter_label: 'الحلقة 1100', viewed_at: now - 3600e3 },
    { user_id: 'qa', series_ref: 'cinema:tt0903747:1', series_title: 'Breaking Bad', chapter_label: 'الموسم 1 · الحلقة 3', viewed_at: now - 7200e3 },
    { user_id: 'qa', series_ref: 'cinema:tt0816692', series_title: 'Interstellar', chapter_label: 'فيلم', viewed_at: now - 9000e3 },
  ],
  library: [
    { id: 'l1', user_id: 'qa', series_ref: 'anime:21', series_title: 'One Piece', added_at: now - 86400e3, removed: 0 },
    { id: 'l2', user_id: 'qa', series_ref: 'cinema:tt0903747', series_title: 'Breaking Bad', added_at: now - 86400e3, removed: 0 },
  ],
};
const W = Number(process.argv[2] ?? 390);
for (const [mode, opts] of [['anime', { section: 'anime' }], ['cinema', { section: 'cinema' }], ['unified', { unified: true }]]) {
  const h = await launch({ ...opts, rows, viewport: { width: W, height: 844 } });
  const { page } = h;
  await sleep(4500);
  for (const p of ['home', 'library', 'majlis', 'settings']) {
    await page.evaluate((p) => window.__shell.showPage(p), p);
    await sleep(2200);
    const r = await page.evaluate(() => {
      const vw = innerWidth;
      const over = document.documentElement.scrollWidth - vw;
      const offenders = [];
      for (const n of document.querySelectorAll('.page.active *')) {
        if (!n.getClientRects().length) continue;
        const b = n.getBoundingClientRect();
        if (b.width < 4 || b.height < 4) continue;
        const cs = getComputedStyle(n);
        if (cs.position === 'fixed') continue;
        // text clipped without ellipsis
        if (n.children.length === 0 && n.textContent.trim() && n.scrollWidth > n.clientWidth + 2 && cs.overflow !== 'visible' && cs.textOverflow !== 'ellipsis' && !/scroll|auto/.test(cs.overflowX)) offenders.push(`clip:${n.className || n.tagName}:${n.textContent.trim().slice(0, 25)}`);
        // element sticking outside viewport while page is not horizontally scrollable container
        let anc = n.parentElement, inScroller = false;
        while (anc) { const s = getComputedStyle(anc); if (/(auto|scroll|hidden|clip)/.test(s.overflowX)) { inScroller = true; break; } anc = anc.parentElement; }
        if (!inScroller && (b.right > vw + 1 || b.left < -1)) offenders.push(`out:${String(n.className).slice(0, 30)}:${Math.round(b.left)}..${Math.round(b.right)}`);
      }
      return { over, offenders: [...new Set(offenders)].slice(0, 8), text: document.querySelector('.page.active')?.innerText.replace(/\s+/g, ' ').slice(0, 160) };
    });
    console.log(W, mode, p, JSON.stringify(r));
    await page.screenshot({ path: `${out}/sweep-${W}-${mode}-${p}.png` });
  }
  if (h.log.errors.length) console.log('  errors', JSON.stringify(h.log.errors.slice(0, 3)));
  await h.close();
}
