// سحب فوق وتحت متكرر بلمس حقيقي (CDP touch) في صفحة العمل لكل نمط: هل يهتز الغلاف/البطل؟
// يفشل إن اختلف موضع الغلاف لنفس موضع التمرير (>2px)، أو انعكس اتجاهه، أو كتب JavaScript على طبقة
// يحرّكها CSS (خارج WebView لا تسليم أصلًا: collapse-hero.js flingHoldRisk).
// node tools/ui-qa/scroll-shake.mjs [manga,anime,cinema] [look,look] — شغّل قسمًا واحدًا كل مرة إن ضاقت الذاكرة
import { launch, sleep } from './rig.mjs';
const { MANGA_WORK_STYLES, WORK_STYLES, CINEMA_WORK_STYLES } = await import('../../apps/web/v35/appearance.js');
const SETS = { manga: [MANGA_WORK_STYLES, 'manga', 'detail'], anime: [WORK_STYLES, 'anime', 'anime'], cinema: [CINEMA_WORK_STYLES, 'series', 'cinema'] };
const sections = (process.argv[2] ?? 'manga').split(',');
const only = process.argv[3]?.split(',');
let bad = 0;
for (const sec of sections) {
  const [styles, kind, pid] = SETS[sec];
  // «النمط الموحد» (appearance.unifiedLook) حالة إضافية لكل قسم
  for (const { id: look } of [...styles, { id: 'unified' }]) {
    if (only && !only.includes(look)) continue;
    const h = await launch({ section: sec, appearance: look === 'unified' ? { unifiedLook: true } : { style: { [sec]: look } } });
    await sleep(900);
    await h.page.evaluate((k) => window.__open(k), kind);
    await sleep(1800);
    const cdp = await h.context.newCDPSession(h.page);
    // مراقب كل إطار
    await h.page.evaluate((pid) => {
      const p = document.getElementById(pid);
      const sel = '.mw-stage .mw-cover,.mw-ban,.mw-resume,.detail-head > .detail-cover,.aw-cover,.aw-bg,.wl-stage3d > .wl-card,.cn-detail-art > .cn-img';
      window.__rows = []; window.__ev = [];
      for (const t of ['touchstart', 'touchend']) addEventListener(t, () => window.__ev.push([t, performance.now()]), { passive: true });
      const tick = () => {
        const c = p.querySelector(sel); const r = c?.getBoundingClientRect();
        if (r) window.__rows.push({ t: performance.now(), y: scrollY, top: r.top, h: r.height, tf: getComputedStyle(c.closest('.mw-lift') ?? c).transform.slice(0, 60), inline: (c.closest('.mw-lift') ?? c).style.transform ? 1 : 0 });
        window.__raf = requestAnimationFrame(tick);
      };
      tick();
    }, pid);
    const drag = async (y0, y1, steps) => {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 195, y: y0 }] });
      for (let i = 1; i <= steps; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 195, y: y0 + (y1 - y0) * i / steps }] }); await sleep(16); }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    };
    // بطيء ثم زحلقات سريعة، نزول وصعود متكرر
    for (let i = 0; i < 3; i++) { await drag(700, 350, 14); await sleep(300); await drag(350, 700, 14); await sleep(300); }
    for (let i = 0; i < 4; i++) { await drag(720, 260, 5); await sleep(900); await drag(260, 720, 5); await sleep(900); }
    const { rows, ev } = await h.page.evaluate(() => { cancelAnimationFrame(window.__raf); return { rows: window.__rows, ev: window.__ev }; });
    // الغلاف على الشاشة دالة في التمرير: top + y = موضعه في المستند. أي اهتزاز = تغير هذا المقدار عكس اتجاهه
    // أو اختلافه عند التمرير نفسه بين مرور وآخر
    const doc = rows.map((r) => ({ y: Math.round(r.y), d: r.top + r.y, h: r.h }));
    const byY = new Map();
    for (const r of doc) { const a = byY.get(r.y) ?? []; a.push(r.d); byY.set(r.y, a); }
    let spread = 0, at = 0;
    for (const [y, a] of byY) { const s = Math.max(...a) - Math.min(...a); if (s > spread) { spread = s; at = y; } }
    // انعكاس: بين إطارين متتاليين التمرير يزيد والغلاف (في المستند) يقل ثم يزيد خلال 3 إطارات
    let flips = 0;
    for (let i = 2; i < doc.length; i++) {
      const s1 = Math.sign(doc[i - 1].y - doc[i - 2].y), s2 = Math.sign(doc[i].y - doc[i - 1].y);
      const d1 = doc[i - 1].d - doc[i - 2].d, d2 = doc[i].d - doc[i - 1].d;
      if (s1 === s2 && s1 !== 0 && Math.abs(d1) > 1.5 && Math.abs(d2) > 1.5 && Math.sign(d1) !== Math.sign(d2)) flips++;
    }
    const hs = new Set(doc.map((r) => Math.round(r.h))).size;
    const maxY = Math.max(...doc.map((r) => r.y));
    const fail = spread > 2 || flips > 0 || rows.some((r) => r.inline);
    if (fail) bad++;
    console.log(`${fail ? 'FAIL' : 'ok  '} ${sec}/${look}: إطارات=${rows.length} أقصى تمرير=${maxY} لمسات=${ev.filter((e) => e[0] === 'touchend').length} اختلاف الموضع لنفس التمرير=${spread.toFixed(1)}px@${at} انعكاسات=${flips} أحجام=${hs} inline=${rows.filter((r) => r.inline).length}`);
    await h.close();
  }
}
process.exit(bad ? 1 : 0);
