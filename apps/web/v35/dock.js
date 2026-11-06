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
// خفيف لا ثقيل: إزاحة وتعتيم قليلان، بلا ظل حافة، ومدد أقصر (رأي المالك: «ثقيل و3D»)
export const T = { open: 240, close: 200, enter: 300, exit: 260, reduced: 120 };
export const SHIFT = 8;
export const DIM = 0.18;

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
      edge: 0,
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
const cssEase = { out: 'cubic-bezier(0.16, 1, 0.3, 1)', inOut: 'cubic-bezier(0.4, 0, 0.2, 1)', linear: 'linear' };
const clockNow = () => globalThis.performance?.now?.() ?? Date.now();
const SAMPLES = 7;

/**
 * محرّك حركة واحد بلغة الإطارات: `frameAt(e)` يعيد لكل عنصر خصائصه (transform وopacity فقط)
 * عند تقدّم e. حيث تتوفر Web Animations تُبنى الحركة إطارات مفتاحية تُسلَّم للمركّب (GPU):
 * تجري بمعدّل الشاشة (120Hz) ولا تتأثر بانشغال الخيط الرئيسي برسم قسم أو صفحة.
 * وحيث لا تتوفر (اختبارات) تُرسم بالمؤقت. التقدّم الحالي يُحسب بالزمن والمنحنى نفسيهما،
 * فالمقاطعة تبدأ من الموضع الفعلي بلا قراءة من الشاشة.
 */
function drive({ frameAt, e0 = 0, e1 = 1, duration, ease = easeOut, easing = cssEase.out, done }) {
  const els = [...frameAt(e0).keys()];
  const waapi = els.length > 0 && els.every((el) => typeof el.animate === 'function');
  const t0 = clockNow();
  let live = true, anims = [], fallback = null, guard = null;
  const at = () => e0 + (e1 - e0) * ease(clamp(duration > 0 ? (clockNow() - t0) / duration : 1));
  const apply = (frame) => {
    for (const [el, style] of frame) for (const [k, v] of Object.entries(style)) el.style[k] = v;
  };
  const stop = (e) => {
    apply(frameAt(e)); // الخاصية المضمّنة أولًا ثم إلغاء الحركة: لا وميض بينهما
    for (const a of anims) a.cancel();
    anims = [];
    fallback?.cancel();
    clearTimeout(guard);
  };
  const finish = () => {
    if (!live) return;
    live = false;
    stop(e1);
    done?.();
  };
  if (duration <= 0) {
    finish();
  } else if (waapi) {
    const frames = Array.from({ length: SAMPLES }, (_, i) => frameAt(e0 + ((e1 - e0) * i) / (SAMPLES - 1)));
    for (const el of els) {
      const keys = frames.map((f, i) => ({ ...f.get(el), offset: i / (SAMPLES - 1) }));
      const same = keys.every((k) => Object.keys(k).every((p) => p === 'offset' || k[p] === keys[0][p]));
      if (same) {
        apply(new Map([[el, frames[0].get(el)]]));
        continue;
      }
      anims.push(el.animate(keys, { duration, easing, fill: 'both' }));
    }
    if (anims.length) anims[0].onfinish = finish;
    guard = setTimeout(finish, duration + 150); // إن توقف المؤقت في WebView لا تبقى حركة معلّقة
    if (!anims.length) finish();
  } else {
    fallback = tween({ duration, ease, update: (k) => live && apply(frameAt(e0 + (e1 - e0) * k)), done: finish });
  }
  return {
    /** أوقف الآن وثبّت الموضع الحالي؛ يعيد التقدّم الذي وصلته. */
    halt() {
      if (!live) return e1;
      live = false;
      const e = at();
      stop(e);
      return e;
    },
    finish,
    get progress() { return live ? at() : e1; },
    get live() { return live; },
  };
}

/**
 * طبقات الأقسام فوق رئيسياتها. `views` رئيسية كل قسم، و`host` الصفحة التي تحويها،
 * و`label` خانة اسم القسم تحت الشعار (يتبدّل مع الحركة)، و`wordOf(id)` نصه.
 */
