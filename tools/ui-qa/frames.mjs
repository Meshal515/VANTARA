// مسجّل إطارات الانتقال: يُحقن في الصفحة ويسجّل في كل إطار رسم ما يراه المستخدم فعلًا، ثم يُحلَّل خارجها.
// لا يعتمد على لقطات الشاشة (بطيئة وتفوّت الإطارات): يقرأ الحالة المحسوبة في rAF نفسه الذي يُرسم بعده.

/** يُحقن مرة: window.__rec.start() / stop(). */
export async function installRecorder(page) {
  await page.evaluate(() => {
    const vis = (n) => {
      if (!n || n.hidden) return 0;
      const c = getComputedStyle(n);
      if (c.display === 'none' || c.visibility === 'hidden') return 0;
      return Number(c.opacity);
    };
    // شفافية العنصر الفعلية = حاصل ضرب شفافية أسلافه
    const effective = (n) => { let o = 1; for (let x = n; x && x.nodeType === 1; x = x.parentElement) { const c = getComputedStyle(x); if (c.display === 'none' || c.visibility === 'hidden') return 0; o *= Number(c.opacity); } return o; };
    const box = (n) => { if (!n) return null; const r = n.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]; };
    const owner = (x, y) => {
      const n = document.elementFromPoint(x, y);
      if (!n) return null;
      return n.closest('.page')?.id ?? (n.closest('#bottomNav') ? 'nav' : n.closest('.sheet,.sheet-wrap') ? 'sheet' : n.closest('[class*="uv-page"],[class*="ud-"],[class*="ul-"]') ? 'overlay' : n.id || n.tagName);
    };
    const TRACK = '#detailCover, .aw-cover, .wl-card, .wl-cover, .cn-poster, .cn-detail-art, .mw-ban, .aw-bar, .cn-detail-bar, .wl-dock, .wl-mini';
    let frames = [];
    let on = false;
    let t0 = 0;
    const tick = () => {
      if (!on) return;
      const pages = {};
      for (const p of document.querySelectorAll('.page')) {
        const o = vis(p);
        if (!o && !p.classList.contains('active')) continue;
        const c = getComputedStyle(p);
        pages[p.id] = { o: +o.toFixed(3), active: p.classList.contains('active'), fixed: c.position === 'fixed', top: Math.round(p.getBoundingClientRect().top), cls: [...p.classList].filter((x) => x.startsWith('page-')).join(' ') };
      }
      const nav = document.getElementById('bottomNav');
      const header = document.querySelector('.page.active .header, #home .header');
      const w = innerWidth, h = innerHeight;
      const tracked = {};
      for (const n of document.querySelectorAll(TRACK)) {
        const pid = n.closest('.page')?.id;
        if (!pid || !pages[pid]) continue;
        const key = `${pid}:${[...n.classList][0] ?? n.id}`;
        if (!(key in tracked)) tracked[key] = { b: box(n), o: +effective(n).toFixed(3) };
      }
      frames.push({
        t: Math.round(performance.now() - t0), y: Math.round(scrollY), pages,
        nav: nav ? { o: +effective(nav).toFixed(3), hidden: nav.hidden, inert: nav.inert } : null,
        header: header ? { o: +effective(header).toFixed(3), page: header.closest('.page')?.id } : null,
        top: [owner(w / 2, h * 0.1), owner(w / 2, h / 2), owner(w / 2, h * 0.9)],
        tracked,
      });
      requestAnimationFrame(tick);
    };
    window.__rec = {
      start() { frames = []; on = true; t0 = performance.now(); requestAnimationFrame(tick); },
      stop() { on = false; return frames; },
    };
  });
}

/**
 * يسجّل `ms` بعد تنفيذ `action` (دالة تُنفَّذ داخل الصفحة في الإطار نفسه الذي يبدأ فيه التسجيل).
 * @returns {Promise<object[]>} الإطارات
 */
export async function record(page, action, arg, ms = 700) {
  await page.evaluate(([src, arg]) => { window.__rec.start(); return (0, eval)(`(${src})`)(arg); }, [action.toString(), arg]);
  await page.waitForTimeout(ms);
  return page.evaluate(() => window.__rec.stop());
}

const WORK = new Set(['detail', 'anime', 'cinema']);

/**
 * يحلّل تسجيل انتقال من `from` إلى `to` ويعيد قائمة مخالفات (فارغة = سليم).
 * القواعد:
 *  - leak: صفحة ثالثة ظاهرة (غير المغادرة والداخلة).
 *  - blank: إطار لا صفحة فيه ظاهرة بما يكفي (وميض فراغ).
 *  - nav-over-work: الشريط السفلي ظاهر بكامله فوق صفحة عمل ما زالت معتمة (يظهر قبل أن تغادر).
 *  - nav-missing: انتهى الانتقال إلى صفحة رئيسية والشريط السفلي غير ظاهر.
 *  - jump: عنصر متتبَّع قفز أكثر من `jumpPx` بين إطارين متتاليين دون أن تكون صفحته تتلاشى (قفزة هندسة).
 *  - stuck: بقايا حركة أو صفحتان نشطتان في النهاية.
 *  - flicker: شفافية الصفحة الداخلة تنخفض بعد أن ارتفعت (وميض)، أو المغادرة ترتفع بعد أن انخفضت.
 */
