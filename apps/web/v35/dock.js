/**
 * الشريط العائم: أربع وجهات ومبدّل الأقسام في قلبه، وانتقال الأقسام كطبقات.
 *
 * الأقسام ثلاث طبقات ثابتة الترتيب: السينما فوق، ثم الأنمي، ثم المانجا في القاع.
 * الصعود لطبقة أعلى يُدخلها من اليسار فوق الحالية، والحالية تنزاح 22% يمينًا وتعتم.
 * النزول يسحب الطبقة الحالية لليسار فيكشف ما تحتها. القفز بين المانجا والسينما حركة
 * واحدة لا يظهر فيها الأنمي. كل الحركة transform وopacity على مؤقت واحد قابل للمقاطعة:
 * اختيار جديد في منتصف الحركة يكمل من موضعه، بلا قفزة ولا تراكم.
 *
 * المؤقت يُكمل نفسه بمهلة احتياطية: إن توقف rAF في WebView لا تبقى طبقة معلّقة.
 */

export const ORDER = ['manga', 'anime', 'cinema'];
export const T = { open: 260, close: 220, enter: 380, exit: 320, reduced: 120 };
export const SHIFT = 22;
export const DIM = 0.55;

/** منحنى cubic-bezier كدالة زمن ← تقدّم (حل نيوتن ثم تنصيف عند الحاجة). */
export function bezier(x1, y1, x2, y2) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const X = (t) => ((ax * t + bx) * t + cx) * t;
  const Y = (t) => ((ay * t + by) * t + cy) * t;
  const dX = (t) => (3 * ax * t + 2 * bx) * t + cx;
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i++) {
      const err = X(t) - x;
      if (Math.abs(err) < 1e-6) return Y(t);
      const d = dX(t);
      if (Math.abs(d) < 1e-6) break;
      t -= err / d;
    }
    let lo = 0, hi = 1;
    t = x;
    for (let i = 0; i < 30; i++) {
      const v = X(t);
      if (Math.abs(v - x) < 1e-6) break;
      if (v < x) lo = t;
      else hi = t;
      t = (lo + hi) / 2;
    }
    return Y(t);
  };
}
export const easeOut = bezier(0.16, 1, 0.3, 1);
export const easeInOut = bezier(0.4, 0, 0.2, 1);
const linear = (x) => x;
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const rank = (id) => ORDER.indexOf(id);

/** الطبقة المجاورة في اتجاه (+1 للأعلى، -1 للأسفل)، أو null عند الطرف. */
export function adjacent(id, step) {
  return ORDER[rank(id) + step] ?? null;
}

/** حركة الانتقال بين قسمين: الاتجاه ومدته ومنحناه، ومن يظهر فيه فقط. */
export function layerPlan(from, to) {
  const up = rank(to) > rank(from);
  return { up, duration: up ? T.enter : T.exit, ease: up ? easeOut : easeInOut, shown: [from, to] };
}

/**
 * لقطة الطبقات: لكل طبقة ظاهرة «تغطيتها» (0 خارج الشاشة يسارًا، 1 في مكانها).
 * إزاحة الطبقة وتعتيمها من أعلى طبقة فوقها؛ الظل على الحافة للطبقة التي تتحرك.
 */
export function layerFrame(cover) {
  const ids = ORDER.filter((id) => id in cover);
  const out = {};
  ids.forEach((id, i) => {
    const c = clamp(cover[id]);
    const above = ids.slice(i + 1).reduce((m, a) => Math.max(m, clamp(cover[a])), 0);
    out[id] = {
      x: -(1 - c) * 100 + SHIFT * above,
      dim: DIM * above,
      edge: c > 0 && c < 1 ? Math.min(1, (1 - c) * 8) : 0,
      z: i + 1,
    };
  });
  return out;
}

/** التغطية التي ينتهي إليها الانتقال إلى `to` من الطبقات الظاهرة الآن. */
export function targetCover(cover, to) {
  const next = {};
  for (const id of Object.keys(cover)) next[id] = rank(id) > rank(to) ? 0 : cover[id];
  next[to] = 1;
  return next;
}

/** طبقة جديدة تدخل اللقطة: فوق الكل تبدأ خارج الشاشة، وتحت الكل تبدأ في مكانها. */
export function admit(cover, to) {
  if (to in cover) return { ...cover };
  const ranks = Object.keys(cover).map(rank);
  const start = ranks.length && rank(to) < Math.min(...ranks) ? 1 : 0;
  return { ...cover, [to]: start };
}

