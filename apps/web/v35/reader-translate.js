/**
 * الترجمة داخل القارئ: أي فصل، متى، وبأي ترتيب.
 *
 * - الفصل يحتاج ترجمة حين لغته ليست العربية (التكملة الإنجليزية `lang: 'en'`).
 * - فتحته: الحالي أولًا، والتالي بعده، والسابق احتياطًا — طابور حيّ يتبع
 *   موضعك (`createQueue`). تقترب من صفحة غير جاهزة؟ تعود للمقدّمة.
 * - لا ننتظر الفصل كله: «نجهّز الفصل بالعربي» حتى يجهز أقل عدد يضمن ألا
 *   تلحق بالترجمة (`entryPages`)، ثم تقرأ والباقي يكمل خلفك. «اقرأ الآن»
 *   يتخطى الانتظار دائمًا.
 * - الصفحة المترجمة **صورة** جاهزة من عامل الترجمة (فقاعات مكتشفة، نص
 *   مبيَّض، عربي في مكانه). القارئ يبدّل `<img src>` بها ويحتفظ بالأصل، فالتبديل
 *   بين العربي والأصل فوري وبلا رسم على الجوال.
 */

import { isFiller } from './works.js';
import { TRANSLATE_ERRORS, createQueue, entryPages, readingRate, translatePage } from '../lib/translate.js';

/** الأعمال التي فعّلت فيها الترجمة. الافتراضي: مقفلة — الإنجليزي يُعرض كما هو. */
const WORKS_KEY = 'vantara.translate.works';
/** أقل ما يجهز من الفصل قبل أن تبدأ: 30% (ويزيد إن كانت الترجمة أبطأ منك). */
const MIN_READY = 0.3;
const RATE_KEY = 'vantara.translate.readRate';
const TL_RATE_KEY = 'vantara.translate.speed';

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

// صفحة كاملة تُرفع وتُعالج: طلبان متزامنان يكفيان ولا يخنقان جهاز البيت
const queue = createQueue({ concurrency: 2 });