export function analyze(frames, { from, to, jumpPx = 24, mainPages = ['home', 'library', 'discover', 'majlis'] } = {}) {
  const issues = [];
  const add = (kind, f, detail) => issues.push({ kind, t: f?.t ?? null, detail });
  if (!frames.length) return [{ kind: 'no-frames', t: null, detail: '' }];
  let prev = null;
  const peak = {};
  const trough = {};
  for (const f of frames) {
    const ids = Object.keys(f.pages).filter((id) => f.pages[id].o > 0.02);
    for (const id of ids) if (id !== from && id !== to) add('leak', f, `${id} ظاهرة (${f.pages[id].o})`);
    const total = ids.reduce((s, id) => s + f.pages[id].o, 0);
    if (total < 0.5 && f.t > 0) add('blank', f, `مجموع الشفافية ${total.toFixed(2)}`);
    const work = ids.find((id) => WORK.has(id) && f.pages[id].o > 0.9);
    if (work && f.nav && f.nav.o > 0.9 && !f.nav.hidden) add('nav-over-work', f, `الشريط ${f.nav.o} فوق ${work}`);
    // وميض: الداخلة لا تنخفض، والمغادرة لا ترتفع
    if (to !== from) {
      const oi = f.pages[to]?.o ?? 0;
      const oo = f.pages[from]?.o ?? 0;
      peak[to] = Math.max(peak[to] ?? 0, oi);
      if (oi < (peak[to] ?? 0) - 0.08) add('flicker', f, `${to} انخفضت من ${peak[to]} إلى ${oi}`);
      trough[from] = Math.min(trough[from] ?? 1, oo);
      if (oo > (trough[from] ?? 1) + 0.08) add('flicker', f, `${from} ارتفعت من ${trough[from]} إلى ${oo}`);
    }
    if (prev) {
      for (const [key, cur] of Object.entries(f.tracked)) {
        const was = prev.tracked[key];
        if (!was?.b || !cur.b || cur.o < 0.5 || was.o < 0.5) continue;
        const pid = key.split(':')[0];
        // صفحة تتحرك بمقياس الانتقال (اندفاع 4%) تزيح عناصرها بكسلات قليلة: هذا مقصود ودون العتبة
        const d = Math.hypot(cur.b[0] - was.b[0], cur.b[1] - was.b[1]);
        const dy = f.y - prev.y;
        // التمرير نفسه يزيح العناصر غير الثابتة: يُطرح
        const residual = Math.abs(Math.abs(cur.b[1] - was.b[1]) - Math.abs(dy)) ;
        if (d > jumpPx && residual > jumpPx && (f.pages[pid]?.o ?? 0) > 0.5) add('jump', f, `${key} ${JSON.stringify(was.b)} → ${JSON.stringify(cur.b)} (scroll ${prev.y}→${f.y})`);
      }
    }
    prev = f;
  }
  const last = frames.at(-1);
  const active = Object.keys(last.pages).filter((id) => last.pages[id].active);
  if (active.length !== 1 || active[0] !== to) add('stuck', last, `النشطة ${JSON.stringify(active)} والمتوقعة ${to}`);
  for (const [id, p] of Object.entries(last.pages)) {
    if (p.cls) add('stuck', last, `${id} بقيت عليها ${p.cls}`);
    if (id !== to && p.o > 0.02) add('stuck', last, `${id} ما زالت ظاهرة ${p.o}`);
    if (p.fixed) add('stuck', last, `${id} بقيت fixed`);
  }
  if ((last.pages[to]?.o ?? 0) < 0.99) add('stuck', last, `${to} شفافيتها ${last.pages[to]?.o}`);
  if (mainPages.includes(to) && last.nav && (last.nav.hidden || last.nav.o < 0.99 || last.nav.inert)) add('nav-missing', last, JSON.stringify(last.nav));
  if (!mainPages.includes(to) && last.nav && !last.nav.hidden && last.nav.o > 0.02) add('nav-left', last, JSON.stringify(last.nav));
  // تجميع المخالفات المتكررة في إطارات متتالية إلى سطر واحد بمدتها
  const grouped = new Map();
  for (const i of issues) {
    const key = `${i.kind}|${i.detail.replace(/[\d.]+/g, '#')}`;
    const g = grouped.get(key) ?? { kind: i.kind, first: i.t, last: i.t, n: 0, detail: i.detail };
    g.n++; g.last = i.t;
    grouped.set(key, g);
  }
  return [...grouped.values()];
}

/** ملخص مقروء لتسجيل: مسار الشفافية لكل صفحة والشريط. */
export const timeline = (frames) => frames.filter((_, i) => i % 3 === 0).map((f) => `${String(f.t).padStart(4)}ms y=${f.y} ${Object.entries(f.pages).map(([id, p]) => `${id}:${p.o}${p.fixed ? 'F' : ''}`).join(' ')} nav:${f.nav?.hidden ? 'H' : f.nav?.o} top:${f.top.join('/')}`).join('\n');