/** القسم الظاهر فعلًا: أعلى طبقة مكتملة التغطية. */
export function settledSection(cover) {
  return ORDER.filter((id) => (cover[id] ?? 0) >= 1).pop() ?? ORDER.find((id) => id in cover);
}

/** هندسة المبدّل: مربعات 10px في المنتصف، وثلاثة أزرار بعرض الشريط عند الفتح (من اليمين). */
export function optionRects(width, height, centerX, p) {
  const e = clamp(p);
  // الشريط 56: الأزرار 44 بهامش 6 من كل جهة (مقاس الشريط المرجعي)
  const sq = 10, gap = 5, pad = 6, between = 6, tall = 44;
  const pw = (width - 2 * pad - 2 * between) / 3;
  return ORDER.map((id, i) => {
    const compactLeft = centerX + (1 - i) * (sq + gap) - sq / 2;
    const openLeft = width - pad - pw - i * (pw + between);
    const w = sq + (pw - sq) * e;
    const h = sq + (tall - sq) * e;
    return {
      id,
      left: compactLeft + (openLeft - compactLeft) * e,
      top: (height - h) / 2,
      width: w,
      height: h,
      radius: 3 + (tall / 2 - 3) * e,
      label: clamp((e - 0.55) / 0.45),
    };
  });
}

/** مؤقت واحد قابل للإلغاء، يكمل نفسه بمهلة احتياطية. */
export function tween({ duration, ease = linear, update, done, raf = globalThis.requestAnimationFrame?.bind(globalThis), now = () => globalThis.performance?.now?.() ?? Date.now(), timer = globalThis.setTimeout?.bind(globalThis), clear = globalThis.clearTimeout?.bind(globalThis) }) {
  let live = true;
  const start = now();
  const finish = () => {
    if (!live) return;
    live = false;
    clear?.(guard);
    update(1, 1);
    done?.();
  };
  const step = () => {
    if (!live) return;
    const t = duration > 0 ? clamp((now() - start) / duration) : 1;
    if (t >= 1) return finish();
    update(ease(t), t);
    raf?.(step);
  };
  const guard = timer?.(finish, duration + 120);
  if (!raf || duration <= 0) finish();
  else raf(step);
  return {
    cancel() {
      live = false;
      clear?.(guard);
    },
    finish,
  };
}

/** اهتزاز خفيف عبر Capacitor إن وُجد، وإلا اهتزاز المتصفح؛ بلا أثر حيث لا يدعمان. */
export function haptic(kind = 'light') {
  try {
    const h = globalThis.Capacitor?.Plugins?.Haptics;
    if (h?.impact) return void h.impact({ style: kind === 'medium' ? 'MEDIUM' : 'LIGHT' }).catch?.(() => {});
    if (h?.selectionChanged) return void h.selectionChanged();
    globalThis.navigator?.vibrate?.(kind === 'medium' ? 12 : 6);
  } catch {
    // الاهتزاز تجميل فقط
  }
}

const isReduced = () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/**
 * طبقات الأقسام فوق رئيسياتها. `views` رئيسية كل قسم، و`host` الصفحة التي تحويها.
 * `onProgress({from,to,e})` يُبلّغ كل إطار (لتبديل اسم القسم تحت الشعار معه).
 */
