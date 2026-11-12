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
    const box = (n) => { if (!n) return null; const r = n.getBoundingClientRect(); return [+r.left.toFixed(2), +r.top.toFixed(2), +r.width.toFixed(2), +r.height.toFixed(2)]; };
    const owner = (x, y) => {
      const n = document.elementFromPoint(x, y);
      if (!n) return null;
      return n.closest('.page')?.id ?? (n.closest('#bottomNav') ? 'nav' : n.closest('.sheet,.sheet-wrap') ? 'sheet' : n.closest('[class*="uv-page"],[class*="ud-"],[class*="ul-"]') ? 'overlay' : n.id || n.tagName);
    };
    const TRACK = '#detailCover, .aw-cover, .wl-card, .wl-cover, .cn-poster, .cn-detail-art, .mw-ban, .aw-bar, .cn-detail-bar, .wl-dock, .wl-mini, .header, .uv-ptop, #detailTop';
    let frames = [];
    let on = false;
    let t0 = 0;
    const tick = () => {
      if (!on) return;
      const pages = {};
      // طبقات الموحد (الرائج، اكتشف، البحث، الجدول) صفحات بالنسبة لما يراه المستخدم: تُسجَّل باسم overlay
      const overlays = [...document.querySelectorAll('.uv-page')].filter((n) => n.isConnected && vis(n) > 0);
      for (const p of [...document.querySelectorAll('.page'), ...overlays]) {
        if (p.classList.contains('uv-page')) Object.defineProperty(p, '__qaId', { value: 'overlay', configurable: true });
        const o = p.classList.contains('uv-page') ? effective(p) : vis(p);
        if (!o && !p.classList.contains('active')) continue;
        const c = getComputedStyle(p);
        // المقياس المرئي لمحتوى الصفحة: أول ابن له عرض (عدا الأشرطة الثابتة) = عرضه المرسوم ÷ عرضه في التخطيط
        // الوحدات بخوارزمية page-motion.motionUnits نفسها: أبناء أسلاف الأشرطة الثابتة، عدا الأسلاف والأشرطة
        const fixedBars = [...p.querySelectorAll('[data-motion-fixed]')];
        const holders = new Set([p]);
        for (const fb of fixedBars) for (let n = fb.parentElement; n && n !== p; n = n.parentElement) holders.add(n);
        const units = [];
        for (const h of holders) for (const ch of h.children) if (!holders.has(ch) && !fixedBars.includes(ch)) units.push(ch);
        const unit = units.find((n) => n.offsetWidth > 100);
        const s = unit ? unit.getBoundingClientRect().width / unit.offsetWidth : 1;
        // ما يراه المستخدم من هوية العمل: صورة الغلاف/البطل والعنوان. تبدّلها والصفحة ظاهرة = محتوى متأخر أو قديم
        // صورة كل حاوية فن على حدة (الغلاف، البطل، البنر): آخر صورة فيها هي المرئية فوق ما قبلها
        const arts = [...p.querySelectorAll('#detailCover, .aw-cover, .aw-bg, .cn-detail-art, .cn-poster, .wl-cover, .mw-ban, .cn-look-poster')]
          .map((box) => { const im = [...box.querySelectorAll('img')].filter((i) => getComputedStyle(i).display !== 'none').at(-1); return im ? (im.currentSrc || im.getAttribute('src') || '') : ''; });
        const art = { currentSrc: arts.join(',') };
        const title = p.querySelector('#detailTitle, .aw-title, .cn-title, h1');
        const cov = p.querySelector('#detailCover, .aw-cover, .cn-poster, .cn-detail-art, .wl-cover, .mw-cover');
        pages[p.__qaId ?? p.id] = {
          o: +o.toFixed(3), s: +s.toFixed(3), active: p.classList.contains('active'), fixed: c.position === 'fixed', top: Math.round(p.getBoundingClientRect().top), cls: [...p.classList].filter((x) => x.startsWith('page-')).join(' '),
          sig: `${art.currentSrc}|${(title?.textContent ?? '').trim().slice(0, 40)}`,
          // حجم الغلاف في التخطيط (لا يتأثر بالاندفاع): تغيّره والصفحة ظاهرة = قفزة أو قص
          cov: cov ? [cov.offsetWidth, cov.offsetHeight] : null,
          // كمية المحتوى المرسوم: قفزتها والصفحة معتمة = محتوى ظهر دفعة (أو أُعيد بناؤه أمام العين)
          n: p.getElementsByTagName('*').length,
          // محتوى داخل الصفحة يتلاشى الآن (settleIn وأمثاله): الإضافة معه ليست ظهورًا دفعة
          fading: p.getAnimations({ subtree: true }).some((a) => a.effect?.target !== p && a.playState === 'running' && JSON.stringify(a.effect?.getKeyframes?.() ?? []).includes('opacity')),
          // صور ظاهرة اكتمل تحميلها: نقصها ثم عودتها = صور تختفي وترجع
          imgs: [...p.getElementsByTagName('img')].filter((i) => i.complete && i.naturalWidth > 0).length,
        };
      }
      const nav = document.getElementById('bottomNav');
      const header = document.querySelector('.page.active .header, #home .header');
      const w = innerWidth, h = innerHeight;
      const tracked = {};
      for (const n of document.querySelectorAll(TRACK)) {
        const pid = n.closest('.uv-page') ? 'overlay' : n.closest('.page')?.id;
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
  // طبقة الموحد فوق صفحة: ما تحت طبقة معتمة مغطى (لا يُرى ولا يُعد تسربًا). والصفحة التي تحت الطبقة في انتقال
  // فتحها أو إغلاقها لا تتحرك (الطبقة هي التي تدخل وتخرج)، فلا يُطلب منها تلاشٍ.
  const other = from === 'overlay' ? to : from;
  const under = (from === 'overlay' || to === 'overlay') && !WORK.has(other) ? other : null;
  frames = frames.map((f) => {
    if (!((f.pages.overlay?.o ?? 0) >= 0.99)) return f;
    const pages = Object.fromEntries(Object.entries(f.pages).map(([id, p]) => [id, id === 'overlay' ? p : { ...p, o: 0 }]));
    return { ...f, pages };
  });
  for (const f of frames) {
    const ids = Object.keys(f.pages).filter((id) => f.pages[id].o > 0.02);
    for (const id of ids) if (id !== from && id !== to) add('leak', f, `${id} ظاهرة (${f.pages[id].o})`);
    const total = ids.reduce((s, id) => s + f.pages[id].o, 0);
    if (total < 0.5 && f.t > 0) add('blank', f, `مجموع الشفافية ${total.toFixed(2)}`);
    const work = ids.find((id) => WORK.has(id) && f.pages[id].o > 0.9);
    if (work && f.nav && f.nav.o > 0.9 && !f.nav.hidden) add('nav-over-work', f, `الشريط ${f.nav.o} فوق ${work}`);
    // وميض: الداخلة لا تنخفض، والمغادرة لا ترتفع
    if (to !== from && !under) {
      const oi = f.pages[to]?.o ?? 0;
      const oo = f.pages[from]?.o ?? 0;
      peak[to] = Math.max(peak[to] ?? 0, oi);
      if (oi < (peak[to] ?? 0) - 0.08) add('flicker', f, `${to} انخفضت من ${peak[to]} إلى ${oi}`);
      trough[from] = Math.min(trough[from] ?? 1, oo);
      if (oo > (trough[from] ?? 1) + 0.08) add('flicker', f, `${from} ارتفعت من ${trough[from]} إلى ${oo}`);
    }
    if (prev) {
      // عقد الحركة (قرار المالك): الدخول تلاشٍ واندفاع، والخروج تلاشٍ وتراجع، لا ظهور ولا اختفاء في إطار
      if (to !== from && !under) {
        const a = prev.pages[to]?.o ?? 0, b = f.pages[to]?.o ?? 0;
        if (a < 0.15 && b > 0.85) add('no-enter', f, `${to} ظهرت دفعة ${a}→${b}`);
        const c = prev.pages[from]?.o ?? 0, d = f.pages[from]?.o ?? 0;
        if (c > 0.85 && d < 0.15) add('no-exit', f, `${from} اختفت دفعة ${c}→${d}`);
      }
      // محتوى يتبدّل والصفحة ظاهرة: غلاف أو عنوان جديد بعد أن رآه المستخدم
      for (const id of [from, to]) {
        const p0 = prev.pages[id], p1 = f.pages[id];
        if (!p0 || !p1 || p0.o < 0.3 || p1.o < 0.3) continue;
        // تبدّل = حاوية كانت تعرض صورة فصارت تعرض غيرها (لا صورة ظهرت في مكان كان هيكلًا فارغًا)
        const a0 = p0.sig.split('|')[0].split(','), a1 = p1.sig.split('|')[0].split(',');
        const swapped = a0.length === a1.length && a0.some((u, i) => u && a1[i] && u !== a1[i]);
        if (swapped || (p0.sig.split('|')[1] && p0.sig.split('|')[1] !== p1.sig.split('|')[1])) add('content-swap', f, `${id}: ${p0.sig.slice(-70)} → ${p1.sig.slice(-70)}`);
        if (p0.cov && p1.cov && (Math.abs(p0.cov[0] - p1.cov[0]) > 2 || Math.abs(p0.cov[1] - p1.cov[1]) > 2)) add('cover-resize', f, `${id} ${p0.cov} → ${p1.cov}`);
        // صفحة معتمة يُستبدل محتواها أو يُضاف إليه كثير في إطار واحد = ظهور دفعة (لا تلاشٍ له)
        if (p0.o > 0.9 && p1.o > 0.9 && p1.n - p0.n > Math.max(40, p0.n * 0.25) && !p1.fading) add('pop-in', f, `${id} عناصره ${p0.n} → ${p1.n}`);
        if (p0.o > 0.9 && p1.o > 0.9 && p0.n - p1.n > Math.max(40, p0.n * 0.25)) add('rebuild', f, `${id} عناصره ${p0.n} → ${p1.n}`);
        if (p0.o > 0.5 && p1.o > 0.5 && p1.imgs < p0.imgs - 1) add('img-drop', f, `${id} صوره المحمّلة ${p0.imgs} → ${p1.imgs}`);
      }
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
  // الحركة حصلت فعلًا: الداخلة مرّت بشفافية وسطى، وصفحة العمل اندفعت (مقياس أقل من 1)
  if (to !== from) {
    if (under) {
      // الطبقة نفسها تمر بتلاشٍ واندفاع (العقد)، والتي تحتها ثابتة
      const lay = 'overlay';
      if (!frames.some((f) => (f.pages[lay]?.o ?? 0) > 0.15 && (f.pages[lay]?.o ?? 0) < 0.85)) add(to === lay ? 'no-enter' : 'no-exit', last, `الطبقة لم تمر بتلاشٍ`);
      if (!frames.some((f) => (f.pages[lay]?.o ?? 0) > 0.05 && Math.abs((f.pages[lay]?.s ?? 1) - 1) > 0.008)) add('no-push', last, to === lay ? 'الطبقة دخلت بلا اندفاع' : 'الطبقة خرجت بلا تراجع');
    }
  }
  if (to !== from && !under) {
    const mid = (id) => frames.some((f) => (f.pages[id]?.o ?? 0) > 0.15 && (f.pages[id]?.o ?? 0) < 0.85);
    if (!mid(to)) add('no-enter', last, `${to} لم تمر بتلاشٍ`);
    if (frames[0]?.pages[from] && !mid(from)) add('no-exit', last, `${from} لم تمر بتلاشٍ`);
    const pushed = (id) => frames.some((f) => (f.pages[id]?.o ?? 0) > 0.05 && Math.abs((f.pages[id]?.s ?? 1) - 1) > 0.008);
    if (WORK.has(to) && !pushed(to)) add('no-push', last, `${to} دخلت بلا اندفاع`);
    if (WORK.has(from) && frames[0]?.pages[from] && !pushed(from)) add('no-push', last, `${from} خرجت بلا تراجع`);
  }
  for (const g of geometry(frames, { from, to })) add(g.kind, g.f, g.detail);
  const active = Object.keys(last.pages).filter((id) => last.pages[id].active);
  const expectActive = to === 'overlay' ? under : to;
  if (active.length !== 1 || active[0] !== expectActive) add('stuck', last, `النشطة ${JSON.stringify(active)} والمتوقعة ${expectActive}`);
  for (const [id, p] of Object.entries(last.pages)) {
    if (p.cls) add('stuck', last, `${id} بقيت عليها ${p.cls}`);
    if (id !== to && p.o > 0.02) add('stuck', last, `${id} ما زالت ظاهرة ${p.o}`);
    if (p.fixed && id !== 'overlay') add('stuck', last, `${id} بقيت fixed`);
  }
  if ((last.pages[to]?.o ?? 0) < 0.99) add('stuck', last, `${to} شفافيتها ${last.pages[to]?.o}`);
  if (to === 'overlay') {
    // الطبقة مفتوحة: لا يُرى فوقها شيء من تحتها (ولا الشريط السفلي) عند أي نقطة
    if (last.top.some((o) => o !== 'overlay')) add('layer-leak', last, `فوق الطبقة: ${last.top.join('/')}`);
  } else {
    if (mainPages.includes(to) && last.nav && (last.nav.hidden || last.nav.o < 0.99 || last.nav.inert)) add('nav-missing', last, JSON.stringify(last.nav));
    if (!mainPages.includes(to) && last.nav && !last.nav.hidden && last.nav.o > 0.02) add('nav-left', last, JSON.stringify(last.nav));
  }
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

/**
 * الهندسة بالبكسل (معيار المالك: لا يتحرك بكسل من الصورة إلا الاندفاع نفسه). لكل عنصر متتبَّع (الغلاف، البطل،
 * الأشرطة): موضعه المرجعي بمقياس 1 (أول إطار للمغادرة، آخر إطار للداخلة). في كل إطار، مقياسه = عرضه ÷ عرضه
 * المرجعي، والاندفاع الخالص يعني أن مركزه على خط واحد من نقطة ثابتة o: P = o + s(F − o). تُستنتج o من
 * الإطار الأبعد عن 1، ويُقاس انحراف كل إطار عنها. مقياس 1 يعني موضعه المرجعي بالضبط.
 *  - drift: انحراف عن الاندفاع الخالص > tolPx (صعود، نزول، انزلاق، قفزة). الحد 2px: ما تحته تقريب رسم لا يُرى (قرار المالك).
 *  - aspect: تغيّر نسبة العنصر (قص أو تمدد) > tolPx.
 */
export function geometry(frames, { from, to, tolPx = 2 } = {}) {
  const out = [];
  const keys = new Set(frames.flatMap((f) => Object.keys(f.tracked)));
  for (const key of keys) {
    const pid = key.split(':')[0];
    if (pid !== from && pid !== to) continue;
    const seen = frames.filter((f) => f.tracked[key]?.b && f.tracked[key].o > 0.02 && (f.pages[pid]?.o ?? 0) > 0.02);
    if (seen.length < 3) continue;
    // المرجع: الداخلة في نهايتها (والتمرير كما هو فيها)، والمغادرة في بدايتها
    const ref = pid === to && to !== from ? seen.at(-1) : seen[0];
    const F = ref.tracked[key].b;
    const sameScroll = seen.filter((f) => f.y === ref.y || f.pages[pid]?.fixed);
    const cx = (b) => b[0] + b[2] / 2, cy = (b) => b[1] + b[3] / 2;
    const sc = (b) => (F[2] ? b[2] / F[2] : 1);
    const far = sameScroll.reduce((m, f) => (Math.abs(sc(f.tracked[key].b) - 1) > Math.abs(sc(m.tracked[key].b) - 1) ? f : m), ref);
    const sf = sc(far.tracked[key].b);
    const o = Math.abs(1 - sf) > 0.004 ? { x: (cx(far.tracked[key].b) - sf * cx(F)) / (1 - sf), y: (cy(far.tracked[key].b) - sf * cy(F)) / (1 - sf) } : null;
    for (const f of sameScroll) {
      const b = f.tracked[key].b;
      const s = sc(b);
      const px = o ? o.x + s * (cx(F) - o.x) : cx(F), py = o ? o.y + s * (cy(F) - o.y) : cy(F);
      const dx = cx(b) - px, dy = cy(b) - py;
      if (Math.hypot(dx, dy) > tolPx) out.push({ kind: 'drift', f, detail: `${key} انحرف ${dx.toFixed(1)},${dy.toFixed(1)}px عن الاندفاع (مقياس ${s.toFixed(3)})` });
      if (F[3] && Math.abs(b[3] - s * F[3]) > tolPx) out.push({ kind: 'aspect', f, detail: `${key} ارتفاعه ${b[3].toFixed(1)} والمتوقع ${(s * F[3]).toFixed(1)} (قص أو تمدد)` });
    }
  }
  return out;
}
