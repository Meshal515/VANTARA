/**
 * الترجمة داخل القارئ: أي فصل، متى، وبأي ترتيب.
 *
 * - الإعدادات (`lib/translate-settings.js`) تحكم كل شيء: مغلقة = لا زرّ ولا
 *   عمل. تلقائي = كل فصل إنجليزي يُترجم حين تدخله. عند الطلب = تضغط «ترجم»
 *   ويستمر للعمل إلى أن تخرج من بطاقته.
 * - أول تفعيل بلا نماذج على الجهاز: بطاقة «تحميل ملفات الترجمة» بالحجم، مرة
 *   واحدة، ثم تعمل محليًّا.
 * - ترتيب ثابت لا يتبع سرعتك (`createQueue`): من صفحتك للأمام بالترتيب، ثلاث
 *   صفحات معًا، ثم ما عبرته خلفك، ثم الفصل التالي. صفحة تفشل لسبب عابر تُعاد.
 * - «نجهّز الفصل بالعربي» حتى تجهز أول ثلاث صفحات، ثم تقرأ والباقي يكمل
 *   أمامك. «اقرأ الآن» يتخطى الانتظار.
 * - الصفحة المترجمة **صورة** جاهزة؛ القارئ يبدّل `<img src>` ويحتفظ بالأصل.
 */

import { isFiller } from './works.js';
import { TRANSLATE_ERRORS, createQueue, forgetPage, translatePage } from '../lib/translate.js';
import { onTranslateSettings, readTranslateSettings } from '../lib/translate-settings.js';
import { readJobs } from '../lib/translate-jobs.js';
import { downloadModels, formatBytes, modelsStatus, nativeTranslationAvailable } from '../lib/translation-native.js';
import { learnOnce } from '../lib/translate-learn.js';

/** أقل ما يجهز من الفصل قبل أن تبدأ: 30% (ويزيد إن كانت الترجمة أبطأ منك). */
const ENTRY_PAGES = 3;
/** إعادة الصفحة بعد فشل عابر. */
const RETRY_DELAYS_MS = [3_000, 10_000, 30_000, 90_000];
/** أخطاء لا يحلّها الانتظار: توقف الترجمة وتُقال مرة. */
const BLOCKING = new Set(['models_missing', 'device_only', 'translation_not_configured', 'translation_worker_offline', 'weekly_limit', 'monthly_budget', 'no_credit']);
/** الأعمال التي فعّلتها بنفسك في وضع «عند الطلب»: للجلسة، وتُنسى بالخروج من العمل. */
const sessionWorks = new Set();
/** نوع الترجمة لكل عمل في هذه الجلسة (ذكية/سريعة) كما اخترته عند «ترجم»؛ وإلا من الإعدادات. */
const sessionSpeed = new Map();
export const speedOf = (ref) => sessionSpeed.get(ref) ?? readTranslateSettings().speed;

const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v === null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // تفضيل لا حقيقة
    }
  },
};

// صفحة كاملة تُحلَّل وتُرسم على الجهاز: طلبان متزامنان يكفيان ولا يخنقان الجوال
// ثلاث صفحات معًا: الرؤية على الجوال واحدة تلو الأخرى، وLuna تتداخل معها
const queue = createQueue({ concurrency: 3 });

export const needsTranslation = (row) => Boolean(row) && (row.lang === 'en' || isFiller(row.sourceId));

/** خرجت من صفحة العمل: ينتهي تفعيل «عند الطلب» وإيقاف «تلقائي» واختيار ذكية/سريعة لهذا العمل. */
export function endWorkSession(ref) {
  if (!ref) return;
  sessionWorks.delete(ref);
  sessionWorks.delete(`off:${ref}`);
  sessionSpeed.delete(ref);
}