export function createLayers({ views, host, current, onProgress, onSettle, reduced = isReduced, timing = {} }) {
  let section = current;
  let cover = null; // null = لا انتقال جارٍ
  let start = null, goal = null, motion = null, label = null;
  let offsets = {};

  const paint = (e) => {
    const now = {};
    for (const id of Object.keys(goal)) now[id] = start[id] + (goal[id] - start[id]) * e;
    cover = now;
    if (reduced()) {
      for (const id of Object.keys(now)) {
        const v = views[id];
        v.style.transform = offsets[id] ? `translate3d(0,${offsets[id]}px,0)` : '';
        v.style.zIndex = id === label.to ? '3' : '1';
        v.style.opacity = id === label.to ? String(e) : '1';
      }
    } else {
      const frame = layerFrame(now);
      for (const [id, f] of Object.entries(frame)) {
        const v = views[id];
        v.style.transform = `translate3d(${f.x.toFixed(3)}%,${offsets[id] ?? 0}px,0)`;
        v.style.zIndex = String(f.z);
        v.style.opacity = '';
        const dim = v.querySelector(':scope > .layer-dim');
        if (dim) dim.style.opacity = f.dim.toFixed(3);
        const edge = v.querySelector(':scope > .layer-edge');
        if (edge) edge.style.opacity = f.edge.toFixed(3);
      }
    }
    onProgress?.({ from: label.from, to: label.to, e });
  };

  const mount = (id) => {
    const v = views[id];
    v.hidden = false;
    if (!v.querySelector(':scope > .layer-dim')) {
      const dim = document.createElement('div');
      dim.className = 'layer-dim';
      dim.setAttribute('aria-hidden', 'true');
      const edge = document.createElement('div');
      edge.className = 'layer-edge';
      edge.setAttribute('aria-hidden', 'true');
      v.append(dim, edge);
    }
  };

  const enterLayering = () => {
    const top = views[section].offsetTop || 0;
    const scrollY = globalThis.scrollY || 0;
    host.style.minHeight = `${Math.max(host.offsetHeight || 0, globalThis.innerHeight || 0)}px`;
    host.style.setProperty('--layer-top', `${top}px`);
    host.classList.add('layering');
    offsets = scrollY > 0 ? { [section]: -scrollY } : {};
    if (scrollY > 0) globalThis.scrollTo?.({ top: 0, behavior: 'instant' });
  };

  const settle = () => {
    const shown = settledSection(cover);
    for (const [id, v] of Object.entries(views)) {
      v.hidden = id !== shown;
      v.style.transform = '';
      v.style.zIndex = '';
      v.style.opacity = '';
      v.querySelectorAll(':scope > .layer-dim, :scope > .layer-edge').forEach((n) => n.remove());
    }
    host.classList.remove('layering');
    host.style.removeProperty('min-height');
    host.style.removeProperty('--layer-top');
    const from = section;
    section = shown;
    cover = start = goal = motion = label = null;
    offsets = {};
    onProgress?.({ from: shown, to: shown, e: 1 });
    onSettle?.(shown, from);
  };

  /** ابدأ (أو أعِد توجيه) انتقالًا نحو `to` بلا مؤقت؛ يُرجع اللقطة الجديدة. */
  const aim = (to) => {
    motion?.cancel();
    motion = null;
    if (!cover) {
      enterLayering();
      cover = { [section]: 1 };
    }
    // اسم القسم: من الأوضح ظهورًا الآن إلى الهدف
    const shownWord = label ? (label.e >= 0.5 ? label.to : label.from) : section;
    label = { from: shownWord, to, e: 0 };
    cover = admit(cover, to);
    mount(to);
    start = { ...cover };
    goal = targetCover(cover, to);
  };

  const run = (duration, ease, from = 0, to = 1, done = settle) => {
    const span = Math.abs(to - from);
    const ms = reduced() ? (timing.reduced ?? T.reduced) * span : duration * Math.max(0.35, span);
    motion = tween({
      duration: ms,
      ease: reduced() ? linear : ease,
      update: (k) => {
        const e = from + (to - from) * k;
        if (label) label.e = e;
        paint(e);
      },
      done,
    });
  };

  return {
    get section() { return section; },
    get moving() { return Boolean(cover); },
    /** انتقل إلى قسم؛ مقاطعة الحركة الجارية تكمل من موضعها. */
    go(to) {
      if (!views[to]) return;
      if (!cover && to === section) return;
      const topBefore = cover ? Math.max(...Object.keys(cover).map(rank)) : rank(section);
      aim(to);
      const up = rank(to) > topBefore || (rank(to) === topBefore && start[to] < 1);
      const plan = up ? { duration: timing.enter ?? T.enter, ease: easeOut } : { duration: timing.exit ?? T.exit, ease: easeInOut };
      const delta = Math.max(...Object.keys(goal).map((id) => Math.abs(goal[id] - start[id])));
      run(plan.duration * Math.max(delta, 0.35), plan.ease);
    },
    /** سحب بالإصبع: يثبّت الهدف ثم يتبع التقدّم 0..1. */
    drag(to, p) {
      if (!views[to]) return;
      if (!label || label.to !== to) aim(to);
      motion?.cancel();
      motion = null;
      label.e = clamp(p);
      paint(clamp(p));
    },
    /** إفلات: يكمل للهدف، أو يرجع بلطف لما كان. */
    release(commit) {
      if (!label) return;
      const e = label.e;
      if (commit) run(goal[label.to] > start[label.to] ? T.enter : T.exit, easeOut, e, 1);
      else run(T.exit, easeOut, e, 0);
    },
    /** قسم تغيّر من خارج المبدّل (فتح عمل من إضافة): لا حركة، فقط الحالة. */
    sync(id) {
      if (!cover && views[id]) section = id;
    },
    /** أنهِ فورًا (اختبارات، أو مغادرة الصفحة). */
    finish() {
      if (motion) motion.finish();
      else if (cover) settle();
    },
  };
}