export function createLayers({ views, host, current, label, wordOf = (id) => id.toUpperCase(), onSettle, reduced = isReduced, timing = {} }) {
  let section = current;
  let cover = null; // null = لا انتقال جارٍ
  let start = null, goal = null, motion = null, words = null;
  let offsets = {};
  let standby = false;
  const fade = label ?? null;

  const dimOf = (v) => v.querySelector(':scope > .layer-dim');
  const edgeOf = (v) => v.querySelector(':scope > .layer-edge');

  /** خصائص كل عنصر عند تقدّم e من start إلى goal. */
  const frameAt = (e) => {
    const out = new Map();
    const now = {};
    for (const id of Object.keys(goal)) now[id] = start[id] + (goal[id] - start[id]) * e;
    if (reduced()) {
      for (const id of Object.keys(now)) {
        out.set(views[id], { transform: `translate3d(0,${offsets[id] ?? 0}px,0)`, opacity: id === words.to ? String(e) : '1' });
      }
    } else {
      for (const [id, f] of Object.entries(layerFrame(now))) {
        out.set(views[id], { transform: `translate3d(${f.x.toFixed(3)}%,${offsets[id] ?? 0}px,0)`, opacity: '1' });
        const dim = dimOf(views[id]);
        if (dim) out.set(dim, { opacity: f.dim.toFixed(3) });
        const edge = edgeOf(views[id]);
        if (edge) out.set(edge, { opacity: f.edge.toFixed(3) });
      }
    }
    if (fade) for (const [el, s] of fade.frame(wordOf(words.from), wordOf(words.to), e)) out.set(el, s);
    return out;
  };
  const coverAt = (e) => {
    const now = {};
    for (const id of Object.keys(goal)) now[id] = start[id] + (goal[id] - start[id]) * e;
    return now;
  };

  const mount = (id) => {
    const v = views[id];
    v.classList.remove('layer-standby');
    v.hidden = false;
    if (!dimOf(v)) {
      const dim = document.createElement('div');
      dim.className = 'layer-dim';
      dim.setAttribute('aria-hidden', 'true');
      const edge = document.createElement('div');
      edge.className = 'layer-edge';
      edge.setAttribute('aria-hidden', 'true');
      v.append(dim, edge);
    }
  };
  const order = () => {
    const ids = ORDER.filter((id) => id in cover);
    ids.forEach((id, i) => (views[id].style.zIndex = String(i + 1)));
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

  const dropStandby = () => {
    if (!standby) return;
    standby = false;
    for (const [id, v] of Object.entries(views)) {
      if (v.classList.contains('layer-standby')) {
        v.classList.remove('layer-standby');
        if (id !== section) v.hidden = true;
      }
    }
    if (!cover) host.classList.remove('layer-ready');
  };

  const settle = () => {
    const shown = settledSection(cover);
    for (const [id, v] of Object.entries(views)) {
      v.hidden = id !== shown;
      v.classList.remove('layer-standby');
      v.style.transform = '';
      v.style.zIndex = '';
      v.style.opacity = '';
      v.querySelectorAll(':scope > .layer-dim, :scope > .layer-edge').forEach((n) => n.remove());
    }
    standby = false;
    host.classList.remove('layering', 'layer-ready');
    host.style.removeProperty('min-height');
    host.style.removeProperty('--layer-top');
    const from = section;
    section = shown;
    cover = start = goal = motion = words = null;
    offsets = {};
    fade?.rest(wordOf(shown));
    onSettle?.(shown, from);
  };

  /** ثبّت هدفًا جديدًا من الموضع الحالي (توقف الحركة الجارية حيث هي). */
  const aim = (to) => {
    let shownWord = section;
    if (motion) {
      const e = motion.halt();
      cover = coverAt(e);
      shownWord = e >= 0.5 ? words.to : words.from;
    } else if (words) {
      shownWord = words.e >= 0.5 ? words.to : words.from;
    }
    motion = null;
    if (!cover) {
      enterLayering();
      cover = { [section]: 1 };
    }
    words = { from: shownWord, to, e: 0 };
    cover = admit(cover, to);
    mount(to);
    order();
    start = { ...cover };
    goal = targetCover(cover, to);
  };

  const run = (duration, ease, easing, from = 0, to = 1) => {
    const span = Math.abs(to - from);
    const r = reduced();
    const m = drive({
      frameAt: (e) => {
        if (words) words.e = e;
        return frameAt(e);
      },
      e0: from,
      e1: to,
      duration: r ? (timing.reduced ?? T.reduced) * span : duration * Math.max(0.35, span),
      ease: r ? linear : ease,
      easing: r ? cssEase.linear : easing,
      done: () => {
        cover = coverAt(to);
        settle();
      },
    });
    if (m.live) motion = m;
  };

  return {
    get section() { return section; },
    get moving() { return Boolean(cover); },
    /**
     * جهّز الأقسام الأخرى قبل الاختيار (عند فتح المبدّل أو لمسه): تُبنى وتُرسم وهي مخفية
     * خارج الشاشة، فلا يدفع الانتقال كلفة أول رسم في إطاره الأول.
     */
    prepare() {
      if (cover || standby) return;
      standby = true;
      host.classList.add('layer-ready');
      host.style.setProperty('--layer-top', `${views[section].offsetTop || 0}px`);
      for (const [id, v] of Object.entries(views)) {
        if (id === section) continue;
        v.classList.add('layer-standby');
        v.hidden = false;
      }
    },
    /** لم يُختر شيء: أعِد الأقسام المجهّزة لنومها. */
    unprepare: () => dropStandby(),
    /** انتقل إلى قسم؛ مقاطعة الحركة الجارية تكمل من موضعها. */
    go(to) {
      if (!views[to]) return;
      if (!cover && to === section) return dropStandby();
      const topBefore = cover ? Math.max(...Object.keys(cover).map(rank)) : rank(section);
      aim(to);
      const up = rank(to) > topBefore || (rank(to) === topBefore && start[to] < 1);
      const delta = Math.max(...Object.keys(goal).map((id) => Math.abs(goal[id] - start[id])));
      if (up) run((timing.enter ?? T.enter) * Math.max(delta, 0.35), easeOut, cssEase.out);
      else run((timing.exit ?? T.exit) * Math.max(delta, 0.35), easeInOut, cssEase.inOut);
      dropStandby();
    },
    /** سحب بالإصبع: يثبّت الهدف ثم يتبع التقدّم 0..1. */
    drag(to, p) {
      if (!views[to]) return;
      if (!words || words.to !== to || motion) aim(to);
      const e = clamp(p);
      words.e = e;
      for (const [el, style] of frameAt(e)) for (const [k, v] of Object.entries(style)) el.style[k] = v;
    },
    /** إفلات: يكمل للهدف، أو يرجع بلطف لما كان. */
    release(commit) {
      if (!words) return dropStandby();
      const e = words.e;
      if (commit) run(T.enter, easeOut, cssEase.out, e, 1);
      else run(T.exit, easeOut, cssEase.out, e, 0);
    },
    /** قسم تغيّر من خارج المبدّل (فتح عمل من إضافة): لا حركة، فقط الحالة. */
    sync(id) {
      if (!cover && views[id]) section = id;
    },
    /** أنهِ فورًا (اختبارات، أو مغادرة الصفحة). */
    finish() {
      if (motion) motion.finish();
      else if (cover) settle();
      dropStandby();
    },
  };
}

/**
 * اسم القسم تحت الشعار: الحالي يتلاشى في نصف الحركة الأول صاعدًا 4px،
 * والجديد يظهر في النصف الثاني من 4px تحت مكانه. يعطي خصائص الإطار لـ createLayers.
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
    /** خصائص الكلمتين عند e (للحركة المركّبة). */
    frame(fromText, toText, e) {
      if (a.textContent !== fromText) a.textContent = fromText;
      if (b.textContent !== toText) b.textContent = toText;
      const out = clamp(e * 2);
      const inn = clamp(e * 2 - 1);
      return new Map([
        [a, { opacity: String(1 - out), transform: `translateY(${(-4 * out).toFixed(2)}px)` }],
        [b, { opacity: String(inn), transform: `translateY(${(4 * (1 - inn)).toFixed(2)}px)` }],
      ]);
    },
    /** الحالة الساكنة: كلمة واحدة في مكانها. */
    rest(text) {
      a.textContent = text;
      a.style.opacity = '';
      a.style.transform = '';
      b.style.opacity = '0';
      b.style.transform = '';
    },
  };
}

