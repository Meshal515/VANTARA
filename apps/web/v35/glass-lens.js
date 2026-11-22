/**
 * عدسة Glass للشريط (نموذج v9 كما اعتمده المالك، 21 نوفمبر): دائرة 40 ترتفع إلى 78×60 عند الضغط، وتطير
 * قطرةً عند النقر وتهبط بارتجاجة، وتتبع الإصبع وتعبر بين الكبسولات، وتتشكل كبسولة القسم في المبدّل.
 * الأرقام من GLASS في glass.js (مقفلة). dock.js يبقى مالك الحالة والتنقل؛ هذه ترسم التحديد وتستقبل اللمس فقط.
 *
 * استثناء requestAnimationFrame (قرار المالك، الخطة 7.R5): الحلقة لا تقرأ التمرير ولا تُستدعى منه، وتكتب على
 * العدسة وطبقة أيقوناتها وحدهما، وتتوقف حين تستقر، وتثبت فورًا والشريط يغادر (inert)، وتقليل الحركة يجعلها فورية.
 */
import { GLASS, capFilters, noteSession } from './glass.js';

const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

export function createGlassLens({ bar, navs, sw, opts, centerOf, activePage = null, section = null, open = false, reduced = () => false, haptic = () => {}, colorOf = () => null, onCommit = () => {} }) {
  const doc = bar.ownerDocument, win = doc.defaultView ?? globalThis;
  const raf = (fn) => (win.requestAnimationFrame ?? globalThis.requestAnimationFrame)?.(fn) ?? 0;
  const caf = (id) => (win.cancelAnimationFrame ?? globalThis.cancelAnimationFrame)?.(id);
  const now = () => win.performance?.now?.() ?? Date.now();
  const caps = [...bar.querySelectorAll('.dock-cap')];
  const swCap = sw.closest('.dock-cap');
  const SECS = opts.map((o) => o.dataset.arg);

  // ── الطبقات: العدسة، والأيقونات فوقها (حادة دائمًا: الانكسار للخلفية لا للرسم، درس v6) ──
  const lens = doc.createElement('span');
  lens.className = 'g-lens';
  lens.setAttribute('aria-hidden', 'true');
  const host = doc.createElement('div');
  host.className = 'g-glyphs';
  host.setAttribute('aria-hidden', 'true');
  bar.append(lens, host);
  const items = [...navs, sw].map((n) => {
    const g = doc.createElement('span');
    g.className = n === sw ? 'g-glyph g-sw' : 'g-glyph';
    if (n === sw) g.innerHTML = sw.innerHTML;
    else {
      g.dataset.page = n.dataset.page;
      const svg = n.querySelector('svg');
      if (svg) g.append(svg.cloneNode(true));
    }
    host.append(g);
    return { n, g, gx: 0, gs: 1, amp: n === sw ? GLASS.switchLift : GLASS.glyphLift };
  });
  const swGlyph = items[items.length - 1].g;

  // ── الهندسة بإحداثيات الشريط نفسه (لا تتأثر بتصغيره) ──
  const scaleK = () => { const r = bar.getBoundingClientRect(); return (bar.offsetWidth && r.width / bar.offsetWidth) || 1; };
  const capCenter = (cap) => { const b = bar.getBoundingClientRect(), r = cap.getBoundingClientRect(); return (r.left - b.left + r.width / 2) / scaleK(); };
  const center = (n) => (n === sw ? capCenter(swCap) : centerOf(n));
  const navOf = (p) => navs.find((n) => n.dataset.page === p) ?? null;
  const localX = (e) => (e.clientX - bar.getBoundingClientRect().left) / scaleK();
  const nearest = (x) => navs.reduce((a, n) => (Math.abs(center(n) - x) < Math.abs(center(a) - x) ? n : a));
  const clampX = (x) => clamp(x, 30, bar.offsetWidth - 30);
  const secCenter = (i) => capCenter(opts[i].closest('.dock-cap'));
  const nearestSec = (x) => opts.reduce((a, _, i) => (Math.abs(secCenter(i) - x) < Math.abs(secCenter(a) - x) ? i : a), 0);
  const secRange = (x) => { const c = opts.map((_, i) => secCenter(i)); return clamp(x, Math.min(...c), Math.max(...c)); };

  // ── أربعة نوابض في إطار واحد (v9): الموضع، والارتفاع، والتمطط، والشكل ──
  let x = 0, v = 0, target = 0, pos = GLASS.pos.travel, lift = 0, lv = 0, st = 0, sv = 0, form = open ? 1 : 0, fv = 0;
  let frame = 0, lastT = 0, press = null, swPress = null, isOpen = open, sec = section, page = activePage;
  let nearNav = null, nearOpt = -1, pendingClose = 0, pickIdx = -1, shown = false, suppress = false, dts = [], lastY = 0;
  let geo = { ow: 100, oh: 48 };
  const formTarget = () => (isOpen ? 1 : 0);
  const step = (h) => {
    v += (pos.k * (target - x) - pos.c * v) * h;
    x += v * h;
    // الضغط والسحب: الحجم الكبير كاملًا. النقر: تطير قطرة متوسطة وتهبط
    const lt = press ? 1 : Math.abs(target - x) > GLASS.flightGap ? GLASS.flight : 0, ls = lt > lift ? GLASS.lift.up : GLASS.lift.down;
    lv += (ls.k * (lt - lift) - ls.c * lv) * h;
    lift += lv * h;
    sv += (GLASS.wobble.k * (Math.min(GLASS.stretchMax, Math.abs(v) * GLASS.stretchPerSpeed) - st) - GLASS.wobble.c * sv) * h;
    st += sv * h;
    fv += (GLASS.form.k * (formTarget() - form) - GLASS.form.c * fv) * h;
    form += fv * h;
  };
  const render = () => {
    const L = clamp(lift, -0.1, 1.08), l01 = clamp(L, 0, 1), s = clamp(st, -0.08, 0.26), f = clamp(form, -0.05, 1.05);
    const nw = (GLASS.rest + (GLASS.lifted.w - GLASS.rest) * L) * (1 + s), nh = (GLASS.rest + (GLASS.lifted.h - GLASS.rest) * L) * (1 - s * 0.5);
    const ow = (geo.ow + 8 * L) * (1 + s * 0.35), oh = (geo.oh + 4 * L) * (1 - s * 0.2);
    const w = nw + (ow - nw) * f, h = nh + (oh - nh) * f, ls = lens.style;
    // المتغيرات على العدسة وحدها (درس v8: على الشريط تضاعف حساب الأنماط)
    ls.setProperty('--lx', `${x.toFixed(2)}px`);
    ls.setProperty('--lw', `${w.toFixed(2)}px`);
    ls.setProperty('--lh', `${h.toFixed(2)}px`);
    ls.setProperty('--lift', l01.toFixed(3));
    ls.setProperty('--spec', `${(-45 + clamp(v / 45, -40, 40)).toFixed(1)}deg`);
    for (const it of items) {
      const p = Math.max(0, 1 - Math.abs(it.gx - x) / (w / 2 + 8)), gs = 1 + it.amp * l01 * (1 - clamp(f, 0, 1)) * p * p * (3 - 2 * p);
      if (Math.abs(gs - it.gs) > 0.002 || (gs === 1 && it.gs !== 1)) { it.gs = gs; it.g.style.setProperty('--gs', gs.toFixed(3)); }
    }
  };
  const settled = () => !press && Math.abs(target - x) < 0.3 && Math.abs(v) < 4 && Math.abs(lift) < 0.003 && Math.abs(lv) < 0.03 && Math.abs(st) < 0.002 && Math.abs(sv) < 0.03 && Math.abs(form - formTarget()) < 0.002 && Math.abs(fv) < 0.02;
  const tick = (t) => {
    const dt = Math.min(1 / 30, lastT ? (t - lastT) / 1000 : 1 / 60);
    if (lastT) dts.push(t - lastT);
    lastT = t;
    // تقليل الحركة، أو الشريط يغادر (dockOut يجعله inert): فوري بلا نوابض
    if (reduced() || bar.inert) { x = target; v = 0; lift = press ? 1 : 0; lv = 0; st = 0; sv = 0; form = formTarget(); fv = 0; }
    else for (let r = dt; r > 1e-6; r -= 1 / 240) step(Math.min(r, 1 / 240));
    // بعد اختيار قسم: العدسة تهبط عليه أولًا ثم يُختار فينغلق المبدّل
    if (pendingClose && t - pendingClose > GLASS.closeAfterMs && Math.abs(target - x) < GLASS.closeWithinPx) {
      pendingClose = 0;
      opts[pickIdx]?.click(); // نقرة برمجية (detail = 0) تمر إلى pickSection كما هي
    }
    if (settled()) {
      x = target; v = lift = lv = st = sv = fv = 0; form = formTarget();
      render();
      frame = 0; lastT = 0;
      if (dts.length) { noteSession(dts, { doc }); dts = []; }
      return;
    }
    render();
    frame = raf(tick);
  };
  const kick = () => { if (!frame) { lastT = 0; frame = raf(tick); } };

  // ── الحالة المرئية ──
  const syncGlyphs = () => items.forEach(({ n, g }) => g.classList.toggle('active', n !== sw && n.dataset.page === page));
  const setNear = (n) => { nearNav = n; items.forEach(({ n: m, g }) => g.classList.toggle('near', !!n && m === n)); };
  const tint = () => lens.style.setProperty('--tint', isOpen && nearOpt >= 0 ? (colorOf(SECS[nearOpt]) ?? 'var(--accent)') : 'var(--accent)');
  const setNearOpt = (i) => { nearOpt = i; opts.forEach((o, k) => o.classList.toggle('g-near', k === i)); tint(); };
  const colorOpts = () => opts.forEach((o) => { const c = colorOf(o.dataset.arg); if (c) o.style.setProperty('--sec', c); });
  const markSquares = () => swGlyph.querySelectorAll('.dock-sq').forEach((q) => q.classList.toggle('current', q.dataset.arg === sec));
  const layout = () => {
    items.forEach((it) => { it.gx = center(it.n); it.g.style.setProperty('--gx', `${it.gx}px`); });
    geo = { ow: (swCap?.offsetWidth ?? 110) - 10, oh: bar.offsetHeight - 10 };
  };
  const place = () => {
    const nav = page ? navOf(page) : null;
    lens.toggleAttribute('data-off', !nav && !isOpen);
    if (!bar.offsetWidth) { shown = false; return; }
    layout();
    const t = isOpen ? secCenter(Math.max(0, SECS.indexOf(sec))) : nav ? center(nav) : x;
    x = target = t; v = lift = lv = st = sv = fv = 0; form = formTarget();
    shown = !!(nav || isOpen);
    render();
  };

  // ── اللمس ──
  const releaseSw = () => { swPress = null; swCap?.classList.remove('g-press'); swGlyph.classList.remove('g-press'); };
  const onDown = (e) => {
    if (e.button > 0) return;
    bar.classList.remove('g-compact'); // المصغّر يكبر ويستجيب في اللمسة نفسها
    if (isOpen) {
      const o = e.target.closest?.('.dock-opt');
      const i = opts.indexOf(o);
      if (i < 0) return;
      press = { kind: 'opt', sx: e.clientX, id: e.pointerId, idx: i, moved: false };
      pos = GLASS.pos.travel; target = secCenter(i); setNearOpt(i); kick();
      return;
    }
    if (sw.contains(e.target)) {
      // زر زجاجي: ينتفخ ويضيء من نقطة اللمس، ومربعاته تنضغط. فتحه بنقرته كما هو (toggleSections)
      const r = swCap.getBoundingClientRect();
      swCap.style.setProperty('--px', `${(((e.clientX - r.left) / r.width) * 100).toFixed(1)}%`);
      swCap.style.setProperty('--py', `${(((e.clientY - r.top) / r.height) * 100).toFixed(1)}%`);
      swCap.classList.add('g-press');
      swGlyph.classList.add('g-press');
      swPress = { id: e.pointerId, sx: e.clientX, sy: e.clientY };
      return;
    }
    const btn = e.target.closest?.('.nav');
    if (!btn || !navs.includes(btn)) return;
    press = { kind: 'nav', sx: e.clientX, id: e.pointerId, btn, moved: false };
    pos = GLASS.pos.travel; target = center(btn); setNear(btn); kick();
  };
  const onMove = (e) => {
    if (swPress && e.pointerId === swPress.id && Math.hypot(e.clientX - swPress.sx, e.clientY - swPress.sy) > 14) releaseSw();
    if (!press || e.pointerId !== press.id) return;
    if (!press.moved && Math.abs(e.clientX - press.sx) > 8) {
      press.moved = true;
      pos = GLASS.pos.follow;
      try { bar.setPointerCapture?.(e.pointerId); } catch { /* اللمسة انتهت */ }
      if (press.kind === 'opt') bar.classList.add('g-dragging-sec');
    }
    if (!press.moved) return;
    if (press.kind === 'opt') {
      const lx = secRange(localX(e)), i = nearestSec(lx);
      target = lx;
      if (i !== nearOpt) { setNearOpt(i); haptic(); }
      kick();
      return;
    }
    target = clampX(localX(e));
    const n = nearest(target);
    if (n !== nearNav) { setNear(n); haptic(); }
    kick();
  };
  const onUp = (e) => {
    const cancel = e.type === 'pointercancel';
    if (swPress && e.pointerId === swPress.id) releaseSw();
    if (!press || e.pointerId !== press.id) return;
    const p = press;
    press = null; pos = GLASS.pos.travel; lv = Math.min(lv, 0); // لا يكمل الصعود بعد الترك
    if (p.kind === 'opt') {
      bar.classList.remove('g-dragging-sec');
      if (cancel) { setNearOpt(-1); target = secCenter(Math.max(0, SECS.indexOf(sec))); kick(); return; }
      const i = p.moved ? nearestSec(secRange(localX(e))) : p.idx;
      if (p.moved) { suppress = true; haptic(); }
      target = secCenter(i); setNearOpt(-1); pickIdx = i; pendingClose = now(); kick();
      return;
    }
    setNear(null);
    const nav = page ? navOf(page) : null;
    if (cancel) { if (nav) target = center(nav); kick(); return; }
    if (!p.moved) { kick(); return; } // نقرة: التنقل بنقرة الزر نفسها (navTo)، والعدسة تهبط عليه
    suppress = true; // سحب: النقرة التي تليه لا تُحتسب
    const dest = nearest(clampX(localX(e)));
    haptic();
    target = center(dest); kick();
    if (dest.dataset.page !== page) onCommit(dest.dataset.page);
  };
  const onClick = (e) => {
    if (suppress) { suppress = false; e.stopPropagation(); e.preventDefault(); return; }
    // نقرة قسم باللمس: يُختار بعد هبوط العدسة (pendingClose). لوحة المفاتيح (detail = 0) تمر فورًا
    if (isOpen && e.detail > 0 && e.target.closest?.('.dock-opt')) { e.stopPropagation(); e.preventDefault(); }
  };
  bar.addEventListener('pointerdown', onDown);
  bar.addEventListener('pointermove', onMove);
  bar.addEventListener('pointerup', onUp);
  bar.addEventListener('pointercancel', onUp);
  bar.addEventListener('click', onClick, true);
  let rT = 0;
  const ro = typeof win.ResizeObserver === 'function' ? new win.ResizeObserver(() => {
    if (press) return;
    place();
    clearTimeout(rT);
    rT = setTimeout(() => capFilters(caps, { doc }), 160);
  }) : null;
  ro?.observe(bar);
  const onTier = () => capFilters(caps, { doc });
  win.addEventListener?.('vantara:glass-tier', onTier);

  colorOpts(); markSquares(); syncGlyphs(); tint(); capFilters(caps, { doc }); place();

  return {
    /** الوجهة تغيّرت: تطير العدسة إليها (أول ظهور يوضع بلا حركة). */
    activate(p) {
      page = navOf(p) ? p : null;
      syncGlyphs();
      lens.toggleAttribute('data-off', !page && !isOpen);
      if (!page || isOpen || press) return;
      if (!shown || !bar.offsetWidth) return place();
      target = center(navOf(page)); pos = GLASS.pos.travel; kick();
    },
    /** المبدّل فُتح أو أُغلق: العدسة تتشكل كبسولة القسم أو ترجع دائرة لزرها. */
    setOpen(o) {
      if (o === isOpen) return;
      isOpen = o; pendingClose = 0; setNearOpt(-1); colorOpts();
      if (o) bar.classList.remove('g-compact');
      const nav = page ? navOf(page) : null;
      lens.toggleAttribute('data-off', !nav && !o);
      if (o) target = secCenter(Math.max(0, SECS.indexOf(sec)));
      else if (nav) target = center(nav);
      pos = GLASS.pos.travel; kick();
    },
    setSection(id) { sec = id; markSquares(); colorOpts(); tint(); },
    /**
     * shell يستدعيها بعد كل ظهور صفحة: كالدائرة الحالية، تُوضع بلا حركة فقط إن لم تظهر بعد، أو `force` بعد تغيّر
     * عرض الشريط. وإلا فالطيران الجاري (activate) يكمل كما هو: لا قفزة تقطع نوابض v9.
     */
    repaint(p = page, force = false) {
      page = navOf(p) ? p : null;
      syncGlyphs();
      if (force || !shown || !bar.offsetWidth) place();
    },
    /** حالة التصغير بالاتجاه (v9): لتحت يصغر، لفوق يكبر. حالة صنف وانتقال CSS، لا حركة إطار بإطار. */
    scrolled(y) {
      const d = y - lastY;
      lastY = y;
      if (isOpen || press) return;
      if (y < 24 || d < -6) bar.classList.remove('g-compact');
      else if (d > 4) bar.classList.add('g-compact');
    },
    destroy() {
      if (frame) caf(frame);
      frame = 0;
      ro?.disconnect();
      clearTimeout(rT);
      win.removeEventListener?.('vantara:glass-tier', onTier);
      bar.removeEventListener('pointerdown', onDown);
      bar.removeEventListener('pointermove', onMove);
      bar.removeEventListener('pointerup', onUp);
      bar.removeEventListener('pointercancel', onUp);
      bar.removeEventListener('click', onClick, true);
      lens.remove();
      host.remove();
      bar.classList.remove('g-compact', 'g-dragging-sec');
      swCap?.classList.remove('g-press');
      for (const o of opts) { o.classList.remove('g-near'); o.style.removeProperty('--sec'); }
      for (const c of caps) c.style.removeProperty('--g-cap-f');
    },
  };
}
