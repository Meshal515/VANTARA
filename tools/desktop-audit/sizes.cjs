// أحجام عناصر صفحة العمل على مقاس معيّن: عرض الحاويات، وحجم البطاقة النموذجية في كل قسم، وعدد الأعمدة
const { openDesktop, chromium } = require('./desktop-harness.cjs');
const [section, style, w, h, rail] = process.argv.slice(2);
const PICK = { anime: ['.an-card:not(.an-card--ranked)', /apothecary/i], cinema: ['.cn-poster', null], manga: ['.page.active .work-card', /solo leveling/i] };
(async () => {
  const browser = await chromium.launch();
  const { page } = await openDesktop({ browser, viewport: { width: +w, height: +h }, storage: { 'vantara.session.v1': { token: 'x', user: { userId: 'u', name: 't' }, savedAt: Date.now() }, 'vantara.appearance.v1': { style: style === 'unified' ? {} : { [section]: style }, accent: {}, pureBlack: false, unifiedLook: style === 'unified' }, ...(rail === '1' ? { 'vantara.rail.collapsed': '1' } : {}) } });
  await page.goto('http://127.0.0.1:8765/'); await page.waitForTimeout(4000);
  await page.evaluate(s => [...document.querySelectorAll('.drawer button')].find(x => x.textContent.trim().toUpperCase().startsWith(s.toUpperCase()))?.click(), section);
  await page.waitForTimeout(section === 'manga' ? 9000 : 6000);
  await page.evaluate(([sel, want, isCinema]) => { let c = [...document.querySelectorAll(sel)].filter(x => x.checkVisibility() && x.querySelector('img')); if (isCinema) { const s = c.filter(x => /مسلسلات/.test(x.closest('section')?.querySelector('h2')?.textContent ?? '')); if (s.length) c = s; } (want ? c.find(x => new RegExp(want, 'i').test(x.textContent)) : null ?? c[0])?.click() ?? c[0]?.click(); }, [PICK[section][0], PICK[section][1]?.source ?? null, section === 'cinema']);
  await page.waitForTimeout(section === 'manga' ? 15000 : 9000);
  await page.evaluate(async () => { const e = document.scrollingElement; for (let y = 0; y < e.scrollHeight; y += 700) { e.scrollTo(0, y); await new Promise(r => setTimeout(r, 100)); } e.scrollTo(0, 0); });
  await page.waitForTimeout(1000);
  const out = await page.evaluate(() => {
    const vis = e => e.checkVisibility?.();
    const root = [...document.querySelectorAll('#detail, .aw, .cn-detail')].find(vis);
    const rr = root.getBoundingClientRect();
    const res = [`root ${root.className.split(' ')[0]} w${Math.round(rr.width)}`];
    // كل قسم ظاهر: عنوانه، عرضه، وأول عنصر متكرر فيه (أكبر مجموعة أبناء متشابهين)
    for (const sec of root.querySelectorAll('section, .aw-stage, .cn-detail-body, .mw-tabbed')) {
      if (!vis(sec)) continue;
      const r = sec.getBoundingClientRect(); if (r.height < 40) continue;
      let best = null;
      for (const el of sec.querySelectorAll('*')) { if (!vis(el) || el.children.length < 3) continue; const kids = [...el.children].filter(vis); const tag = kids[0]?.className; if (kids.length >= 3 && kids.filter(k => k.className === tag).length >= 3 && (!best || kids.length > best.n)) best = { el, n: kids.length, item: kids[0] }; }
      const head = sec.querySelector('h2,h3')?.textContent?.trim().slice(0, 24) ?? String(sec.className).slice(0, 24);
      if (!best) { res.push(`${head} | sec ${Math.round(r.left)}..${Math.round(r.right)} w${Math.round(r.width)}`); continue; }
      const ir = best.item.getBoundingClientRect(), gr = best.el.getBoundingClientRect();
      const cols = new Set([...best.el.children].filter(vis).map(k => Math.round(k.getBoundingClientRect().top))).size;
      res.push(`${head} | sec ${Math.round(r.left)}..${Math.round(r.right)} w${Math.round(r.width)} | grid ${String(best.el.className).slice(0, 26)} w${Math.round(gr.width)} | item ${String(best.item.className).slice(0, 22)} ${Math.round(ir.width)}x${Math.round(ir.height)} | n${best.n} rows${cols} | gtc ${getComputedStyle(best.el).gridTemplateColumns.split(' ').length}`);
    }
    return res;
  });
  console.log(`${section} ${style} ${w}${rail === '1' ? ' rail' : ''}\n` + out.join('\n'));
  await browser.close();
})();