export const needsTranslation = (row) => Boolean(row) && (row.lang === 'en' || isFiller(row.sourceId));
const onWorks = () => new Set(store.get(WORKS_KEY, []));
/** الترجمة التلقائية لهذا العمل: مقفلة ما لم تفعّلها أنت من صفحة العمل أو القارئ. */
export const translationOn = (ref) => Boolean(ref) && onWorks().has(ref);
export function setTranslation(ref, on) {
  if (!ref) return;
  const set = onWorks();
  if (on) set.add(ref);
  else set.delete(ref);
  store.set(WORKS_KEY, [...set].slice(-500));
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
export function swapPageImage(img, result, on) {
  if (!img) return;
  if (!img.dataset.original) img.dataset.original = img.src;
  const target = on && result?.image ? result.image : img.dataset.original;
  if (img.src !== target) img.src = target;
  img.classList.toggle('rd-page--translated', on && Boolean(result?.image));
}

/**
 * @param {{ api, ref: string, title: string, root: HTMLElement, toast: (t: string) => void,
 *   getImage: (seg, index) => Promise<string>, keyOf: (row) => string }} deps
 */
export function createReaderTranslation(deps) {
  const { api, ref, title, root, toast, getImage, keyOf } = deps;
  let stopped = false;
  let disabledReason = null;
  let gate = null;
  const last = { seg: null, index: 0, at: 0 };

  const isOn = () => translationOn(ref);
  root.classList.toggle('rd-tl-off', !isOn());

  function attach(seg) {
    if (!needsTranslation(seg.row)) return;
    seg.tl = { results: new Map(), queued: false, failed: new Set() };
  }

  function paint(seg, index) {
    const result = seg.tl?.results.get(index);
    const slot = seg.slots[index];
    const img = slot?.frame.querySelector(':scope > img');
    if (result && img) swapPageImage(img, result, isOn());
  }

  /** الصورة وُضعت: إن سبقتها الترجمة تُبدَّل الآن. */
  function onImage(seg, index) {
    if (seg.tl) paint(seg, index);
  }

  function enqueue(seg) {
    if (!seg.tl || seg.tl.queued || stopped || disabledReason || !isOn()) return;
    seg.tl.queued = true;
    const chapterKey = keyOf(seg.row);
    seg.slots.forEach((slot, index) => {
      const run = async () => {
        if (stopped || disabledReason) return null;
        const src = await getImage(seg, index);
        return translatePage(api, src, {
          seriesRef: ref,
          seriesTitle: title,
          chapterKey,
          chapterNumber: Number.isFinite(seg.row.number) && seg.row.number >= 0 ? seg.row.number : null,
          pageIndex: index,
          sourceLang: seg.row.lang ?? 'en',
        });
      };
      queue
        .add({ key: `${chapterKey}#${index}`, chapterKey, index, run })
        .then((result) => {
          if (!result) return;
          if (result.error) return failed(seg, index, result.error);
          seg.tl.results.set(index, result);
          paint(seg, index);
          updateGate();
        })
        .catch(() => failed(seg, index, 'offline'));
    });
  }

  function failed(seg, index, code) {
    seg.tl?.failed.add(index);
    // خطأ عام (لا مفتاح، جهاز البيت مطفّى، حد أسبوعي) يوقف الطابور مرة ويقال مرة
    if (['translation_not_configured', 'translation_worker_offline', 'weekly_limit', 'no_credit'].includes(code)) {
      if (!disabledReason) toast(TRANSLATE_ERRORS[code]);
      disabledReason = code;
    }
    updateGate();
  }

  /** موضعك: يعيد ترتيب الطابور (الحالي 0، التالي 1، السابق 2) ويقيس سرعة قراءتك. */
  function focus(seg, index, segs) {
    const now = Date.now();
    if (last.seg === seg && index > last.index && now - last.at < 5 * 60_000) {
      const samples = store.get(RATE_KEY, []);
      samples.push({ pages: index - last.index, ms: now - last.at });
      store.set(RATE_KEY, samples.slice(-30));
    }
    Object.assign(last, { seg, index, at: now });
    const i = segs.indexOf(seg);
    const ranks = {};
    if (segs[i + 1]) ranks[keyOf(segs[i + 1].row)] = 1;
    if (segs[i - 1]) ranks[keyOf(segs[i - 1].row)] = 2;
    ranks[keyOf(seg.row)] = 0;
    queue.focus(keyOf(seg.row), index, ranks);
    enqueue(seg);
    if (segs[i + 1]) enqueue(segs[i + 1]);
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
  function needed(seg, from) {
    const measured = queue.rate();
    const speed = measured || store.get(TL_RATE_KEY, 4);
    if (measured) store.set(TL_RATE_KEY, measured);
    const total = seg.slots.length - from;
    const adaptive = entryPages({ total, translatePerMin: speed, readPerMin: readingRate(store.get(RATE_KEY, [])) });
    return Math.min(total, Math.max(Math.ceil(total * MIN_READY), adaptive));
  }

  /** فتح فصل يحتاج ترجمة: الانتظار حتى أقل جاهز يكفي، أو «اقرأ الآن». */
  function openGate(seg, from) {
    closeGate();
    if (!seg.tl || !isOn() || disabledReason) return;
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

  /** تشغيل/إيقاف من القائمة: الصور تتبدّل فورًا، والطابور يقف أو يكمل. */
  function toggle(segs, current) {
    const on = !isOn();
    setTranslation(ref, on);
    root.classList.toggle('rd-tl-off', !on);
    for (const s of segs) {
      if (!s.tl) continue;
      s.slots.forEach((slot, index) => {
        const img = slot?.frame.querySelector(':scope > img');
        const result = s.tl.results.get(index);
        if (img && result) swapPageImage(img, result, on);
      });
    }
    if (on) {
      disabledReason = null;
      for (const s of segs) if (s.tl) s.tl.queued = false;
      if (current) {
        focus(current, current.current, segs);
        // تفعيلٌ من داخل الفصل: نفس الانتظار، من الصفحة التي أنت فيها
        openGate(current, current.current ?? 0);
      }
      toast('الترجمة العربية شغّالة لهذا العمل');
    } else {
      closeGate();
      toast('تعرض الأصل الحين');
    }
  }

  function destroy() {
    stopped = true;
    closeGate();
  }

  return { attach, onImage, enqueue, focus, openGate, toggle, destroy, needs: needsTranslation, isOn };
}
