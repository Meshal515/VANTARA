/**
 * القارئ الذكي.
 *
 * الصفحات أولًا وكل ما عداها ثانيًا:
 *
 *   - ملء الشاشة فعلًا، بلا زرّ عائم ولا سهم «التالي» فوق الصفحات. لمسة
 *     واحدة تُظهر الشريط (رجوع، العمل والفصل، فريم، ⋮) ولمسة أخرى تخفيه،
 *     والتمرير يخفيه أيضًا.
 *   - التكبير مقفول افتراضيًا (لمسة مزدوجة وإصبعان)، ويُفتح من الإعدادات.
 *   - نهاية الفصل سطران هادئان بعد آخر صفحة: «الفصل 112 انتهى» و«الفصل
 *     التالي 113»، والرقم يفتحه.
 *   - القارئ يسبقك: من آخر ثلاثين بالمئة من الفصل يجهّز الفصل التالي في
 *     الخلفية (بياناته، قائمة صفحاته، ثم صوره) حسب الشبكة وإعدادك، ولا ينافس
 *     الصفحات التي تقرؤها الآن. وما جُهّز لا يُرمى: الفصل التالي يفتح منه.
 *
 * القراءة تُحفظ في حسابك: الموضع، وعين الفصل عند ٢٠٪ منه — هذا الفصل وحده —
 * وإحصاء القراءة الكاملة عند نهايته.
 */

import { glyph, iconButton } from './icons.js';
import { countLabel } from './plural.js';
import { chapterKeyOf, isChapterRead, markChapter, shouldAutoMark } from './reading.js';
import { editionRows } from './works.js';
import {
  PRELOAD_FROM_RATIO,
  PRIORITY,
  chapterLabel,
  chapterSequence,
  chapterShort,
  createScheduler,
  loadSettings,
  neighbors,
  nextChapterPlan,
  readRatio,
  saveSettings,
} from './reader-core.js';
import { readNetwork } from '../lib/netpolicy.js';
import { MAX_FRAME_PAGES, buildFramePayload } from '../lib/frame.js';
import { openShareSheet } from './share.js';

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};

// ── كاش الجلسة: يعيش بين فتحات القارئ ──
// قائمة صفحات الفصل، وصور الصفحات (وعود بروابطها). الفصل الذي جُهّز مسبقًا
// يُقرأ من هنا بلا طلب جديد، والرجوع لفصلٍ قرأته قبل قليل فوري.
const pageLists = new Map();
let scheduler = null;
const MAX_CACHED_IMAGES = 420;
const MAX_CACHED_LISTS = 24;

function remember(map, key, value, max) {
  map.delete(key);
  map.set(key, value);
  while (map.size > max) map.delete(map.keys().next().value);
}

const chapterId = (row) => `${row.sourceId}|${row.chapter?.url ?? ''}`;
const imageKey = (row, index) => `${chapterId(row)}#${index}`;

/**
 * @param {{
 *   sync: any,
 *   engine: { pages: Function, pageImage: Function },
 *   mount: (node: Element) => void,
 *   exit: () => void,
 *   friends?: () => Array<{userId: string, displayName: string, avatarKey: string|null}>,
 *   sendFrame?: (payload: object) => void,
 *   report?: (input: object) => Promise<unknown>,
 *   setReading?: (info: object|null) => void,
 *   immersive?: (on: boolean) => void,
 * }} deps
 * @param {{ work: any, seriesRef: string, title: string, rows: any[], row: any }} ctx
 */
