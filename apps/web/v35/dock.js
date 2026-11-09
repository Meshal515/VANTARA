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
/** اسم القسم بالعربية لقارئ الشاشة (sections.js محمي بحارس النطاق، فلا يُضاف إليه). */
const AR_NAMES = { manga: 'مانجا', anime: 'أنمي', cinema: 'سينما' };
// خفيف لا ثقيل: إزاحة وتعتيم قليلان، بلا ظل حافة، ومدد أقصر (رأي المالك: «ثقيل و3D»)
// الأقسام: 420 صعودًا و380 نزولًا (رأي المالك: أسرع من أن تُرى)
export const T = { open: 240, close: 200, enter: 430, exit: 430, travel: 380, reduced: 120 };
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
/** الذهاب والرجوع بمنحنى واحد متناظر وتسارع خفيف: الحركة نفسها بالعكس. */
export const easeSwap = bezier(0.32, 0, 0.24, 1);
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
  return { up, duration: T.enter, ease: easeSwap, shown: [from, to] };
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


/**
 * فيزياء الحبّة الزجاجية: نابض بكتلة وسرعة (لا منحنى ثابت). يبدأ من موضع وسرعة
 * حاليين — فالضغطة الجديدة في منتصف الحركة تكمل من حيث الحبّة وبسرعتها — ويستقر
 * عند الهدف بتجاوز صغير. الوحدات px وms. يعيد عيّنات {t,x,v} كل 8ms حتى الاستقرار.
 */