/**
 * المبدّل: يفتح المربعات الثلاثة إلى أزرار بعرض الشريط، ويُغلق بالمس خارجًا أو على
 * القسم الحالي أو Esc أو رجوع أندرويد. السحب الأفقي عليه ينقل للقسم المجاور.
 * الأزرار بمقاسها المفتوح دائمًا، وتُصغَّر بـ transform إلى مكان المربعات: الحركة كلها
 * transform وopacity على المركّب، بلا تغيير مقاس أو تخطيط في أي إطار.
 */
export function createDock({ bar, scrim, current, onPrepare, onClose, onDragStart, onDrag, onDragEnd, reduced = isReduced }) {
  const sw = bar.querySelector('.dock-switch');
  const halves = [...bar.querySelectorAll('.dock-half')];
  const options = bar.querySelector('.dock-options');
  const opts = [...options.querySelectorAll('.dock-opt')];
  const labels = [...options.querySelectorAll('.dock-opt-label')];
  const squares = [...sw.querySelectorAll('.dock-sq')];
  let p = 0, motion = null, open = false, section = current, dragged = false, geo = null;

  const geometry = () => {
    // الأزرار مطلقة داخل صندوق الحشو: بلا الحد
    const box = bar.getBoundingClientRect();
    const s = sw.getBoundingClientRect();
    return { w: bar.clientWidth || box.width, h: bar.clientHeight || box.height, cx: s.left - box.left - (bar.clientLeft || 0) + s.width / 2 };
  };
  /** ضع الأزرار والأسماء بمقاسها المفتوح مرة واحدة؛ الإطارات بعدها transform فقط. */
  const layout = () => {
    const g = geometry();
    const full = optionRects(g.w, g.h, g.cx, 1);
    const compact = optionRects(g.w, g.h, g.cx, 0);
    geo = { full, compact };
    full.forEach((r, i) => {
      for (const el of [opts[i], labels[i]]) {
        if (!el) continue;
        el.style.left = `${r.left.toFixed(2)}px`;
        el.style.top = `${r.top.toFixed(2)}px`;
        el.style.width = `${r.width.toFixed(2)}px`;
        el.style.height = `${r.height.toFixed(2)}px`;
      }
    });
  };
  const frameAt = (k) => {
    if (!geo) layout();
    const out = new Map();
    const e = clamp(k);
    geo.full.forEach((f, i) => {
      const c = geo.compact[i];
      const left = c.left + (f.left - c.left) * e;
      const top = c.top + (f.top - c.top) * e;
      const w = c.width + (f.width - c.width) * e;
      const h = c.height + (f.height - c.height) * e;
      out.set(opts[i], {
        transform: `translate3d(${(left - f.left).toFixed(2)}px,${(top - f.top).toFixed(2)}px,0) scale(${(w / f.width).toFixed(4)},${(h / f.height).toFixed(4)})`,
        opacity: clamp(e * 4).toFixed(3),
      });
      const l = clamp((e - 0.55) / 0.45);
      if (labels[i]) out.set(labels[i], { opacity: l.toFixed(3), transform: `translate3d(0,${((1 - l) * 4).toFixed(2)}px,0)` });
    });
    for (const s of squares) out.set(s, { opacity: (1 - clamp(e * 4)).toFixed(3) });
    for (const h of halves) out.set(h, { opacity: (1 - e).toFixed(3), transform: `scale(${(1 - 0.15 * e).toFixed(4)})` });
    out.set(scrim, { opacity: e.toFixed(3) });
    return out;
  };
  const clearInline = () => {
    for (const el of [...opts, ...labels, ...squares, ...halves]) {
      el.style.transform = '';
      el.style.opacity = '';
    }
  };
  const mark = () => {
    for (const o of opts) {
      const on = o.dataset.arg === section;
      o.setAttribute('aria-checked', String(on));
      o.classList.toggle('current', on);
    }
    for (const el of [...labels, ...squares]) el.classList.toggle('current', el.dataset.arg === section);
    bar.dataset.section = section;
    const word = { manga: 'مانجا', anime: 'أنمي', cinema: 'سينما' }[section] ?? section;
    sw.setAttribute('aria-label', `القسم الحالي: ${word}. بدّل القسم`);
  };

  const animate = (to) => {
    const from = motion ? motion.halt() : p;
    motion = null;
    if (!geo || from === 0) layout();
    // الإغلاق يوقف لمس الستار فورًا لا بعد انتهاء تلاشيه: لمسة ثانية لا تعيد الفتح
    scrim.style.pointerEvents = to ? '' : 'none';
    if (to) {
      scrim.hidden = false;
      bar.classList.add('open');
    }
    const span = Math.abs(to - from);
    const r = reduced();
    const m = drive({
      frameAt: (k) => ((p = k), frameAt(k)),
      e0: from,
      e1: to,
      duration: (r ? T.reduced : to ? T.open : T.close) * span,
      ease: r ? linear : to ? easeOut : easeInOut,
      easing: r ? cssEase.linear : to ? cssEase.out : cssEase.inOut,
      done: () => {
        motion = null;
        p = to;
        if (!to) {
          scrim.hidden = true;
          scrim.style.opacity = '';
          bar.classList.remove('open');
          clearInline();
        }
      },
    });
    if (m.live) motion = m;
  };

  const setOpen = (next, { focus = true, instant = false } = {}) => {
    if (next === open) return;
    open = next;
    sw.setAttribute('aria-expanded', String(open));
    options.toggleAttribute('inert', !open);
    options.setAttribute('aria-hidden', String(!open));
    for (const h of halves) h.toggleAttribute('inert', open);
    for (const o of opts) o.setAttribute('tabindex', open && o.dataset.arg === section ? '0' : '-1');
    if (open) {
      haptic();
      onPrepare?.();
    }
    animate(open ? 1 : 0);
    // الشريط يختفي مع صفحة فرعية: لا حركة إغلاق لشيء لا يُرى، والستار يزول فورًا
    if (instant) motion?.finish();
    if (!open) onClose?.();
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
    else if (e.key === 'Tab') j = (i + (e.shiftKey ? -1 : 1) + opts.length) % opts.length;
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
    onPrepare?.(); // اللمس وحده يكفي لتجهيز الأقسام قبل أن يبدأ السحب
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
    if (!d.to) return onDragEnd?.(null, false);
    const [t0, x0] = d.track[0] ?? [d.t, 0];
    const [t1, x1] = d.track[d.track.length - 1] ?? [e.timeStamp, 0];
    const v = t1 > t0 ? ((x1 - x0) * d.dir) / (t1 - t0) : 0;
    const commit = e.type !== 'pointercancel' && ((d.progress ?? 0) > 0.32 || v > 0.45);
    if (commit) haptic();
    onDragEnd?.(d.to, commit);
  };
  sw.addEventListener('pointerup', end);
  sw.addEventListener('pointercancel', end);

  globalThis.addEventListener?.('resize', () => {
    geo = null;
    if (open && !motion) {
      layout();
      for (const [el, style] of frameAt(1)) for (const [k, v] of Object.entries(style)) el.style[k] = v;
    }
  });
  mark();

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
    repaint() {
      if (!motion) geo = null;
    },
  };
}