/**
 * اسم القسم تحت الشعار: الحالي يتلاشى في نصف الحركة الأول صاعدًا 4px،
 * والجديد يظهر في النصف الثاني من 4px تحت مكانه.
 */
export function createCrossfade(slot) {
  const make = () => {
    const s = document.createElement('span');
    s.className = 'brand-word';
    return s;
  };
  const a = slot.querySelector('.brand-word') ?? slot.appendChild(make());
  const b = make();
  b.setAttribute('aria-hidden', 'true');
  b.style.opacity = '0';
  slot.append(b);
  return {
    set(fromText, toText, e) {
      if (e >= 1 || fromText === toText) {
        a.textContent = toText;
        a.style.opacity = '';
        a.style.transform = '';
        b.style.opacity = '0';
        b.style.transform = '';
        return;
      }
      const out = clamp(e * 2);
      const inn = clamp(e * 2 - 1);
      a.textContent = fromText;
      b.textContent = toText;
      a.style.opacity = String(1 - out);
      a.style.transform = `translateY(${(-4 * out).toFixed(2)}px)`;
      b.style.opacity = String(inn);
      b.style.transform = `translateY(${(4 * (1 - inn)).toFixed(2)}px)`;
    },
  };
}

/**
 * المبدّل: يفتح المربعات الثلاثة إلى أزرار بعرض الشريط، ويُغلق بالمس خارجًا أو على
 * القسم الحالي أو Esc أو رجوع أندرويد. السحب الأفقي عليه ينقل للقسم المجاور.
 */