export function openSmartReader(deps, ctx) {
  const { sync, engine } = deps;
  scheduler ??= createScheduler({
    concurrency: 3,
    run: async (_key, { sourceId, page }) => (await engine.pageImage(sourceId, page)).src,
  });

  const settings = loadSettings();
  const sequence = chapterSequence(ctx.rows?.length ? ctx.rows : [ctx.row]);
  const ref = ctx.seriesRef;
  const me = () => sync.user?.userId;

  const root = el('div', 'v35 rd');
  root.setAttribute('role', 'application');
  root.setAttribute('aria-label', 'القارئ');
  root.innerHTML = `
    <div class="rd-scroll" id="rdScroll"></div>
    <header class="rd-top" id="rdTop">
      ${iconButton('back', 'رجوع', { act: 'exit' })}
      <div class="rd-titles"><strong id="rdWork" dir="auto"></strong><span id="rdChapter" dir="auto"></span></div>
      ${iconButton('camera', 'فريم', { act: 'frame', cls: 'icon-btn rd-camera' })}
      ${iconButton('more', 'خيارات', { act: 'menu' })}
    </header>
    <header class="rd-top rd-top--frame" id="rdFrameTop" hidden>
      ${iconButton('close', 'إلغاء الفريم', { act: 'frameCancel' })}
      <div class="rd-titles"><strong>فريم</strong><span id="rdFrameCount"></span></div>
      <button class="btn btn-primary rd-frame-next" type="button" data-act="frameNext" id="rdFrameNext">التالي</button>
    </header>
    <footer class="rd-bottom" id="rdBottom">
      ${iconButton('skipPrev', 'الفصل السابق', { act: 'prevChapter', cls: 'icon-btn rd-prev' })}
      <div class="rd-progress"><span id="rdPageLabel"></span><div class="progress-bar"><i id="rdProgress"></i></div></div>
      ${iconButton('skipNext', 'الفصل التالي', { act: 'nextChapter', cls: 'icon-btn rd-next' })}
    </footer>
    <div class="rd-tray" id="rdTray" hidden><div class="rd-tray-strip" id="rdTrayStrip"></div><p id="rdTrayHint">المس الصفحات لتضيفها أو تشيلها</p></div>
    <div class="rd-zoom" id="rdZoom" hidden><img alt="" id="rdZoomImg"></div>
    <div class="sheet-backdrop" id="rdSheet" data-act="sheetBackdrop"><div class="sheet" role="dialog" aria-modal="true" id="rdSheetBody"></div></div>
    <div class="toast rd-toast" id="rdToast" role="status" aria-live="polite"></div>`;
  deps.mount(root);
  const q = (id) => root.querySelector(`#${id}`);
  const scroll = q('rdScroll');

  const state = {
    row: ctx.row,
    pages: [],
    slots: [],
    current: 0,
    furthest: 0,
    chrome: false,
    frameMode: false,
    frame: new Map(),
    marked: false,
    completed: false,
    preloaded: null,
    activeMs: 0,
    lastTick: performance.now(),
    token: 0,
    progressTimer: null,
  };

  // ───────────────────────── الشريط والإعدادات ─────────────────────────

  function applySettings() {
    root.dataset.mode = settings.mode;
    root.dataset.fit = settings.fit;
    root.style.setProperty('--rd-gap', `${settings.gap}px`);
    // اللمس: بلا تكبير، المتصفح لا يُكبّر الصفحة بإصبعين ولا بلمستين
    root.dataset.pinch = String(settings.pinchZoom);
  }
  function setChrome(on) {
    state.chrome = on;
    root.classList.toggle('rd--chrome', on || state.frameMode);
  }
  function toast(text) {
    const t = q('rdToast');
    t.textContent = text;
    t.classList.add('show');
    clearTimeout(t._x);
    t._x = setTimeout(() => t.classList.remove('show'), 1800);
  }

  let sheetClose = null;
  function openSheet(build) {
    closeSheet();
    const body = q('rdSheetBody');
    body.innerHTML = '<div class="sheet-handle"></div>';
    sheetClose = build(body) ?? null;
    q('rdSheet').classList.add('show');
  }
  function closeSheet() {
    if (!q('rdSheet').classList.contains('show')) return false;
    q('rdSheet').classList.remove('show');
    sheetClose?.();
    sheetClose = null;
    return true;
  }
  function sheetItem(icon, label, run, { pressed, trail } = {}) {
    const b = el('button', 'sheet-item');
    b.type = 'button';
    b.innerHTML = glyph(icon);
    b.append(el('span', null, label));
    if (trail) {
      const t = el('span', 'value', trail);
      t.style.cssText = 'margin-inline-start:auto;color:var(--text-3);font-size:var(--fs-meta)';
      b.append(t);
    }
    if (pressed !== undefined) {
      b.setAttribute('aria-pressed', String(pressed));
      if (pressed) b.insertAdjacentHTML('beforeend', `<span class="trail">${glyph('check', { size: 20 })}</span>`);
    }
    b.onclick = run;
    return b;
  }

  // ───────────────────────── الفصل ─────────────────────────

  const keyOf = (row) => chapterKeyOf(ref, row);
  const nav = () => neighbors(sequence, state.row);

  function pagesOf(row) {
    const id = chapterId(row);
    let promise = pageLists.get(id);
    if (!promise) {
      promise = engine.pages(row.sourceId, row.chapter).then((list) => {
        if (!list.length) throw new Error('الفصل بلا صفحات عند المصدر');
        return list;
      });
      promise.catch(() => pageLists.delete(id));
      remember(pageLists, id, promise, MAX_CACHED_LISTS);
    }
    return promise;
  }

  function savedPage(row) {
    const saved = sync.rows('progress', (r) => r.user_id === me() && r.chapter_key === keyOf(row))[0];
    // فصلٌ أنهيته يبدأ من أوله إن فتحته ثانية
    if (!saved || saved.ratio >= 0.98) return 0;
    return Math.max(0, Math.floor(saved.page ?? 0));
  }

  async function openChapter(row, { startAt = null } = {}) {
    flushProgress();
    const previous = state.row;
    state.token += 1;
    const token = state.token;
    // صفحات الفصل السابق التي لم تبدأ لا تزاحم الجديد
    if (previous && previous !== row) {
      const old = chapterId(previous);
      scheduler.cancel((key, job) => key.startsWith(old + '#') && job.priority < PRIORITY.NEXT_CHAPTER);
    }
    Object.assign(state, {
      row,
      pages: [],
      slots: [],
      current: 0,
      furthest: 0,
      marked: isChapterRead(sync, ref, keyOf(row)),
      completed: false,
      preloaded: null,
      activeMs: 0,
      lastTick: performance.now(),
    });
    exitFrameMode();
    q('rdWork').textContent = ctx.title;
    q('rdChapter').textContent = [chapterLabel(row), row.label].filter(Boolean).join(' · ');
    const { prev, next } = nav();
    root.querySelector('.rd-prev').disabled = !prev;
    root.querySelector('.rd-next').disabled = !next;
    deps.setReading?.({
      seriesTitle: ctx.title,
      chapterLabel: chapterLabel(row),
      chapterNumber: Number.isFinite(row.number) && row.number >= 0 ? row.number : null,
    });

    scroll.replaceChildren(loadingBlock());
    scroll.scrollTo({ top: 0, left: 0, behavior: 'instant' });

    let pages;
    try {
      pages = await pagesOf(row);
    } catch (error) {
      if (token !== state.token) return;
      scroll.replaceChildren(chapterError(row, error));
      setChrome(true);
      return;
    }
    if (token !== state.token) return;
    state.pages = pages;
    renderPages(row, pages, startAt ?? savedPage(row));
  }

  function loadingBlock() {
    const d = el('div', 'rd-loading');
    d.setAttribute('aria-busy', 'true');
    d.innerHTML = '<span class="rd-spinner"></span>';
    d.append(el('span', null, 'جارٍ فتح الفصل'));
    return d;
  }
  function chapterError(row, error) {
    const d = el('div', 'rd-error');
    d.innerHTML = `<div class="empty-art">${glyph('offline')}</div>`;
    d.append(el('h3', null, 'ما قدرنا نفتح الفصل'));
    d.append(el('p', null, readableError(error)));
    const actions = el('div', 'rd-error-actions');
    const retry = el('button', 'btn btn-primary');
    retry.type = 'button';
    retry.innerHTML = `${glyph('refresh')}<span>أعد المحاولة</span>`;
    retry.onclick = () => void openChapter(row);
    actions.append(retry);
    if (otherSources(row).length) {
      const change = el('button', 'btn btn-secondary');
      change.type = 'button';
      change.innerHTML = `${glyph('layers')}<span>مصدر آخر</span>`;
      change.onclick = openSourceSheet;
      actions.append(change);
    }
    d.append(actions);
    return d;
  }
  function readableError(error) {
    const text = String(error?.message ?? error ?? '');
    const http = text.match(/HTTP (\d{3})/);
    if (http) return `المصدر ردّ بخطأ (HTTP ${http[1]}).`;
    if (/timeout|timed out/i.test(text)) return 'المصدر تأخّر في الرد.';
    if (/Unable to resolve|UnknownHost|network/i.test(text)) return 'ما فيه اتصال بالإنترنت، أو المصدر ما يوصل.';
    return text.slice(0, 140) || 'خطأ من المصدر.';
  }

  function renderPages(row, pages, startAt) {
    const fragment = document.createDocumentFragment();
    state.slots = pages.map((page, index) => {
      const frame = el('div', 'rd-page');
      frame.dataset.index = String(index);
      frame.setAttribute('aria-label', `صفحة ${index + 1} من ${pages.length}`);
      frame.append(el('div', 'skeleton'));
      fragment.append(frame);
      return { page, frame, loaded: false };
    });
    fragment.append(chapterEnd(row));
    scroll.replaceChildren(fragment);
    observePages();

    const start = Math.min(startAt, pages.length - 1);
    // الأولويات: الصفحة التي تبدأ منها، ثم ما يليها، ثم بقية الفصل
    state.slots.forEach((_, i) => {
      const priority = i === start ? PRIORITY.VISIBLE : i > start && i <= start + 3 ? PRIORITY.NEAR : PRIORITY.CHAPTER;
      void loadSlot(i, priority);
    });
    state.current = start;
    state.furthest = start;
    if (start > 0) {
      requestAnimationFrame(() => {
        jumpTo(start, false);
        toast(`كمّلت من صفحة ${start + 1}`);
      });
    }
    updateProgress();
  }

  async function loadSlot(index, priority) {
    const slot = state.slots[index];
    if (!slot || slot.loaded) return;
    const row = state.row;
    const token = state.token;
    try {
      const src = await scheduler.request(imageKey(row, index), { sourceId: row.sourceId, page: slot.page }, priority);
      if (token !== state.token) return;
      await placeImage(slot, src);
    } catch (error) {
      if (error?.cancelled || token !== state.token) return;
      slot.frame.replaceChildren(pageError(index, error));
      slot.frame.classList.add('rd-page--error');
    }
  }
  /** الصورة تُفكّ قبل أن توضع: الإطار يأخذ مقاسها الحقيقي دفعةً واحدة. */
  async function placeImage(slot, src) {
    const img = new Image();
    img.decoding = 'async';
    img.alt = '';
    img.draggable = false;
    img.src = src;
    try {
      await img.decode();
    } catch {
      // فكٌّ فاشل لصورة سليمة يحدث مع بعض الصيغ؛ onerror هو الحكم
      await new Promise((resolve, reject) => {
        if (img.complete && img.naturalWidth) return resolve();
        img.onload = resolve;
        img.onerror = () => reject(new Error('الصورة تالفة'));
      });
    }
    if (img.naturalWidth && img.naturalHeight) {
      slot.frame.style.aspectRatio = `${img.naturalWidth} / ${img.naturalHeight}`;
    }
    slot.frame.classList.remove('rd-page--error');
    slot.frame.replaceChildren(img);
    slot.loaded = true;
    slot.src = src;
  }
  function pageError(index, error) {
    const box = el('div', 'rd-page-error');
    box.innerHTML = glyph('image');
    box.append(el('span', null, `صفحة ${index + 1} ما تحمّلت`));
    box.append(el('small', null, readableError(error)));
    const retry = el('button', 'btn btn-secondary');
    retry.type = 'button';
    retry.innerHTML = `${glyph('refresh')}<span>أعد</span>`;
    retry.onclick = (e) => {
      e.stopPropagation();
      state.slots[index].frame.replaceChildren(el('div', 'skeleton'));
      void loadSlot(index, PRIORITY.VISIBLE);
    };
    box.append(retry);
    return box;
  }

  /**
   * نهاية الفصل: سطران بعد آخر صفحة، مندمجان مع القارئ. لا شاشة ولا أزرار
   * كثيرة: «الفصل 112 انتهى» ثم «الفصل التالي 113» والرقم يفتحه.
   */
  function chapterEnd(row) {
    const { next } = nav();
    const end = el('section', 'rd-end');
    end.setAttribute('aria-label', 'نهاية الفصل');
    const done = el('div', 'rd-end-done');
    done.append(el('span', null, 'الفصل'));
    const doneNo = el('strong', null, `${chapterShort(row)} انتهى`);
    doneNo.dir = 'auto';
    done.append(doneNo);
    end.append(done);
    if (next) {
      const go = el('button', 'rd-end-next');
      go.type = 'button';
      go.append(el('span', null, 'الفصل التالي'));
      const no = el('strong', null, chapterShort(next));
      no.dir = 'auto';
      go.append(no);
      go.setAttribute('aria-label', `افتح ${chapterLabel(next)}`);
      go.onclick = (e) => {
        e.stopPropagation();
        void openChapter(next, { startAt: 0 });
      };
      end.append(go);
    } else {
      end.append(el('p', 'rd-end-last', 'هذا آخر فصل متوفر'));
    }
    return end;
  }

  // ───────────────────────── التمرير والتقدّم ─────────────────────────

  let observer = null;
  function observePages() {
    observer?.disconnect();
    const visible = new Map();
    observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) visible.set(Number(e.target.dataset.index), e.intersectionRatio);
        let best = state.current;
        let bestRatio = -1;
        for (const [i, r] of visible) {
          if (r > bestRatio) {
            best = i;
            bestRatio = r;
          }
        }
        if (bestRatio > 0) onPage(best);
      },
      { root: scroll, threshold: [0, 0.25, 0.5, 0.75, 1] },
    );
    for (const s of state.slots) observer.observe(s.frame);
  }
  function onPage(index) {
    if (index === state.current && index <= state.furthest) return;
    state.current = index;
    state.furthest = Math.max(state.furthest, index);
    // ما أمامك يسبق: الصفحة الحالية والثلاث التي بعدها
    for (let i = index; i <= index + 3; i++) {
      const s = state.slots[i];
      if (s && !s.loaded) scheduler.bump(imageKey(state.row, i), i === index ? PRIORITY.VISIBLE : PRIORITY.NEAR);
    }
    updateProgress();
    afterProgress();
  }
  function updateProgress() {
    const n = state.pages.length;
    q('rdPageLabel').textContent = n ? `${state.current + 1} / ${n}` : '';
    q('rdProgress').style.width = `${n ? ((state.current + 1) / n) * 100 : 0}%`;
  }
  function tickActive() {
    const now = performance.now();
    if (document.visibilityState === 'visible') state.activeMs += Math.min(now - state.lastTick, 30_000);
    state.lastTick = now;
  }
  function afterProgress() {
    tickActive();
    const ratio = readRatio(state.furthest, state.pages.length);
    // العين عند ٢٠٪ — هذا الفصل وحده
    if (shouldAutoMark({ ratio, alreadyRead: state.marked })) {
      state.marked = true;
      markChapter(sync, ref, state.row, true);
    }
    // إحصاء القراءة الكاملة: الخادم يعيد التحقق من العتبة والوقت
    if (!state.completed && ratio >= 0.9 && state.activeMs >= 5_000) {
      state.completed = true;
      sync.enqueue('chapter.complete', {
        chapterKey: keyOf(state.row),
        seriesRef: ref,
        chapterNumber: Number.isFinite(state.row.number) && state.row.number >= 0 ? state.row.number : null,
        ratio,
        activeMs: Math.round(state.activeMs),
      });
    }
    if (ratio >= PRELOAD_FROM_RATIO) preloadNext();
    clearTimeout(state.progressTimer);
    state.progressTimer = setTimeout(flushProgress, 1500);
  }
  function flushProgress() {
    clearTimeout(state.progressTimer);
    state.progressTimer = null;
    if (!state.row || !state.pages.length) return;
    sync.enqueue('progress.set', {
      chapterKey: keyOf(state.row),
      seriesRef: ref,
      page: state.current,
      ratio: readRatio(state.furthest, state.pages.length),
    });
  }

  /**
   * تجهيز الفصل التالي في الخلفية.
   *
   * مرة واحدة لكل فصل، وحسب الشبكة وإعدادك (`nextChapterPlan`). الصور بأولوية
   * `NEXT_CHAPTER`: الطابور لا يبدأها وفي الفصل الحالي صفحة لم تُحمّل.
   */
  function preloadNext() {
    const { next } = nav();
    if (!next || state.preloaded === chapterId(next)) return;
    state.preloaded = chapterId(next);
    const plan = nextChapterPlan({ mode: settings.prefetch, network: readNetwork() });
    if (!plan.pageList) return;
    pagesOf(next)
      .then((pages) => {
        const count = Math.min(pages.length, plan.images);
        for (let i = 0; i < count; i++) {
          void scheduler.request(imageKey(next, i), { sourceId: next.sourceId, page: pages[i] }, PRIORITY.NEXT_CHAPTER).catch(() => {});
        }
        scheduler.trim(MAX_CACHED_IMAGES);
      })
      .catch(() => {
        // فشل التجهيز لا يُقال: الفصل التالي سيحاول من جديد حين يُفتح
        state.preloaded = null;
      });
  }

  function jumpTo(index, smooth = true) {
    const slot = state.slots[index];
    if (!slot) return;
    if (settings.mode === 'paged') {
      slot.frame.scrollIntoView({ behavior: smooth ? 'smooth' : 'instant', inline: 'start', block: 'nearest' });
    } else {
      scroll.scrollTo({ top: slot.frame.offsetTop, behavior: smooth ? 'smooth' : 'instant' });
    }
  }

  // ───────────────────────── اللمس ─────────────────────────

  let lastTap = 0;
  let tapTimer = null;
  let down = null;
  scroll.addEventListener('pointerdown', (e) => {
    down = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId };
  });
  scroll.addEventListener('pointerup', (e) => {
    if (!down || down.id !== e.pointerId) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    const quick = performance.now() - down.t < 350;
    down = null;
    if (moved > 10 || !quick) return;
    if (e.target.closest('button')) return;
    const frame = e.target.closest('.rd-page');
    const now = performance.now();
    if (settings.doubleTapZoom && now - lastTap < 280 && frame) {
      clearTimeout(tapTimer);
      lastTap = 0;
      openZoom(frame, e.clientX, e.clientY);
      return;
    }
    lastTap = now;
    const act = () => onTap(e, frame);
    // مع اللمسة المزدوجة ننتظر لنعرف: بدونها الاستجابة فورية
    if (settings.doubleTapZoom) tapTimer = setTimeout(act, 260);
    else act();
  });
  function onTap(e, frame) {
    if (state.frameMode) {
      if (frame) toggleFramePage(Number(frame.dataset.index));
      return;
    }
    if (settings.mode === 'paged') {
      // اتجاه عربي: يسار الشاشة للأمام، يمينها للخلف، والوسط للشريط
      const x = e.clientX / window.innerWidth;
      if (x < 0.3) return void jumpTo(Math.min(state.current + 1, state.slots.length - 1));
      if (x > 0.7) return void jumpTo(Math.max(state.current - 1, 0));
    }
    setChrome(!state.chrome);
  }
  let lastScrollY = 0;
  scroll.addEventListener(
    'scroll',
    () => {
      const y = settings.mode === 'paged' ? scroll.scrollLeft : scroll.scrollTop;
      // التمرير يُخفي الشريط: القراءة لا تتوقف لتغلقه
      if (state.chrome && !state.frameMode && Math.abs(y - lastScrollY) > 24) setChrome(false);
      lastScrollY = y;
    },
    { passive: true },
  );

  // ── التكبير (من الإعدادات فقط) ──

  const zoom = { scale: 1, x: 0, y: 0, start: null };
  function openZoom(frame, cx, cy) {
    const img = frame.querySelector('img');
    if (!img) return;
    const z = q('rdZoom');
    const zi = q('rdZoomImg');
    zi.src = img.src;
    z.hidden = false;
    zoom.scale = 2.2;
    zoom.x = (window.innerWidth / 2 - cx) * (zoom.scale - 1);
    zoom.y = (window.innerHeight / 2 - cy) * (zoom.scale - 1);
    paintZoom();
  }
  function closeZoom() {
    const z = q('rdZoom');
    if (z.hidden) return false;
    z.hidden = true;
    zoom.scale = 1;
    return true;
  }
  function paintZoom() {
    q('rdZoomImg').style.transform = `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.scale})`;
  }
  const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  scroll.addEventListener(
    'touchstart',
    (e) => {
      if (!settings.pinchZoom || e.touches.length !== 2) return;
      const frame = e.target.closest('.rd-page');
      if (!frame) return;
      const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      openZoom(frame, cx, cy);
      zoom.scale = 1;
      zoom.x = 0;
      zoom.y = 0;
      zoom.start = { d: dist(e.touches), scale: 1 };
      paintZoom();
    },
    { passive: true },
  );
  const zoomEl = q('rdZoom');
  zoomEl.addEventListener(
    'touchstart',
    (e) => {
      if (e.touches.length === 2) zoom.start = { d: dist(e.touches), scale: zoom.scale };
      else if (e.touches.length === 1) zoom.pan = { x: e.touches[0].clientX - zoom.x, y: e.touches[0].clientY - zoom.y };
    },
    { passive: true },
  );
  window.addEventListener('touchmove', onZoomMove, { passive: true });
  function onZoomMove(e) {
    if (zoomEl.hidden) return;
    if (e.touches.length === 2 && zoom.start) {
      zoom.scale = Math.min(5, Math.max(1, zoom.start.scale * (dist(e.touches) / zoom.start.d)));
      paintZoom();
    } else if (e.touches.length === 1 && zoom.pan && zoom.scale > 1) {
      zoom.x = e.touches[0].clientX - zoom.pan.x;
      zoom.y = e.touches[0].clientY - zoom.pan.y;
      paintZoom();
    }
  }
  zoomEl.addEventListener('touchend', (e) => {
    if (e.touches.length === 0) {
      zoom.start = null;
      zoom.pan = null;
      // الإفلات قرب الحجم الطبيعي يرجعك للقراءة
      if (zoom.scale < 1.08) closeZoom();
    }
  });
  zoomEl.addEventListener('click', (e) => {
    if (e.target === zoomEl) closeZoom();
  });

  // ───────────────────────── فريم ─────────────────────────

  function enterFrameMode() {
    if (!state.slots.length) return;
    state.frameMode = true;
    state.frame = new Map();
    const slot = state.slots[state.current];
    if (slot) state.frame.set(state.current, slot.page);
    root.classList.add('rd--frame');
    q('rdTop').hidden = true;
    q('rdFrameTop').hidden = false;
    q('rdBottom').hidden = true;
    q('rdTray').hidden = false;
    setChrome(true);
    paintFrame();
  }
  function exitFrameMode() {
    if (!state.frameMode) return false;
    state.frameMode = false;
    root.classList.remove('rd--frame');
    q('rdTop').hidden = false;
    q('rdFrameTop').hidden = true;
    q('rdBottom').hidden = false;
    q('rdTray').hidden = true;
    for (const s of state.slots) {
      s.frame.classList.remove('rd-page--picked');
      s.frame.removeAttribute('data-order');
    }
    setChrome(false);
    return true;
  }
  function toggleFramePage(index) {
    const slot = state.slots[index];
    if (!slot) return;
    if (state.frame.has(index)) state.frame.delete(index);
    else if (state.frame.size >= MAX_FRAME_PAGES) return void toast(`حدّ الفريم ${countLabel(MAX_FRAME_PAGES, 'page')}`);
    else state.frame.set(index, slot.page);
    paintFrame();
  }
  function paintFrame() {
    const order = [...state.frame.keys()];
    for (const s of state.slots) {
      const i = Number(s.frame.dataset.index);
      const at = order.indexOf(i);
      s.frame.classList.toggle('rd-page--picked', at >= 0);
      if (at >= 0) s.frame.dataset.order = String(at + 1);
      else s.frame.removeAttribute('data-order');
    }
    q('rdFrameCount').textContent = `${state.frame.size} من ${MAX_FRAME_PAGES}`;
    q('rdFrameNext').disabled = state.frame.size === 0;
    q('rdTrayHint').hidden = state.frame.size > 1;
    q('rdTrayStrip').replaceChildren(
      ...order.map((i, n) => {
        const b = el('button', 'rd-thumb');
        b.type = 'button';
        b.setAttribute('aria-label', `شيل صفحة ${i + 1}`);
        const src = state.slots[i]?.src;
        if (src) {
          const img = el('img');
          img.src = src;
          img.alt = '';
          b.append(img);
        }
        b.append(el('span', null, String(n + 1)));
        b.onclick = () => toggleFramePage(i);
        return b;
      }),
    );
  }

  /** الإرسال خطوتان: لمن، ثم (لشخص) مَن يُخفى عنه في المجلس. */
  function openFrameSend() {
    if (!state.frame.size || !deps.sendFrame) return;
    const friends = deps.friends?.() ?? [];
    const message = { value: '' };
    const pick = (body) => {
      body.append(el('h3', null, 'أرسل الفريم إلى'));
      const preview = el('div', 'rd-send-preview');
      for (const i of state.frame.keys()) {
        const src = state.slots[i]?.src;
        const cell = el('div', 'rd-send-page');
        if (src) {
          const img = el('img');
          img.src = src;
          img.alt = `صفحة ${i + 1}`;
          cell.append(img);
        }
        preview.append(cell);
      }
      body.append(preview);
      const note = el('textarea', 'search-input rd-send-note');
      note.rows = 2;
      note.maxLength = 500;
      note.placeholder = 'كلمة معه (اختياري)';
      note.value = message.value;
      note.oninput = () => (message.value = note.value);
      body.append(note);
      body.append(personRow({ displayName: 'الجميع', everyone: true }, () => choose(null)));
      for (const f of friends) body.append(personRow(f, () => choose(f)));
    };
    const choose = (target) => {
      const body = q('rdSheetBody');
      body.innerHTML = '<div class="sheet-handle"></div>';
      const head = el('div', 'rd-send-head');
      const back = el('button', 'icon-btn');
      back.type = 'button';
      back.setAttribute('aria-label', 'رجوع');
      back.title = 'رجوع';
      back.innerHTML = glyph('back');
      back.onclick = () => {
        body.innerHTML = '<div class="sheet-handle"></div>';
        pick(body);
      };
      const titleBox = el('div');
      titleBox.append(el('h3', null, target ? `إلى ${target.displayName}` : 'إلى الجميع'));
      titleBox.append(el('p', null, 'يظهر في المجلس لأصدقائك. أخفِه عمّن تبي.'));
      head.append(back, titleBox);
      body.append(head);
      const hidden = new Set();
      const others = friends.filter((f) => f.userId !== target?.userId);
      for (const f of others) {
        const row = el('label', 'rd-switch-row');
        row.append(avatar(f, 36));
        row.append(el('span', null, `إخفاء عن ${f.displayName}`));
        const input = el('input');
        input.type = 'checkbox';
        input.className = 'switch-input';
        input.setAttribute('role', 'switch');
        input.onchange = () => (input.checked ? hidden.add(f.userId) : hidden.delete(f.userId));
        row.append(input);
        body.append(row);
      }
      const send = el('button', 'btn btn-primary btn-block rd-send-go');
      send.type = 'button';
      send.innerHTML = `${glyph('send')}<span>أرسل الفريم</span>`;
      send.onclick = () => {
        deps.sendFrame(
          buildFramePayload({
            toId: target?.userId ?? null,
            sourceId: state.row.sourceId,
            manga: state.row.manga,
            chapter: state.row.chapter,
            pages: [...state.frame.entries()].map(([index, page]) => ({ index, url: page.url ?? '', imageUrl: page.imageUrl ?? null })),
            message: message.value,
            hiddenFrom: [...hidden],
          }),
        );
        closeSheet();
        toast(target ? `انرسل لـ ${target.displayName}` : 'انرسل للجميع');
        exitFrameMode();
      };
      body.append(send);
    };
    openSheet(pick);
  }
  function avatar(person, size) {
    if (person.everyone) {
      const s = el('span', 'avatar-letter rd-everyone');
      s.innerHTML = glyph('users', { size: 20 });
      s.style.cssText = `width:${size}px;height:${size}px;border-radius:99px;flex:none`;
      return s;
    }
    if (person.avatarKey) {
      const img = el('img');
      img.src = person.avatarKey;
      img.alt = '';
      img.style.cssText = `width:${size}px;height:${size}px;border-radius:99px;object-fit:cover;flex:none`;
      return img;
    }
    const s = el('span', 'avatar-letter', [...String(person.displayName || '؟')][0]);
    s.style.cssText = `width:${size}px;height:${size}px;border-radius:99px;flex:none`;
    return s;
  }
  function personRow(person, run) {
    const b = el('button', 'sheet-item');
    b.type = 'button';
    b.append(avatar(person, 40), el('span', null, person.displayName));
    b.insertAdjacentHTML('beforeend', glyph('chevron', { cls: 'icon chev' }));
    b.onclick = run;
    return b;
  }

  // ───────────────────────── قائمة ⋮ ─────────────────────────

  function openMenu() {
    openSheet((body) => {
      const t = el('h3', null, chapterLabel(state.row));
      t.dir = 'auto';
      t.style.marginBottom = '6px';
      body.append(t);
      body.append(sheetItem('sliders', 'إعدادات القارئ', openSettings));
      body.append(sheetItem('info', 'معلومات الفصل', openInfo));
      body.append(sheetItem('layers', 'المصدر', openSourceSheet, { trail: state.row.label ?? '' }));
      if (deps.friends) body.append(sheetItem('share', 'رشّح هذا الفصل', openShareChapter));
      if (deps.report) body.append(sheetItem('flag', 'بلّغ عن مشكلة', openReport));
    });
  }

  function segmented(label, options, value, onPick) {
    const wrap = el('div', 'rd-setting');
    wrap.append(el('div', 'rd-setting-label', label));
    const seg = el('div', 'rd-seg');
    seg.setAttribute('role', 'radiogroup');
    seg.setAttribute('aria-label', label);
    for (const [v, text, icon] of options) {
      const b = el('button', 'rd-seg-item');
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(v === value));
      if (icon) b.innerHTML = glyph(icon, { size: 20 });
      b.append(el('span', null, text));
      b.onclick = () => onPick(v);
      seg.append(b);
    }
    wrap.append(seg);
    return wrap;
  }
  function toggleRow(label, hint, value, onChange) {
    const row = el('label', 'rd-switch-row');
    const texts = el('div');
    texts.append(el('span', null, label));
    if (hint) texts.append(el('small', null, hint));
    row.append(texts);
    const input = el('input');
    input.type = 'checkbox';
    input.className = 'switch-input';
    input.setAttribute('role', 'switch');
    input.checked = value;
    input.onchange = () => onChange(input.checked);
    row.append(input);
    return row;
  }
  function openSettings() {
    const change = (key, value) => {
      const before = settings.mode;
      settings[key] = value;
      saveSettings(settings);
      applySettings();
      if (key === 'mode' && before !== value && state.slots.length) {
        const at = state.current;
        requestAnimationFrame(() => jumpTo(at, false));
      }
      openSettings();
    };
    openSheet((body) => {
      body.append(el('h3', null, 'إعدادات القارئ'));
      body.append(
        segmented('طريقة القراءة', [['vertical', 'تمرير عمودي', 'scroll'], ['paged', 'صفحة صفحة', 'pages']], settings.mode, (v) => change('mode', v)),
      );
      if (settings.mode === 'paged') {
        body.append(segmented('ملاءمة الصفحة', [['width', 'العرض', 'fitWidth'], ['height', 'الشاشة', 'fitHeight']], settings.fit, (v) => change('fit', v)));
      }
      body.append(segmented('المسافة بين الصفحات', [[0, 'بلا'], [8, 'صغيرة'], [24, 'كبيرة']], settings.gap, (v) => change('gap', v)));
      body.append(toggleRow('التكبير بلمستين', 'لمستان سريعتان تكبّران الصفحة', settings.doubleTapZoom, (v) => change('doubleTapZoom', v)));
      body.append(toggleRow('التكبير بإصبعين', 'افتح إصبعيك على الصفحة لتكبيرها', settings.pinchZoom, (v) => change('pinchZoom', v)));
      body.append(
        segmented(
          'تجهيز الفصل التالي',
          [['smart', 'ذكي'], ['wifi', 'Wi‑Fi فقط'], ['always', 'دائمًا'], ['never', 'أوقف']],
          settings.prefetch,
          (v) => change('prefetch', v),
        ),
      );
      const hint = el('p', 'rd-setting-hint', 'الذكي يجهّز الفصل كاملًا على Wi‑Fi، وقائمة صفحاته فقط على بيانات الجوال أو مع توفير البيانات.');
      body.append(hint);
    });
  }
  function openInfo() {
    const r = state.row;
    openSheet((body) => {
      const t = el('h3', null, chapterLabel(r));
      t.dir = 'auto';
      body.append(t);
      const grid = el('div', 'info-grid');
      grid.style.marginTop = '12px';
      const pairs = [
        ['العمل', ctx.title],
        ['المصدر', r.label || '—'],
        ['الصفحات', state.pages.length ? String(state.pages.length) : '—'],
        ['المترجم', r.chapter?.scanlator || '—'],
        ['تاريخ الرفع', r.chapter?.dateUpload ? new Date(r.chapter.dateUpload).toLocaleDateString('ar', { numberingSystem: 'latn' }) : '—'],
        ['حالتك', isChapterRead(sync, ref, keyOf(r)) ? 'مقروء' : 'غير مقروء'],
      ];
      for (const [a, b] of pairs) {
        const d = el('div', 'info-box');
        const v = el('div', 'info-value', b);
        v.dir = 'auto';
        d.append(el('div', 'info-label', a), v);
        grid.append(d);
      }
      body.append(grid);
    });
  }
  /** نسخ هذا الفصل نفسه (بالرقم) عند مصادر العمل الأخرى. */
  function otherSources(row) {
    const editions = ctx.work?._editions ?? [];
    if (!Number.isFinite(row.number) || row.number < 0) return [];
    return editions
      .filter((e) => e.sourceId !== row.sourceId)
      .map((e) => editionRows(ctx.work, e.sourceId).find((r) => r.number === row.number))
      .filter(Boolean);
  }
  function openSourceSheet() {
    const here = state.row;
    const others = otherSources(here);
    openSheet((body) => {
      body.append(el('h3', null, 'المصدر'));
      const note = el('p', null, others.length ? 'نفس الفصل عند مصادر ثانية. التبديل يكمّل من نفس الصفحة.' : 'هذا الفصل متوفر عند هذا المصدر فقط.');
      note.style.marginBottom = '8px';
      body.append(note);
      body.append(sheetItem('layers', here.label || 'المصدر الحالي', closeSheet, { pressed: true }));
      for (const r of others) {
        body.append(
          sheetItem('layers', r.label, () => {
            closeSheet();
            const at = state.current;
            void openChapter(r, { startAt: at });
          }),
        );
      }
    });
  }
  function openShareChapter() {
    openShareSheet({
      sync,
      friends: deps.friends?.() ?? [],
      openSheet,
      closeSheet,
      sheetBody: () => q('rdSheetBody'),
      toast,
      work: { ref, title: ctx.title, cover: ctx.work?.coverImage?.large ?? state.row.manga?.thumbnailUrl ?? null },
      chapter: {
        label: chapterLabel(state.row),
        number: Number.isFinite(state.row.number) && state.row.number >= 0 ? state.row.number : null,
      },
    });
  }
  const REPORTS = [
    ['CHAPTER_WONT_OPEN', 'الفصل ما يفتح'],
    ['MISSING_PAGE', 'صفحة ناقصة'],
    ['WRONG_ORDER', 'ترتيب الصفحات خطأ'],
    ['WRONG_CHAPTER', 'الفصل غلط'],
    ['LOW_QUALITY', 'جودة الصور ضعيفة'],
    ['OTHER', 'شيء ثاني'],
  ];
  function openReport() {
    openSheet((body) => {
      body.append(el('h3', null, 'وش المشكلة؟'));
      for (const [kind, label] of REPORTS) {
        body.append(
          sheetItem('flag', label, async () => {
            closeSheet();
            try {
              await deps.report({
                kind,
                seriesRef: ref,
                chapterRef: keyOf(state.row),
                sourceId: state.row.sourceId,
                pageIndex: kind === 'MISSING_PAGE' || kind === 'LOW_QUALITY' ? state.current : undefined,
              });
              toast('وصل البلاغ، شكرًا');
            } catch {
              toast('ما قدرنا نرسل البلاغ الآن');
            }
          }),
        );
      }
    });
  }

  // ───────────────────────── الأفعال والرجوع ─────────────────────────

  const actions = {
    exit: () => exit(),
    frame: () => enterFrameMode(),
    frameCancel: () => exitFrameMode(),
    frameNext: () => openFrameSend(),
    menu: () => openMenu(),
    prevChapter: () => {
      const { prev } = nav();
      if (prev) void openChapter(prev, { startAt: 0 });
    },
    nextChapter: () => {
      const { next } = nav();
      if (next) void openChapter(next, { startAt: 0 });
    },
    sheetBackdrop: (e) => {
      if (e.target === q('rdSheet')) closeSheet();
    },
  };
  root.addEventListener('click', (e) => {
    const t = e.target.closest('[data-act]');
    if (!t || !root.contains(t)) return;
    actions[t.dataset.act]?.(e, t);
  });
  const onKey = (e) => {
    if (e.key === 'Escape') handleBack();
    if (e.key === 'ArrowLeft' && settings.mode === 'paged') jumpTo(Math.min(state.current + 1, state.slots.length - 1));
    if (e.key === 'ArrowRight' && settings.mode === 'paged') jumpTo(Math.max(state.current - 1, 0));
  };
  document.addEventListener('keydown', onKey);
  const onVisibility = () => {
    tickActive();
    if (document.visibilityState === 'hidden') flushProgress();
  };
  document.addEventListener('visibilitychange', onVisibility);

  /** رجوع أندرويد: الورقة، ثم التكبير، ثم وضع الفريم، ثم الخروج. */
  function handleBack() {
    if (closeSheet() || closeZoom() || exitFrameMode()) return true;
    exit();
    return true;
  }
  let exited = false;
  function exit() {
    if (exited) return;
    exited = true;
    tickActive();
    flushProgress();
    destroy();
    deps.exit();
  }
  function destroy() {
    observer?.disconnect();
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('touchmove', onZoomMove);
    clearTimeout(state.progressTimer);
    deps.setReading?.(null);
    deps.immersive?.(false);
  }

  applySettings();
  deps.immersive?.(true);
  void openChapter(ctx.row);

  return { root, handleBack, destroy: () => !exited && (exited = true, flushProgress(), destroy()) };
}