export function springPath(x0, v0, x1, { omega = 0.019, zeta = 0.78, step = 8, max = 1000 } = {}) {
  const out = [{ t: 0, x: x0, v: v0 }];
  let x = x0, v = v0, t = 0;
  const sub = 4, dt = step / sub;
  while (t < max) {
    for (let i = 0; i < sub; i++) {
      const a = -2 * zeta * omega * v - omega * omega * (x - x1);
      v += a * dt;
      x += v * dt;
    }
    t += step;
    out.push({ t, x, v });
    if (Math.abs(x - x1) < 0.15 && Math.abs(v) < 0.004) break;
  }
  out[out.length - 1] = { t, x: x1, v: 0 };
  return out;
}
/** موضع وسرعة الحبّة في مسار عند زمن مضى. */
export function sampleAt(path, t) {
  if (t <= 0) return path[0];
  const last = path[path.length - 1];
  if (t >= last.t) return last;
  const i = path.findIndex((s) => s.t >= t);
  const a = path[i - 1], b = path[i];
  const k = (t - a.t) / (b.t - a.t);
  return { t, x: a.x + (b.x - a.x) * k, v: a.v + (b.v - a.v) * k };
}
/** تمطّط الحبّة باتجاه حركتها بقدر سرعتها، وتنضغط عموديًا بالقدر نفسه تقريبًا (حجم ثابت). */
export function stretchOf(v) {
  const sx = 1 + Math.min(0.42, Math.abs(v) * 0.17);
  return { sx, sy: 1 / Math.sqrt(sx) };
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

/**
 * إيقاف الحركة: إعداد النظام «تقليل الحركة»، أو إعداد التطبيق (<html data-motion="off">).
 * يعني انتقالًا فوريًا نظيفًا بلا أي مدة، لا حركة أخف ولا انتظارًا يعوّضها.
 */
export const isReduced = () =>
  globalThis.document?.documentElement?.dataset?.motion === 'off' ||
  (globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
const cssEase = { swap: 'cubic-bezier(0.32, 0, 0.24, 1)', out: 'cubic-bezier(0.16, 1, 0.3, 1)', inOut: 'cubic-bezier(0.4, 0, 0.2, 1)', linear: 'linear' };
const clockNow = () => globalThis.performance?.now?.() ?? Date.now();
const SAMPLES = 7;

/**
 * محرّك حركة واحد بلغة الإطارات: `frameAt(e)` يعيد لكل عنصر خصائصه (transform وopacity فقط)
 * عند تقدّم e. حيث تتوفر Web Animations تُبنى الحركة إطارات مفتاحية تُسلَّم للمركّب (GPU):
 * تجري بمعدّل الشاشة (120Hz) ولا تتأثر بانشغال الخيط الرئيسي برسم قسم أو صفحة.
 * وحيث لا تتوفر (اختبارات) تُرسم بالمؤقت. التقدّم الحالي يُحسب بالزمن والمنحنى نفسيهما،
 * فالمقاطعة تبدأ من الموضع الفعلي بلا قراءة من الشاشة.
 */
function drive({ frameAt, e0 = 0, e1 = 1, duration, ease = easeOut, easing = cssEase.out, done, samples = SAMPLES }) {
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
    const frames = Array.from({ length: samples }, (_, i) => frameAt(e0 + ((e1 - e0) * i) / (samples - 1)));
    for (const el of els) {
      const keys = frames.map((f, i) => ({ ...f.get(el), offset: i / (samples - 1) }));
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
  let pageViews = null, restorePage = null, queued = null, pageDrag = null;
  const viewOf = (id) => (pageViews ?? views)[id];
  const fade = label ?? null;
  // The brand stays visible at Home's top, preserving the existing section-name crossfade.
  // Only a scrolled section fades the whole lockup while the next home enters.
  const brand = host.querySelector?.(':scope > .header .brand-lockup');
  let brandScrollFade = false;
  let brandStartOpacity = 1;

  const dimOf = (v) => v.querySelector(':scope > .layer-dim');

  /** خصائص كل عنصر عند تقدّم e من start إلى goal. */
  const frameAt = (e) => {
    const out = new Map();
    const now = {};
    for (const id of Object.keys(goal)) now[id] = start[id] + (goal[id] - start[id]) * e;
    if (reduced()) {
      for (const id of Object.keys(now)) {
        out.set(viewOf(id), { transform: `translate3d(0,${offsets[id] ?? 0}px,0)`, opacity: id === words.to ? String(e) : '1' });
      }
    } else {
      for (const [id, f] of Object.entries(layerFrame(now))) {
        out.set(viewOf(id), { transform: `translate3d(${f.x.toFixed(3)}%,${offsets[id] ?? 0}px,0)`, opacity: '1' });
        const dim = dimOf(viewOf(id));
        if (dim) out.set(dim, { opacity: f.dim.toFixed(3) });
      }
    }
    if (fade) for (const [el, s] of fade.frame(wordOf(words.from), wordOf(words.to), e)) out.set(el, s);
    if (brandScrollFade && brand) {
      // Fade out early, remain invisible as the section identity changes, fade in late.
      const opacity = e < 0.34
        ? brandStartOpacity * (1 - Math.max(0, e) / 0.34)
        : e > 0.66 ? Math.min(1, (e - 0.66) / 0.34) : 0;
      out.set(brand, { opacity: opacity.toFixed(3) });
    }
    return out;
  };
  const coverAt = (e) => {
    const now = {};
    for (const id of Object.keys(goal)) now[id] = start[id] + (goal[id] - start[id]) * e;
    return now;
  };

  const mount = (id) => {
    const v = viewOf(id);
    v.classList.remove('layer-standby');
    v.hidden = false;
    if (!dimOf(v)) {
      const dim = document.createElement('div');
      dim.className = 'layer-dim';
      dim.setAttribute('aria-hidden', 'true');
      v.append(dim);
    }
  };
  const order = () => {
    const ids = ORDER.filter((id) => id in cover);
    ids.forEach((id, i) => (viewOf(id).style.zIndex = String(i + 1)));
  };

  /**
   * الطبقات بارتفاع الشاشة لا بطول الصفحة: طبقة بآلاف البكسلات يرسمها كرت الشاشة صورة ضخمة
   * لكل إطار (إطار واحد في الثانية على الجهاز). موضع القارئ يُحفظ داخل طبقته (scrollTop)،
   * ويُستعاد للصفحة إن رجع للقسم نفسه.
   */
  let savedScroll = 0;
  const scrolls = {}; // موضع القارئ في كل قسم
  // موضع الصفحة بدقة كسرية: offsetTop يقرّب لعدد صحيح، والترويسة بالمساحة الآمنة كسرية (بكسل أو اثنان)
  // ويُقاس من أسفل الترويسة لا من موضع الصفحة الحالية: هامش أول عنصر في صفحة (6px في المانجا) يتسرّب
  // خارجها في التدفق العادي، فموضع صفحة لا يصلح لغيرها؛ والحشوة تبقي هامش كل صفحة داخلها هي
  const topOf = (v) => {
    const header = host.querySelector?.(':scope > .header');
    const h = host.getBoundingClientRect?.();
    const r = (header ?? v).getBoundingClientRect?.();
    if (!r || !h || !(r.height || r.top || h.top)) return v.offsetTop || 0;
    
if (header && globalThis.getComputedStyle?.(header)?.position === 'fixed') {
  return r.bottom;
}
return (header ? r.bottom : r.top) - h.top;

  };
  const enterLayering = () => {
    if (pageViews) return;
    const top = topOf(views[section]);
    const scrollY = globalThis.scrollY || 0;
    savedScroll = scrollY;
    scrolls[section] = scrollY;
    brandScrollFade = scrollY > 8;
    brandStartOpacity = 1;
    host.style.minHeight = `${globalThis.innerHeight || 0}px`;
    host.style.setProperty('--layer-top', `${top}px`);
    host.classList.add('layering');
    offsets = {};
    if (scrollY > 0) {
      globalThis.scrollTo?.({ top: 0, behavior: 'instant' });
      views[section].scrollTop = scrollY; // الحشوة بارتفاع الترويسة: المحتوى في موضعه نفسه على الشاشة
    }
  };

  const dropStandby = () => {
    if (!standby) return;
    standby = false;
    for (const v of Object.values(views)) v.classList.remove('layer-standby');
    if (!cover) host.classList.remove('layer-ready');
  };

  const settle = () => {
    const shown = settledSection(cover);
    for (const [id, v] of Object.entries(views)) {
      v.hidden = id !== shown;
      v.classList.remove('layer-standby');
      v.scrollTop = 0;
      v.style.transform = '';
      v.style.zIndex = '';
      v.style.opacity = '';
      v.querySelectorAll(':scope > .layer-dim').forEach((n) => n.remove());
    }
    restorePage?.();
    restorePage = pageViews = null;
    standby = false;
    host.classList.remove('layering', 'layer-ready');
    host.style.removeProperty('min-height');
    host.style.removeProperty('--layer-top');
    const from = section;
    section = shown;
    cover = start = goal = motion = words = null;
    offsets = {};
    fade?.rest(wordOf(shown));
    if (brand) brand.style.opacity = '';
    brandScrollFade = false;
    brandStartOpacity = 1;
    // رجع للقسم نفسه (سحب أُلغي أو اختيار عُكس): يعود القارئ لموضعه
    const back = shown === from ? savedScroll : scrolls[shown] ?? 0;
    if (back > 0) globalThis.scrollTo?.({ top: back, behavior: 'instant' });
    savedScroll = 0;
    onSettle?.(shown, from);
    const next = queued;
    queued = null;
    if (next && next !== shown) api.go(next);
  };

  /** ثبّت هدفًا جديدًا من الموضع الحالي (توقف الحركة الجارية حيث هي). */
  const aim = (to) => {
    let shownWord = section;
    if (motion) {
      const e = motion.halt();
      cover = coverAt(e);
      if (brandScrollFade && brand) brandStartOpacity = Number(brand.style.opacity) || 0;
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
      duration: r ? 0 : duration * Math.max(0.35, span), // إيقاف الحركة: فوري تمامًا
      ease: r ? linear : ease,
      easing: r ? cssEase.linear : easing,
      done: () => {
        cover = coverAt(to);
        settle();
      },
    });
    if (m.live) motion = m;
  };

  const api = {
    get section() { return section; },
    get moving() { return Boolean(cover || pageDrag); },
    /** القسم الذي تتجه إليه الحركة الجارية (أو null). */
    get target() { return words?.to ?? null; },
    /**
     * جهّز الأقسام الأخرى قبل الاختيار (عند فتح المبدّل أو لمسه): تُبنى وتُرسم وهي مخفية
     * خارج الشاشة، فلا يدفع الانتقال كلفة أول رسم في إطاره الأول.
     */
    prepare() {
      if (cover || standby) return;
      standby = true;
      host.classList.add('layer-ready');
      host.style.setProperty('--layer-top', `${topOf(views[section])}px`);
      // تبقى hidden في نظر بقية الكود (البانر لا يدور، والتحميل لا يظن أنها ظاهرة)؛ CSS يخطّطها
      for (const [id, v] of Object.entries(views)) {
        if (id === section) continue;
        v.classList.add('layer-standby');
      }
    },
    /** لم يُختر شيء: أعِد الأقسام المجهّزة لنومها. */
    unprepare: () => dropStandby(),
    /** انتقل إلى قسم؛ مقاطعة الحركة الجارية تكمل من موضعها. */
    go(to, { outgoing = null, scrollY = 0 } = {}) {
      if (!views[to]) return;
      pageDrag = null;
      // The same layer model owns this transition. Rapid choices keep only
      // the latest destination; never snap the outgoing document away.
      if (pageViews) { queued = to; return; }
      if (outgoing && to !== section && !reduced()) {
        const previous = { style: outgoing.getAttribute('style'), home: outgoing.getAttribute('data-home'), scroll: outgoing.scrollTop };
        const css = globalThis.getComputedStyle?.(outgoing);
        if (css) {
          for (const name of css) if (name.startsWith('--')) outgoing.style.setProperty(name, css.getPropertyValue(name));
          const color = css.backgroundColor === 'rgba(0, 0, 0, 0)'
            ? globalThis.getComputedStyle(outgoing.closest('.app')).backgroundColor : css.backgroundColor;
          outgoing.style.backgroundColor = color;
        }
        outgoing.dataset.home = section; // its content keeps the old section identity
        outgoing.classList.add('page-leaving');
        host.classList.add('section-page-layer');
        outgoing.scrollTop = Math.max(0, scrollY);
        pageViews = { [section]: outgoing, [to]: host };
        restorePage = () => {
          for (const node of [outgoing, host]) {
            node.querySelectorAll(':scope > .layer-dim').forEach(n => n.remove());
            node.style.transform = ''; node.style.zIndex = ''; node.style.opacity = '';
          }
          outgoing.classList.remove('page-leaving');
          host.classList.remove('section-page-layer');
          host.scrollTop = 0;
          if (previous.style === null) outgoing.removeAttribute('style'); else outgoing.setAttribute('style', previous.style);
          if (previous.home === null) delete outgoing.dataset.home; else outgoing.dataset.home = previous.home;
          outgoing.scrollTop = previous.scroll;
        };
      }
      if (!cover && to === section) return dropStandby();
      if (pageViews) mount(section);
      const topBefore = cover ? Math.max(...Object.keys(cover).map(rank)) : rank(section);
      aim(to);
      const up = rank(to) > topBefore || (rank(to) === topBefore && start[to] < 1);
      const delta = Math.max(...Object.keys(goal).map((id) => Math.abs(goal[id] - start[id])));
      if (pageViews) host.scrollTop = scrolls[to] ?? 0;
      else if (scrolls[to] != null) views[to].scrollTop = scrolls[to]; // القسم يدخل بموضع قارئه
      run((up ? timing.enter ?? T.enter : timing.exit ?? T.exit) * Math.max(delta, 0.35), easeSwap, cssEase.swap);
      dropStandby();
    },
    /** سحب بالإصبع: يثبّت الهدف ثم يتبع التقدّم 0..1. */
    drag(to, p) {
      if (!views[to]) return;
      if (pageViews || pageDrag) { pageDrag = to; return; }
      if (!words || words.to !== to || motion) aim(to);
      const e = clamp(p);
      words.e = e;
      for (const [el, style] of frameAt(e)) for (const [k, v] of Object.entries(style)) el.style[k] = v;
    },
    /** إفلات: يكمل للهدف، أو يرجع بلطف لما كان. */
    release(commit) {
      if (pageDrag) {
        const to = pageDrag; pageDrag = null;
        if (commit) api.go(to);
        return;
      }
      if (!words) return dropStandby();
      const e = words.e;
      run(commit ? T.enter : T.exit, easeSwap, cssEase.swap, e, commit ? 1 : 0);
    },
    /** قسم تغيّر من خارج المبدّل (فتح عمل من إضافة): لا حركة، فقط الحالة. */
    sync(id) {
      if (!cover && views[id]) section = id;
    },
    /** أنهِ فورًا (اختبارات، أو مغادرة الصفحة). */
    finish() {
      queued = pageDrag = null;
      if (motion) motion.finish();
      else if (cover) settle();
      dropStandby();
    },
  };
  return api;
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
 * الشريط المقسوم: ثلاث كبسولات عائمة مستقلة متساوية.
 *   اليمنى: الرئيسية واكتشف · الوسطى: مبدّل الأقسام · اليسرى: مكتبتي والأصدقاء.
 *
 * المؤشر دائرة داخل كل كبسولة تنقّل، لا يغادرها ولا يمر فوق المبدّل أبدًا:
 *   - داخل الكبسولة: تنزلق بنابض (springPath) وتتمطّط بسرعتها، وتُسحب بالإصبع.
 *   - بين الكبسولتين: تنكمش القديمة وتتلاشى في مكانها، والجديدة تكبر في مكانها، والكبر
 *     يبدأ قبل نهاية الانكماش فتُقرأ حركة واحدة منتقلة لا اختفاءً ثم ظهورًا.
 * المبدّل: الكبسولات نفسها تتحول إلى المانجا والأنمي والسينما، طبقات تنفتح من المنتصف
 * للخارج: «مانجا» تنزلق من اليسار إلى اليمين، و«سينما» من اليمين إلى اليسار، و«أنمي»
 * تحل محل المربعات في مكانها. كل الحركة transform وopacity على المركّب.
 * ومن أوقف الحركة: كل شيء فوري، بلا أي مدة.
 */
export function createDock({ bar, scrim, current, onPrepare, onClose, onDragStart, onDrag, onDragEnd, onNavigate, reduced = isReduced }) {
  const sw = bar.querySelector('.dock-switch');
  const caps = [...bar.querySelectorAll('.dock-cap--nav')];
  const opts = [...bar.querySelectorAll('.dock-opt')];
  const squares = [...sw.querySelectorAll('.dock-sq')];
  const navs = [...bar.querySelectorAll('.dock-cap--nav .nav')];
  const capOf = (page) => caps.find((c) => c.querySelector(`.nav[data-page="${page}"]`)) ?? null;
  // توحيد المحتوى: الشريط سطح واحد متصل، ومؤشر واحد على مستواه ينزلق بين الوجهات الأربع
  // (بدل «انكماش هنا وكبر هناك» الذي صُمّم للكبسولات المنفصلة)
  let barInd = bar.querySelector(':scope > .dock-ind');
  if (!barInd && bar.ownerDocument) {
    barInd = bar.ownerDocument.createElement('span');
    barInd.className = 'dock-ind';
    barInd.setAttribute('aria-hidden', 'true');
    bar.prepend(barInd);
  }
  const unified = () => Boolean(bar.closest?.('[data-content="unified"]'));
  const indOf = (cap) => (cap === bar ? barInd : cap?.querySelector('.cap-ind') ?? null);
  let open = false, section = current, dragged = false, activePage = null;
  const indState = new Map(); // cap → { x, anims, path, start }

  const anim = (el, keys, opts) => (typeof el?.animate === 'function' ? el.animate(keys, opts) : null);
  const still = () => reduced();

  // ── المؤشر ───────────────────────────────────────────────
  /**
   * مركز الحبر المرسوم في الأيقونة لا مركز صندوقها: البيت مثلًا رسمه أدنى من مركز مربعه. يُحسب بوحدات
   * التخطيط (لا يتأثر بتحويلات المبدّل المفتوح)، مع إزاحة المحاذاة البصرية لكل أيقونة (--ox/--oy/--os).
   */
  const inkOffset = (nav) => {
    const svg = nav.querySelector?.('svg');
    const bb = svg?.getBBox?.();
    const vb = svg?.viewBox?.baseVal;
    if (!bb || !vb?.width || !svg.clientWidth) return [0, 0];
    const cs = getComputedStyle(svg);
    const os = parseFloat(cs.getPropertyValue('--os')) || 1;
    const k = (svg.clientWidth / vb.width) * os;
    return [
      (bb.x + bb.width / 2 - (vb.x + vb.width / 2)) * k + (parseFloat(cs.getPropertyValue('--ox')) || 0),
      (bb.y + bb.height / 2 - (vb.y + vb.height / 2)) * k + (parseFloat(cs.getPropertyValue('--oy')) || 0),
    ];
  };
  const slotCenter = (nav) => {
    // بدقة كسرية (offsetLeft يقرّب لعدد صحيح فتنزاح الحلقة نصف بكسل)، وبإلغاء تحجيم الجسم أثناء فتح المبدّل
    const body = nav.parentElement;
    if (nav.offsetWidth && body?.offsetWidth) {
      const b = body.getBoundingClientRect();
      const r = nav.getBoundingClientRect();
      const k = b.width / body.offsetWidth || 1;
      return (r.left - b.left + r.width / 2) / k + inkOffset(nav)[0];
    }
    const cap = nav.closest('.dock-cap');
    const c = cap.getBoundingClientRect();
    const r = nav.getBoundingClientRect();
    return r.left - c.left - (cap.clientLeft || 0) + r.width / 2;
  };
  /** مركز الوجهة على مستوى الشريط كله (للمؤشر الواحد في توحيد المحتوى). */
  const barCenter = (nav) => {
    const b = bar.getBoundingClientRect();
    const r = nav.getBoundingClientRect();
    // الشريط قد يكون مصغّرًا لحظة القياس (حركة الدمج/الفصل scale 0.94): القياس بوحدات التخطيط لا الشاشة،
    // وإلا وقعت الدائرة خارج مركز الأيقونة بعد التبديل بين الموحد والعادي
    const k = (bar.offsetWidth && b.width / bar.offsetWidth) || 1;
    return (r.left - b.left + r.width / 2) / k + inkOffset(nav)[0];
  };
  /** مجال المؤشر: الشريط كله في التوحيد، وإلا كبسولة الوجهة. */
  const zoneOf = (page) => (unified() ? bar : capOf(page));
  const centerIn = (zone, nav) => (zone === bar ? barCenter(nav) : slotCenter(nav));
  const slotsIn = (zone) => (zone === bar ? navs : [...zone.querySelectorAll('.nav')]);
  const IND = 40;
  const indTransform = (x, v = 0, s = 1, maxSx = Infinity) => {
    let { sx, sy } = stretchOf(v);
    if (sx > maxSx) (sx = Math.max(1, maxSx)), (sy = 1 / Math.sqrt(sx));
    return `translate3d(${(x - IND / 2).toFixed(2)}px,0,0) scale(${(sx * s).toFixed(4)},${(sy * s).toFixed(4)})`;
  };
  const stateOf = (cap) => {
    if (!indState.has(cap)) indState.set(cap, { x: null, anims: [], path: null, start: 0, shown: false });
    return indState.get(cap);
  };
  /** أوقف حركة مؤشر كبسولة حيث هو الآن؛ يعيد موضعه وسرعته. */
  const haltInd = (cap) => {
    const st = stateOf(cap);
    let now = null;
    if (st.path) now = sampleAt(st.path, clockNow() - st.start);
    for (const a of st.anims) a.cancel?.();
    st.anims = [];
    st.path = null;
    if (now) {
      st.x = now.x;
      indOf(cap).style.transform = indTransform(now.x, now.v);
    }
    return now;
  };
  const showInd = (cap, x, { scale = 1, opacity = 1 } = {}) => {
    const ind = indOf(cap);
    const st = stateOf(cap);
    st.x = x;
    st.shown = opacity > 0;
    ind.style.transform = indTransform(x, 0, scale);
    ind.style.opacity = String(opacity);
  };
  /** انزلاق داخل الكبسولة بنابض، يكمل من الموضع والسرعة الحاليين. */
  const slide = (cap, x1, v0 = 0) => {
    const st = stateOf(cap);
    const now = haltInd(cap);
    const x0 = now?.x ?? st.x ?? x1;
    const v = now?.v ?? v0;
    showInd(cap, x1);
    if (still() || (Math.abs(x1 - x0) < 0.5 && Math.abs(v) < 0.01)) return;
    const path = springPath(x0, v, x1, { omega: 0.024, zeta: 0.82 });
    const total = path[path.length - 1].t;
    const a = anim(indOf(cap), path.map((p) => ({ offset: p.t / total, transform: indTransform(p.x, p.v) })), { duration: total, easing: 'linear' });
    if (a) {
      st.anims = [a];
      st.path = path;
      st.start = clockNow();
      a.onfinish = () => { st.anims = []; st.path = null; };
    }
  };
  /** بين الكبسولتين: انكماش هنا وكبر هناك، متداخلان في الزمن. */
  const hop = (fromCap, toCap, x1) => {
    const from = stateOf(fromCap);
    haltInd(fromCap);
    haltInd(toCap);
    const fx = from.x;
    // الحالة النهائية مضمّنة أولًا؛ الحركة فوقها فلا يبقى شيء معلّق إن توقفت
    showInd(fromCap, fx ?? 0, { opacity: 0, scale: 0.4 });
    showInd(toCap, x1);
    if (still() || fx == null) return;
    const a1 = anim(indOf(fromCap), [
      { transform: indTransform(fx), opacity: 1 },
      { transform: indTransform(fx, 0, 0.4), opacity: 0 },
    ], { duration: 200, easing: 'cubic-bezier(0.4, 0, 1, 1)' });
    const a2 = anim(indOf(toCap), [
      { transform: indTransform(x1, 0, 0.4), opacity: 0 },
      { transform: indTransform(x1, 0, 1.04), opacity: 1, offset: 0.72 },
      { transform: indTransform(x1), opacity: 1 },
    ], { duration: 320, delay: 80, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)', fill: 'backwards' });
    if (a1) stateOf(fromCap).anims = [a1];
    if (a2) stateOf(toCap).anims = [a2];
  };
  const moveIndicator = (page) => {
    const nav = navs.find((n) => n.dataset.page === page);
    if (unified() && barInd) {
      activePage = nav ? page : null;
      for (const c of caps) {
        haltInd(c);
        indOf(c).style.opacity = '0';
        stateOf(c).shown = false;
      }
      if (!nav) {
        haltInd(bar);
        barInd.style.opacity = '0';
        stateOf(bar).shown = false;
        return;
      }
      barInd.style.top = `calc(50% - 20px + ${inkOffset(nav)[1].toFixed(2)}px)`;
      const x1 = barCenter(nav);
      // أول ظهور يوضع بلا حركة؛ بعده انزلاق بنابض من الموضع والسرعة الحاليين، مهما بعدت الوجهة
      if (!stateOf(bar).shown) showInd(bar, x1);
      else slide(bar, x1, pendingV);
      pendingV = 0;
      return;
    }
    if (barInd && stateOf(bar).shown) {
      haltInd(bar);
      barInd.style.opacity = '0';
      stateOf(bar).shown = false;
    }
    const toCap = nav ? capOf(page) : null;
    const fromCap = activePage ? capOf(activePage) : null;
    activePage = nav ? page : null;
    if (!toCap) {
      // صفحة بلا زر (الإعدادات): لا مؤشر في أي كبسولة
      for (const c of caps) {
        haltInd(c);
        indOf(c).style.opacity = '0';
        stateOf(c).shown = false;
      }
      return;
    }
    const x1 = slotCenter(nav);
    indOf(toCap).style.top = `calc(50% - 20px + ${inkOffset(nav)[1].toFixed(2)}px)`;
    if (!fromCap || !stateOf(fromCap).shown) {
      for (const c of caps) if (c !== toCap) (indOf(c).style.opacity = '0'), (stateOf(c).shown = false);
      return showInd(toCap, x1);
    }
    if (fromCap === toCap) slide(toCap, x1, pendingV);
    else hop(fromCap, toCap, x1);
    pendingV = 0;
  };
  let pendingV = 0;

  // ── المبدّل: الكبسولات تتحول إلى الأقسام ─────────────────
  const mark = () => {
    for (const o of opts) {
      const on = o.dataset.arg === section;
      o.setAttribute('aria-checked', String(on));
      o.classList.toggle('current', on);
    }
    for (const s of squares) s.classList.toggle('current', s.dataset.arg === section);
    bar.dataset.section = section;
    sw.setAttribute('aria-label', `القسم الحالي: ${AR_NAMES[section] ?? section}. بدّل القسم`);
  };
  /** إطار المبدّل عند تقدّم e (0 مغلق، 1 مفتوح)؛ اتجاه كل طبقة من المنتصف للخارج. */
  const switchFrame = (e) => {
    const out = new Map();
    for (const o of opts) {
      const dir = { manga: -1, anime: 0, cinema: 1 }[o.dataset.arg] ?? 0; // -1 تأتي من اليسار
      const x = dir === 0 ? 0 : dir * (1 - e) * 100;
      out.set(o, dir === 0
        ? { opacity: e.toFixed(3), transform: `scale(${(0.92 + 0.08 * e).toFixed(4)})` }
        : { opacity: Math.min(1, e * 1.6).toFixed(3), transform: `translate3d(${x.toFixed(2)}%,0,0)` });
    }
    for (const c of caps) out.set(c.querySelector('.cap-body'), { opacity: (1 - e).toFixed(3), transform: `scale(${(1 - 0.06 * e).toFixed(4)})` });
    out.set(sw, { opacity: (1 - e).toFixed(3), transform: `scale(${(1 - 0.2 * e).toFixed(4)})` });
    out.set(scrim, { opacity: e.toFixed(3) });
    return out;
  };
  let switchP = 0, switchMotion = null;
  const animateSwitch = (to) => {
    const from = switchMotion ? switchMotion.halt() : switchP;
    switchMotion = null;
    scrim.style.pointerEvents = to ? '' : 'none'; // الإغلاق يوقف لمس الستار فورًا
    if (to) {
      scrim.hidden = false;
      bar.classList.add('open');
    }
    const done = () => {
      switchMotion = null;
      switchP = to;
      if (!to) {
        scrim.hidden = true;
        scrim.style.opacity = '';
        bar.classList.remove('open');
        for (const el of [...opts, sw, ...caps.map((c) => c.querySelector('.cap-body'))]) {
          el.style.transform = '';
          el.style.opacity = '';
        }
      }
    };
    const span = Math.abs(to - from);
    const m = drive({
      frameAt: (k) => ((switchP = k), switchFrame(k)),
      e0: from,
      e1: to,
      duration: still() ? 0 : (to ? 340 : 260) * span,
      ease: to ? easeOut : easeInOut,
      easing: to ? 'cubic-bezier(0.22, 1, 0.36, 1)' : 'cubic-bezier(0.4, 0, 0.2, 1)',
      done,
    });
    if (m.live) switchMotion = m;
  };
  const setOpen = (next, { focus = true, instant = false } = {}) => {
    if (next === open) return;
    open = next;
    sw.setAttribute('aria-expanded', String(open));
    for (const o of opts) {
      o.toggleAttribute('inert', !open);
      o.setAttribute('aria-hidden', String(!open));
      o.setAttribute('tabindex', open && o.dataset.arg === section ? '0' : '-1');
    }
    for (const c of caps) c.querySelector('.cap-body')?.toggleAttribute('inert', open);
    if (open) {
      haptic();
      onPrepare?.();
    }
    animateSwitch(open ? 1 : 0);
    if (instant) switchMotion?.finish();
    if (!open) onClose?.();
    // التركيز ينتقل للقسم الحالي فقط لمن يستعمل لوحة المفاتيح؛ اللمس لا يُظهر إطار تركيز
    if (focus && viaKeys) (open ? opts.find((o) => o.dataset.arg === section) : sw)?.focus?.({ preventScroll: true });
  };
  let viaKeys = false;
  globalThis.document?.addEventListener?.('keydown', () => (viaKeys = true), true);
  globalThis.document?.addEventListener?.('pointerdown', () => (viaKeys = false), true);

  // لوحة المفاتيح بين الأقسام المفتوحة (يمين = السابق في RTL)
  bar.addEventListener('keydown', (e) => {
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

  // ── سحب الدائرة داخل كبسولتها فقط ─────────────────────────
  let scrub = null, scrubbed = false;
  for (const cap of caps) {
    cap.addEventListener('pointerdown', (e) => {
      if (open || e.button > 0 || !activePage) return;
      // في التوحيد السحب على الشريط كله؛ وإلا داخل كبسولة الوجهة الحالية وحدها
      const zone = zoneOf(activePage);
      if (zone !== bar && zone !== cap) return;
      scrub = { cap: zone, id: e.pointerId, x: e.clientX, on: false, track: [] };
      scrubbed = false;
    });
  }
  bar.addEventListener('pointermove', (e) => {
    if (!scrub || e.pointerId !== scrub.id) return;
    if (!scrub.on) {
      if (Math.abs(e.clientX - scrub.x) < 8) return;
      scrub.on = scrubbed = true;
      bar.setPointerCapture?.(e.pointerId);
      haltInd(scrub.cap);
      bar.classList.add('scrubbing');
    }
    const cap = scrub.cap;
    const slots = slotsIn(cap);
    const center = (n) => centerIn(cap, n);
    const centers = slots.map(center);
    const lo = Math.min(...centers), hi = Math.max(...centers);
    const capW = cap.getBoundingClientRect().width;
    const edge = IND / 2 + 3; // الدائرة كاملة داخل كبسولتها دائمًا
    const raw = e.clientX - cap.getBoundingClientRect().left - (cap.clientLeft || 0);
    // مقاومة مطاطية خفيفة بعد آخر زر، ولا تتجاوز حافة الكبسولة
    const rub = raw < lo ? lo - Math.min(10, (lo - raw) * 0.25) : raw > hi ? hi + Math.min(10, (raw - hi) * 0.25) : raw;
    const x = Math.min(capW - edge, Math.max(edge, rub));
    scrub.track.push([e.timeStamp, x]);
    if (scrub.track.length > 5) scrub.track.shift();
    const [t0, x0] = scrub.track[0];
    scrub.v = e.timeStamp > t0 ? (x - x0) / (e.timeStamp - t0) : 0;
    stateOf(cap).x = x;
    // التمطّط يصغر قرب الحافة كي لا تتجاوزها الدائرة
    const room = (2 * Math.min(x, capW - x) - 6) / IND;
    indOf(cap).style.transform = indTransform(x, scrub.v, 1, room);
    const near = slots.reduce((a, b) => (Math.abs(center(b) - x) < Math.abs(center(a) - x) ? b : a));
    for (const n of slots) n.classList.toggle('near', n === near);
  });
  const endScrub = (e) => {
    if (!scrub || e.pointerId !== scrub.id) return;
    const s = scrub;
    scrub = null;
    if (!s.on) return;
    bar.classList.remove('scrubbing');
    const slots = slotsIn(s.cap);
    const center = (n) => centerIn(s.cap, n);
    for (const n of slots) n.classList.remove('near');
    if (e.type === 'pointercancel') {
      // إيماءة قطعها النظام: لا تنقّل، والدائرة ترجع لمكانها، ولا تُبتلع اللمسة التالية
      scrubbed = false;
      const nav = navs.find((n) => n.dataset.page === activePage);
      if (nav) slide(s.cap, center(nav));
      return;
    }
    const v = s.v ?? 0;
    const x = (stateOf(s.cap).x ?? 0) + (Math.abs(v) > 1.1 ? v * 40 : 0);
    const target = slots.reduce((a, b) => (Math.abs(center(b) - x) < Math.abs(center(a) - x) ? b : a));
    pendingV = Math.max(-3, Math.min(3, v));
    haptic();
    if (target.dataset.page === activePage) slide(s.cap, center(target), pendingV), (pendingV = 0);
    else onNavigate?.(target.dataset.page);
  };
  bar.addEventListener('pointerup', endScrub);
  bar.addEventListener('pointercancel', endScrub);
  bar.addEventListener('click', (e) => {
    if (!scrubbed) return;
    scrubbed = false;
    e.stopPropagation();
    e.preventDefault();
  }, true);

  // ── السحب الأفقي على المبدّل: القسم المجاور، والصفحة تتبع الإصبع ──
  let drag = null;
  sw.addEventListener('pointerdown', (e) => {
    if (open || e.button > 0) return;
    drag = { x: e.clientX, y: e.clientY, t: e.timeStamp, id: e.pointerId, to: null, track: [] };
    dragged = false;
    onPrepare?.();
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
    const width = globalThis.innerWidth || 360;
    drag.progress = clamp((dx * drag.dir) / (width * 0.9));
    onDrag?.(drag.to, drag.progress);
  });
  const endDrag = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    if (!d.to) return onDragEnd?.(null, false);
    if (e.type === 'pointercancel') dragged = false; // لا نقرة تتبعها: لا تُبتلع اللمسة التالية
    const [t0, x0] = d.track[0] ?? [d.t, 0];
    const [t1, x1] = d.track[d.track.length - 1] ?? [e.timeStamp, 0];
    const v = t1 > t0 ? ((x1 - x0) * d.dir) / (t1 - t0) : 0;
    const commit = e.type !== 'pointercancel' && ((d.progress ?? 0) > 0.32 || v > 0.45);
    if (commit) haptic();
    onDragEnd?.(d.to, commit);
  };
  sw.addEventListener('pointerup', endDrag);
  sw.addEventListener('pointercancel', endDrag);

  globalThis.addEventListener?.('resize', () => {
    if (activePage) {
      const nav = navs.find((n) => n.dataset.page === activePage);
      const zone = zoneOf(activePage);
      if (!nav || !zone) return;
      haltInd(zone);
      showInd(zone, centerIn(zone, nav));
    }
  });
  mark();

  return {
    isOpen: () => open,
    toggle: () => setOpen(!open),
    open: () => setOpen(true),
    close: (o) => setOpen(false, o),
    consumeDrag() {
      const was = dragged;
      dragged = false;
      return was;
    },
    setSection(id) {
      section = id;
      mark();
    },
    /** الوجهة المختارة تغيّرت: المؤشر ينزلق داخل الكبسولة أو ينتقل بينها انكماشًا وكبرًا. */
    activate(page) {
      const visible = !bar.hidden && bar.getBoundingClientRect().width > 0;
      if (!visible) {
        activePage = navs.some((n) => n.dataset.page === page) ? page : null;
        for (const c of caps) stateOf(c).shown = false; // يُوضع بلا حركة عند الظهور
        return;
      }
      moveIndicator(page);
    },
    /** `force`: أعد الدائرة لمركز وجهتها الآن (بعد تغيّر عرض الشريط) ولو كانت ظاهرة. */
    repaint(force = false) {
      if (!activePage) return;
      const cap = zoneOf(activePage);
      if (force && cap) {
        const nav = navs.find((n) => n.dataset.page === activePage);
        if (nav) { haltInd(cap); showInd(cap, centerIn(cap, nav)); }
        return;
      }
      if (cap && !stateOf(cap).shown) {
        const page = activePage;
        activePage = null;
        moveIndicator(page);
      }
    },
  };
}