export function createDock({ bar, scrim, current, onDragStart, onDrag, onDragEnd, reduced = isReduced }) {
  const sw = bar.querySelector('.dock-switch');
  const halves = [...bar.querySelectorAll('.dock-half')];
  const options = bar.querySelector('.dock-options');
  const opts = [...options.querySelectorAll('.dock-opt')];
  let p = 0, motion = null, open = false, section = current, dragged = false;

  const geometry = () => {
    // الأزرار مطلقة داخل صندوق الحشو: بلا الحد
    const box = bar.getBoundingClientRect();
    const s = sw.getBoundingClientRect();
    return { w: bar.clientWidth || box.width, h: bar.clientHeight || box.height, cx: s.left - box.left - (bar.clientLeft || 0) + s.width / 2 };
  };
  const paint = (k) => {
    p = k;
    const g = geometry();
    const rects = optionRects(g.w, g.h, g.cx, k);
    rects.forEach((r, i) => {
      const o = opts[i];
      o.style.transform = `translate3d(${r.left.toFixed(2)}px,${r.top.toFixed(2)}px,0)`;
      o.style.width = `${r.width.toFixed(2)}px`;
      o.style.height = `${r.height.toFixed(2)}px`;
      o.style.borderRadius = `${r.radius.toFixed(2)}px`;
      o.style.setProperty('--label', r.label.toFixed(3));
    });
    for (const h of halves) {
      h.style.opacity = String(1 - k);
      h.style.transform = `scale(${(1 - 0.15 * k).toFixed(4)})`;
    }
    sw.style.opacity = k > 0 ? '0' : '';
    scrim.style.opacity = String(k);
  };
  const mark = () => {
    for (const o of opts) {
      const on = o.dataset.arg === section;
      o.setAttribute('aria-checked', String(on));
      o.classList.toggle('current', on);
    }
    bar.dataset.section = section;
    const word = { manga: 'مانجا', anime: 'أنمي', cinema: 'سينما' }[section] ?? section;
    sw.setAttribute('aria-label', `القسم الحالي: ${word}. بدّل القسم`);
  };

  const animate = (to) => {
    motion?.cancel();
    const from = p;
    const dur = to ? T.open : T.close;
    const span = Math.abs(to - from);
    // الإغلاق يوقف لمس الستار فورًا لا بعد انتهاء تلاشيه: لمسة ثانية لا تعيد الفتح
    scrim.style.pointerEvents = to ? '' : 'none';
    if (to) {
      scrim.hidden = false;
      bar.classList.add('open');
    }
    motion = tween({
      duration: reduced() ? T.reduced * span : dur * span,
      ease: reduced() ? linear : to ? easeOut : easeInOut,
      update: (k) => paint(from + (to - from) * k),
      done: () => {
        motion = null;
        if (!to) {
          scrim.hidden = true;
          bar.classList.remove('open');
          for (const o of opts) o.removeAttribute('style');
          for (const h of halves) h.removeAttribute('style');
          sw.style.opacity = '';
          paintClosed();
        }
      },
    });
  };
  // المغلق يرسم المربعات بلا مؤقت (ومع كل تغيير مقاس)
  const paintClosed = () => {
    if (open || motion) return;
    paint(0);
    for (const h of halves) h.removeAttribute('style');
    sw.style.opacity = '';
  };

  const setOpen = (next, { focus = true } = {}) => {
    if (next === open) return;
    open = next;
    sw.setAttribute('aria-expanded', String(open));
    options.toggleAttribute('inert', !open);
    options.setAttribute('aria-hidden', String(!open));
    for (const h of halves) h.toggleAttribute('inert', open);
    for (const o of opts) o.setAttribute('tabindex', open && o.dataset.arg === section ? '0' : '-1');
    if (open) haptic();
    animate(open ? 1 : 0);
    if (focus) (open ? opts.find((o) => o.dataset.arg === section) : sw)?.focus?.({ preventScroll: true });
  };

  // لوحة المفاتيح داخل الأزرار المفتوحة: الأسهم بين الأقسام (يمين = السابق في RTL)
  options.addEventListener('keydown', (e) => {
    const i = opts.indexOf(document.activeElement);
    if (i < 0) return;
    const step = { ArrowLeft: 1, ArrowRight: -1, ArrowDown: 1, ArrowUp: -1 }[e.key];
    let j = null;
    if (step) j = (i + step + opts.length) % opts.length;
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = opts.length - 1;
    else if (e.key === 'Tab') {
      e.preventDefault();
      j = (i + (e.shiftKey ? -1 : 1) + opts.length) % opts.length;
    }
    if (j == null) return;
    e.preventDefault();
    opts.forEach((o, k) => o.setAttribute('tabindex', k === j ? '0' : '-1'));
    opts[j].focus();
  });

  // السحب الأفقي على المبدّل (منطقته الممتدة): الصفحة تتبع الإصبع
  let drag = null;
  sw.addEventListener('pointerdown', (e) => {
    if (open || e.button > 0) return;
    drag = { x: e.clientX, y: e.clientY, t: e.timeStamp, id: e.pointerId, to: null, track: [] };
    dragged = false;
  });
  sw.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.to) {
      if (Math.abs(dx) < 10 || Math.abs(dx) < Math.abs(dy) * 1.2) return;
      const to = adjacent(section, dx > 0 ? 1 : -1);
      if (!to) return;
      drag.to = to;
      drag.dir = Math.sign(dx);
      dragged = true;
      sw.setPointerCapture?.(e.pointerId);
      onDragStart?.(to);
    }
    drag.track.push([e.timeStamp, dx]);
    if (drag.track.length > 6) drag.track.shift();
    const width = globalThis.innerWidth || bar.getBoundingClientRect().width || 360;
    drag.progress = clamp((dx * drag.dir) / (width * 0.9));
    onDrag?.(drag.to, drag.progress);
  });
  const end = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    if (!d.to) return;
    const [t0, x0] = d.track[0] ?? [d.t, 0];
    const [t1, x1] = d.track[d.track.length - 1] ?? [e.timeStamp, 0];
    const v = t1 > t0 ? ((x1 - x0) * d.dir) / (t1 - t0) : 0;
    const commit = e.type !== 'pointercancel' && ((d.progress ?? 0) > 0.32 || v > 0.45);
    if (commit) haptic();
    onDragEnd?.(d.to, commit);
  };
  sw.addEventListener('pointerup', end);
  sw.addEventListener('pointercancel', end);

  globalThis.addEventListener?.('resize', paintClosed);
  mark();
  paintClosed();

  return {
    isOpen: () => open,
    toggle: () => setOpen(!open),
    open: () => setOpen(true),
    close: (o) => setOpen(false, o),
    /** النقرة بعد سحب ليست فتحًا للمبدّل. */
    consumeDrag() {
      const was = dragged;
      dragged = false;
      return was;
    },
    setSection(id) {
      section = id;
      mark();
    },
    repaint: paintClosed,
  };
}