/** هل الترجمة شغّالة لهذا العمل الآن؟ تلقائي = نعم؛ عند الطلب = إن فعّلتها في هذه الجلسة. */
export function translationOn(ref) {
  const s = readTranslateSettings();
  if (!s.enabled || !ref) return false;
  // تلقائي: شغّالة ما لم توقفها مؤقتًا لهذا العمل؛ عند الطلب: إن فعّلتها في هذه الجلسة
  // فصول جهّزتها مقدمًا تُعرض عربية دائمًا، ولو بعد إعادة فتح التطبيق
  return s.mode === 'auto' ? !sessionWorks.has(`off:${ref}`) : sessionWorks.has(ref) || readJobs().some((j) => j.ref === ref);
}

/** تشغيل/إيقاف الترجمة لعمل في هذه الجلسة، من صفحة العمل أو زر القارئ. */
export function setTranslation(ref, on) {
  if (!ref) return;
  if (readTranslateSettings().mode === 'auto') {
    if (on) sessionWorks.delete(`off:${ref}`);
    else sessionWorks.add(`off:${ref}`);
  } else if (on) sessionWorks.add(ref);
  else sessionWorks.delete(ref);
}

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};

/**
 * يبدّل صورة الصفحة بين الأصل والمترجم. يحتفظ بالأصل في `img.dataset.original`
 * فالعودة له لا تعيد التحميل. صفحة بلا ترجمة (لا نص، مؤثرات فقط) تبقى الأصل.
 */
export function swapPageImage(img, result, on, onBroken = null) {
  if (!img) return;
  if (!img.dataset.original) img.dataset.original = img.src;
  const translated = on && Boolean(result?.image);
  const target = translated ? result.image : img.dataset.original;
  // ملف الترجمة المحفوظ قد يختفي (أندرويد ينظّف الكاش): الأصل فورًا، ثم ترجمة جديدة
  img.onerror = translated
    ? () => {
        img.onerror = null;
        img.src = img.dataset.original;
        img.classList.remove('rd-page--translated');
        onBroken?.();
      }
    : null;
  if (img.src !== target) img.src = target;
  img.classList.toggle('rd-page--translated', translated);
}

/**
 * @param {{ api, sync, ref: string, title: string, root: HTMLElement, toast: (t: string) => void,
 *   getImage: (seg, index) => Promise<string>, keyOf: (row) => string }} deps
 */
export function createReaderTranslation(deps) {
  const { api, sync, ref, title, root, toast, getImage, keyOf, rows, pagesOf, imageOf } = deps;
  let lessonStarted = false;
  let stopped = false;
  let disabledReason = null;
  let gate = null;
  let modelsCard = null;
  let currentSegs = [];
  let currentSeg = null;

  const enabled = () => readTranslateSettings().enabled;
  const isOn = () => translationOn(ref);
  root.classList.toggle('rd-tl-off', !isOn());

  // تغيّرت الإعدادات والقارئ مفتوح: يُطبَّق فورًا
  const unsubscribe = onTranslateSettings(() => {
    if (stopped) return;
    if (!enabled()) sessionWorks.delete(ref);
    applyState();
  });

  function attach(seg) {
    if (!needsTranslation(seg.row)) return;
    seg.tl = { results: new Map(), queued: false, failed: new Set(), tries: new Map() };
  }

  function paint(seg, index) {
    const result = seg.tl?.results.get(index);
    const slot = seg.slots[index];
    const img = slot?.frame.querySelector(':scope > img');
    if (result && img) {
      swapPageImage(img, result, isOn(), () => {
        seg.tl?.results.delete(index);
        void forgetPage(result.hash).then(() => enqueuePage(seg, index));
      });
    }
  }

  /** الصورة وُضعت: إن سبقتها الترجمة تُبدَّل الآن. */
  function onImage(seg, index) {
    if (seg.tl) paint(seg, index);
  }

  function enqueue(seg) {
    if (!seg.tl || seg.tl.queued || stopped || disabledReason || !isOn()) return;
    seg.tl.queued = true;
    seg.slots.forEach((_slot, index) => enqueuePage(seg, index));
  }

  /** صفحة واحدة في الطابور. تُعاد بعد فشل عابر، فلا تبقى صفحة إنجليزية لأنك مررت عليها بسرعة. */
  function enqueuePage(seg, index) {
    if (!seg.tl || stopped || disabledReason || !isOn() || seg.tl.results.has(index)) return;
    const chapterKey = keyOf(seg.row);
    const run = async () => {
      if (stopped || disabledReason || !isOn()) return null;
      const src = await getImage(seg, index);
      // صفحة ناقصة تُكمَل في الخلفية: حين تجهز تُبدَّل وهي أمامك
      const onRepaired = (better) => {
        if (!seg.tl) return;
        seg.tl.results.set(index, better);
        paint(seg, index);
      };
      return translatePage({ api, sync, onRepaired }, src, {
        seriesRef: ref,
        seriesTitle: title,
        chapterKey,
        chapterNumber: Number.isFinite(seg.row.number) && seg.row.number >= 0 ? seg.row.number : null,
        pageIndex: index,
        sourceLang: seg.row.lang ?? 'en',
        ...(speedOf(ref) === 'fast' ? { speed: 'fast' } : {}),
      });
    };
    queue
      .add({ key: `${chapterKey}#${index}`, chapterKey, index, run })
      .then((result) => {
        if (!result) return;
        if (result.error) return failed(seg, index, result.error);
        seg.tl.failed.delete(index);
        seg.tl.results.set(index, result);
        paint(seg, index);
        updateGate();
      })
      .catch(() => failed(seg, index, 'offline'));
  }

  function failed(seg, index, code) {
    if (!seg.tl) return;
    // خطأ عام (لا نماذج، لا مفتاح، حد أسبوعي) يوقف الطابور مرة ويقال مرة
    if (BLOCKING.has(code)) {
      seg.tl.failed.add(index);
      if (!disabledReason) toast(TRANSLATE_ERRORS[code]);
      disabledReason = code;
      if (code === 'models_missing') void offerModels();
      updateGate();
      return;
    }
    // عابر (صورة لم تصل بعد، نت، انشغال): يُعاد بعد مهلة تكبر، حتى أربع مرات
    const tries = (seg.tl.tries.get(index) ?? 0) + 1;
    seg.tl.tries.set(index, tries);
    if (tries <= RETRY_DELAYS_MS.length) {
      setTimeout(() => enqueuePage(seg, index), RETRY_DELAYS_MS[tries - 1]);
      return;
    }
    seg.tl.failed.add(index);
    updateGate();
  }

  /** موضعك: يعيد ترتيب الطابور (الحالي 0، التالي 1، السابق 2). */
  function focus(seg, index, segs) {
    currentSegs = segs;
    currentSeg = seg;
    const i = segs.indexOf(seg);
    const ranks = {};
    if (segs[i + 1]) ranks[keyOf(segs[i + 1].row)] = 1;
    if (segs[i - 1]) ranks[keyOf(segs[i - 1].row)] = 2;
    ranks[keyOf(seg.row)] = 0;
    queue.focus(keyOf(seg.row), index, ranks);
    if (!isOn()) return;
    if (!ensureModelsOrOffer()) return;
    startLesson();
    enqueue(seg);
    if (segs[i + 1]) enqueue(segs[i + 1]);
  }

  /** Luna تتعلم من الفصول العربية لهذا العمل مرة، في الخلفية، قبل/مع أول صفحة. */
  function startLesson() {
    if (lessonStarted || !rows || !pagesOf || !imageOf || !sync?.translation) return;
    lessonStarted = true;
    void learnOnce({ sync, ref, title, rows, pagesOf, imageOf }).then((outcome) => {
      if (outcome === 'learned') toast('تعلّمت Luna أسماء العمل ومصطلحاته من فصوله العربية');
    });
  }

  // ── ملفات الترجمة على الجهاز ──

  let modelsKnown = null; // null = لم نسأل بعد؛ true/false
  function ensureModelsOrOffer() {
    if (!nativeTranslationAvailable()) return true; // الويب: مسار الخادم يقرر
    if (modelsKnown === true) return true;
    if (modelsKnown === null) {
      void modelsStatus().then((s) => {
        modelsKnown = Boolean(s.installed);
        if (modelsKnown) applyState();
        else void offerModels(s);
      });
      return false;
    }
    void offerModels();
    return false;
  }

  /** بطاقة «تحميل ملفات الترجمة»: مرة واحدة، بالحجم، وبشريط تقدم. */
  async function offerModels(status = null) {
    if (modelsCard || stopped) return;
    const s = status ?? (await modelsStatus());
    if (s.installed) {
      modelsKnown = true;
      return;
    }
    modelsCard = el('div', 'rd-tl-gate');
    modelsCard.setAttribute('role', 'dialog');
    const card = el('div', 'rd-tl-card');
    card.append(el('strong', null, 'الترجمة تحتاج ملفاتها على الجوال'));
    const line = el('span', 'rd-tl-line', `تحميل مرة واحدة (${formatBytes(s.expectedBytes)})، وبعدها الترجمة تشتغل على الجهاز بلا خادم.`);
    const bar = el('div', 'progress-bar');
    bar.hidden = true;
    const fill = el('i');
    bar.append(fill);
    const dl = el('button', 'btn btn-primary', 'حمّل ملفات الترجمة');
    dl.type = 'button';
    const later = el('button', 'btn btn-secondary', 'لاحقًا');
    later.type = 'button';
    later.onclick = () => closeModels();
    dl.onclick = async () => {
      dl.disabled = true;
      later.disabled = true;
      bar.hidden = false;
      line.textContent = 'جارٍ التحميل…';
      try {
        await downloadModels(({ received, total }) => {
          fill.style.width = `${Math.min(100, (received / Math.max(1, total)) * 100)}%`;
          line.textContent = `جارٍ التحميل… ${formatBytes(received)} من ${formatBytes(total)}`;
        });
        modelsKnown = true;
        disabledReason = null;
        closeModels();
        toast('ملفات الترجمة جاهزة');
        applyState();
      } catch {
        line.textContent = 'ما اكتمل التحميل — جرّب مرة ثانية من الإعدادات > الترجمة';
        dl.disabled = false;
        later.disabled = false;
        bar.hidden = true;
      }
    };
    card.append(line, bar, dl, later);
    modelsCard.append(card);
    root.append(modelsCard);
  }
  function closeModels() {
    modelsCard?.remove();
    modelsCard = null;
  }

  // ── «نجهّز الفصل بالعربي» ──

  function readyAhead(seg, from) {
    let n = 0;
    for (let i = from; i < seg.slots.length; i++) {
      if (!seg.tl.results.has(i) && !seg.tl.failed.has(i)) break;
      n += 1;
    }
    return n;
  }
  /** ثابت: ثلاث صفحات جاهزة من حيث تبدأ (أو الفصل كله إن كان أقصر)، والباقي يكمل أمامك. */
  function needed(seg, from) {
    return Math.min(seg.slots.length - from, ENTRY_PAGES);
  }

  /** فتح فصل يحتاج ترجمة: الانتظار حتى أقل جاهز يكفي، أو «اقرأ الآن». */
  function openGate(seg, from) {
    closeGate();
    if (!seg.tl || !isOn() || disabledReason || modelsKnown === false) return;
    enqueue(seg);
    gate = { seg, from, el: el('div', 'rd-tl-gate') };
    gate.el.setAttribute('role', 'status');
    const card = el('div', 'rd-tl-card');
    card.append(el('strong', null, 'نجهّز الفصل بالعربي'));
    const line = el('span', 'rd-tl-line', '');
    const bar = el('div', 'progress-bar');
    const fill = el('i');
    bar.append(fill);
    const now = el('button', 'btn btn-secondary', 'اقرأ الآن');
    now.type = 'button';
    now.onclick = closeGate;
    card.append(line, bar, now);
    gate.el.append(card);
    gate.line = line;
    gate.fill = fill;
    root.append(gate.el);
    updateGate();
  }
  function updateGate() {
    if (!gate) return;
    const { seg, from } = gate;
    const ready = readyAhead(seg, from);
    const need = Math.max(1, needed(seg, from));
    gate.line.textContent = `${Math.min(ready, need)} من ${need} صفحات قبل ما تبدأ`;
    gate.fill.style.width = `${Math.min(100, (ready / need) * 100)}%`;
    if (ready >= need || disabledReason) closeGate();
  }
  function closeGate() {
    gate?.el.remove();
    gate = null;
  }

  /** الحالة الحالية على كل الصفحات الظاهرة: الصور تتبدّل فورًا، والطابور يقف أو يكمل. */
  function applyState() {
    const on = isOn();
    root.classList.toggle('rd-tl-off', !on);
    for (const s of currentSegs) {
      if (!s.tl) continue;
      s.slots.forEach((slot, index) => {
        const img = slot?.frame.querySelector(':scope > img');
        const result = s.tl.results.get(index);
        if (img && result) swapPageImage(img, result, on);
      });
    }
    if (on && currentSeg) {
      disabledReason = null;
      for (const s of currentSegs) if (s.tl) s.tl.queued = false;
      focus(currentSeg, currentSeg.current ?? 0, currentSegs);
      openGate(currentSeg, currentSeg.current ?? 0);
    } else {
      closeGate();
    }
  }

  /** زرّ «ترجم/عربي» في الشريط: يقلب حالة هذا العمل (في «عند الطلب» للجلسة). */
  function toggle(segs, current) {
    currentSegs = segs;
    currentSeg = current ?? currentSeg;
    if (!enabled()) return;
    const on = !isOn();
    if (readTranslateSettings().mode === 'manual') {
      if (on) sessionWorks.add(ref);
      else sessionWorks.delete(ref);
    } else {
      // في «تلقائي» الزرّ يوقف العرض مؤقتًا لهذا العمل فقط
      if (on) sessionWorks.delete(`off:${ref}`);
      else sessionWorks.add(`off:${ref}`);
    }
    applyState();
    toast(on ? 'الترجمة العربية شغّالة لهذا العمل' : 'تعرض الأصل الحين');
  }

  /**
   * اخترت من ورقة «ترجم»: ذكية أو سريعة. يشغّل الترجمة إن كانت موقفة. ومن
   * سريعة إلى ذكية: الصفحات تُترجم من جديد (السريعة تبقى معروضة حتى تجهز الذكية).
   */
  function start(segs, current, speed) {
    currentSegs = segs;
    currentSeg = current ?? currentSeg;
    if (!enabled()) return;
    const upgraded = isOn() && speedOf(ref) === 'fast' && speed === 'smart';
    sessionSpeed.set(ref, speed === 'fast' ? 'fast' : 'smart');
    if (readTranslateSettings().mode === 'manual') sessionWorks.add(ref);
    else sessionWorks.delete(`off:${ref}`);
    if (upgraded) {
      for (const seg of currentSegs ?? []) {
        if (!seg.tl) continue;
        seg.tl.results.clear();
        seg.tl.failed.clear();
        seg.tl.tries.clear();
        seg.tl.queued = false;
      }
    }
    applyState();
    toast(speed === 'fast' ? 'ترجمة سريعة شغّالة لهذا العمل' : 'ترجمة ذكية شغّالة لهذا العمل');
  }

  function destroy() {
    stopped = true;
    unsubscribe();
    closeGate();
    closeModels();
    // صفحات هذه الجلسة التي لم تبدأ تخرج من الطابور المشترك: عودتك للفصل تبدأها من جديد
    for (const seg of currentSegs ?? []) if (seg?.tl) queue.drop(keyOf(seg.row));
    // التفعيل واختيار ذكية/سريعة يبقيان حتى تخرج من صفحة العمل (`endWorkSession`)، لا من الفصل
  }

  return { attach, onImage, enqueue, focus, openGate, toggle, start, speed: () => speedOf(ref), destroy, needs: needsTranslation, isOn, enabled };
}
