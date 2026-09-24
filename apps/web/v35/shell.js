/**
 * واجهة VANTARA — الرئيسية، صفحة العمل، المكتبة، الاستكشاف، الدرج.
 *
 * هوية v35 كما هي (البانر الدائري، الاختصارات، الشرائط، الدرج)، ومصدر
 * الحقيقة منّا:
 *
 *   - الأعمال من مصادرنا عبر المحرّك (`works.js`)، مدموجةً عبر المصادر.
 *   - المكتبة والمفضلة و«أقرأ لاحقًا» والتقييم وعين الفصل في حسابك عبر
 *     المزامنة — تظهر على أجهزتك كلها ويراها أصدقاؤك.
 *
 * والشاشات التي لم تُنقل بعد (الإشعارات، ملفي…) تُفتح عبر `deps.go`.
 */

import { SHELL_HTML } from './markup.js';
import { glyph } from './icons.js';
import { CHECK_STEPS, available, browse, browseLive, checkAllSources, describe, editionRows, loadWork, prewarm, seriesRefOf } from './works.js';
import { readKv, writeKv } from '../lib/chapter-store.js';
import { warmChapter } from './reader.js';
import { endWorkSession, setTranslation, translationOn } from './reader-translate.js';
import engine from '../lib/extension-engine.js';
import { chapterKeyOf, clearChapterMarks, isChapterRead, markChapter, markChapters } from './reading.js';
import { titlesMatch } from '../lib/catalog.js';
import { announceCover, cachedCover, coverCandidates, forgetCover, knownCover, nativeCover, onCoverKnown, rememberCover } from './covers.js';
import { readTranslateSettings, writeTranslateSettings } from '../lib/translate-settings.js';
import { benchmarkEngines, benchmarkPage, downloadModels, formatBytes, jobFinished, jobProgress, jobStop, modelsStatus, nativeTranslationAvailable, notificationPermission, removeModels } from '../lib/translation-native.js';
import { clearPerf, engineLines, formatReport, readPerf, summarize, totalOf } from '../lib/translate-perf.js';
import { BLOCK_TEXT, createJob, createJobRunner, englishSources, estimateMinutes, finishedText, pickChapters, progressOf, readPace } from '../lib/translate-jobs.js';
import { cachedPage, readerQuiet, translatePage } from '../lib/translate.js';
import { countLabel } from './plural.js';
import { frameIdFromLink } from '../lib/frame.js';
import { createMajlis } from './majlis.js';
import { compactEditions, describesMore, displayTitle, mergeEditions, serverEditions } from './work-ref.js';
import { createProfile } from './profile.js';
import { openShareSheet } from './share.js';
import { openProfileEditor } from './profile-editor.js';

const AR_GENRE = {
  Action: 'أكشن', Adventure: 'مغامرة', Fantasy: 'فانتازيا', Drama: 'دراما', Comedy: 'كوميديا', Romance: 'رومانسي',
  Supernatural: 'قوى خارقة', 'Sci-Fi': 'خيال علمي', Mystery: 'غموض', Thriller: 'إثارة', Horror: 'رعب', Sports: 'رياضة',
  Psychological: 'نفسي', Mecha: 'ميكا', Music: 'موسيقى', 'Slice of Life': 'حياة يومية', Isekai: 'إيسيكاي',
  Historical: 'تاريخي', Superhero: 'أبطال خارقون', Tragedy: 'مأساة', Medical: 'طبي', Philosophical: 'فلسفي',
  Crime: 'جريمة', 'Magical Girls': 'فتيات سحريات', Wuxia: 'ووشيا',
};
const STATUS_AR = { FINISHED: 'مكتمل', RELEASING: 'مستمر', HIATUS: 'متوقف مؤقتًا', CANCELLED: 'ملغي', NOT_YET_RELEASED: 'لم يبدأ' };
/**
 * التصنيفات وأسماؤها في المصادر. كل مصدر يسمّي تصنيفه بطريقته، فتُرسل
 * الصيغ كلها ويطابقها المحرّك بعد التطبيع (`GenreFilterPolicy`).
 * `hue` لون البلاطة: ثابت لكل تصنيف فتُعرف بلونها قبل اسمها.
 */
const GENRES = [
  { ar: 'أكشن', en: 'Action', hue: 8, names: ['أكشن', 'اكشن', 'Action'] },
  { ar: 'مغامرة', en: 'Adventure', hue: 28, names: ['مغامرة', 'مغامرات', 'Adventure'] },
  { ar: 'فانتازيا', en: 'Fantasy', hue: 265, names: ['فانتازيا', 'فنتازيا', 'خيال', 'Fantasy'] },
  { ar: 'رومانسي', en: 'Romance', hue: 335, names: ['رومانسي', 'رومانسية', 'رومانس', 'Romance'] },
  { ar: 'كوميديا', en: 'Comedy', hue: 45, names: ['كوميديا', 'كوميدي', 'Comedy'] },
  { ar: 'دراما', en: 'Drama', hue: 215, names: ['دراما', 'Drama'] },
  { ar: 'غموض', en: 'Mystery', hue: 190, names: ['غموض', 'Mystery'] },
  { ar: 'رعب', en: 'Horror', hue: 355, names: ['رعب', 'Horror'] },
  { ar: 'نفسي', en: 'Psychological', hue: 290, names: ['نفسي', 'نفسية', 'Psychological'] },
  { ar: 'خيال علمي', en: 'Sci-Fi', hue: 175, names: ['خيال علمي', 'Sci-Fi', 'Science Fiction', 'SciFi'] },
  { ar: 'قوى خارقة', en: 'Supernatural', hue: 245, names: ['قوى خارقة', 'خارق للطبيعة', 'خوارق', 'Supernatural'] },
  { ar: 'إثارة', en: 'Thriller', hue: 0, names: ['إثارة', 'اثارة', 'تشويق', 'Thriller'] },
  { ar: 'رياضة', en: 'Sports', hue: 140, names: ['رياضة', 'رياضي', 'Sports', 'Sport'] },
  { ar: 'حياة يومية', en: 'Slice of Life', hue: 95, names: ['حياة يومية', 'شريحة من الحياة', 'Slice of Life'] },
  { ar: 'إيسيكاي', en: 'Isekai', hue: 205, names: ['إيسيكاي', 'ايسيكاي', 'عالم آخر', 'Isekai'] },
  { ar: 'فنون قتالية', en: 'Martial Arts', hue: 18, names: ['فنون قتالية', 'فنون القتال', 'Martial Arts'] },
  { ar: 'تاريخي', en: 'Historical', hue: 38, names: ['تاريخي', 'تاريخ', 'Historical'] },
  { ar: 'مدرسي', en: 'School Life', hue: 225, names: ['مدرسي', 'حياة مدرسية', 'مدرسة', 'School Life', 'School'] },
];

/** كم فصلًا يُرسم أول مرة. عمل بألف فصل لا يرسم ألف صف قبل أن يظهر شيء. */
const CHAPTER_BATCH = 60;

const drawerGroups = [
  ['', [['الرئيسية', 'home', 'home'], ['مكتبتي', 'library', 'library'], ['اكتشف', 'discover', 'compass']]],
  ['الاجتماع', [['الأصدقاء', 'friends', 'users'], ['المجلس', 'majlisFeed', 'activity'], ['الإشعارات', 'notifications', 'bell'], ['التوصيات', 'recommendations', 'spark']]],
  ['قوائمي', [['المفضلة', 'favorites', 'heart'], ['أقرأ لاحقًا', 'later', 'clock'], ['آخر المشاهدات', 'history', 'history']]],
  ['', [['الإعدادات', 'settings', 'settings'], ['تبديل الحساب', 'switchAccount', 'switchUser']]],
];

const WORKS_KEY = 'vantara.v35.works';
const HISTORY_KEY = 'vantara.v35.history';

function readJson(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key) ?? '') ?? fallback;
  } catch {
    return fallback;
  }
}
function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // الحصة ممتلئة: ذاكرة مساعدة لا مصدر حقيقة
  }
}

const clean = (s) => (s || '').replace(/<[^>]*>/g, ' ').replace(/[ \t]+/g, ' ').trim();
// المرجع الداخلي (`ext:…`) لا يصل للشاشة أبدًا، ولو غاب كل اسم آخر
const titleOf = (w) => displayTitle(w?.id, w?.title?.english, w?.title?.romaji, typeof w?.title === 'string' ? w.title : null);
const unique = (arr) => [...new Set(arr.filter(Boolean))];
const uniqueById = (items) => {
  const seen = new Set();
  return items.filter((x) => x && x.id && !seen.has(x.id) && seen.add(x.id));
};
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};
const genreAr = (g) => AR_GENRE[g] || g;
const initialOf = (text) => [...String(text || '؟').trim()][0]?.toUpperCase() ?? '؟';

/**
 * @param {{ sync: any, mount: (node: Element) => void, go: (route: object) => Promise<void>,
 *           openReader: (route: object) => void, switchAccount: () => void, version: string,
 *           friends?: () => Array<{userId: string, displayName: string, avatarKey: string|null}>,
 *           report?: (input: object) => Promise<unknown> }} deps
 */
export function mountV35(deps, { page = 'home' } = {}) {
  const { sync } = deps;
  const root = el('div', 'v35');
  root.innerHTML = SHELL_HTML;
  deps.mount(root);
  const q = (id) => root.querySelector(`#${id}`);

  const state = {
    home: { trending: [], featured: [], recent: [], popular: [] },
    current: null,
    nextRow: null,
    stack: [],
    catalog: [],
    catalogPage: 0,
    catalogHasNext: true,
    discoverQuery: '',
    collection: { kind: 'catalogue', page: 0, hasNext: true, items: [] },
    searchTimer: null,
    eyeTimer: null,
    heroItems: [],
    heroPhysicalIndex: 1,
    heroTimer: null,
    heroStartX: 0,
    heroDeltaX: 0,
    heroDragging: false,
    libraryFilter: 'all',
    chapterSource: null,
    chapterNewestFirst: true,
    chapterShown: CHAPTER_BATCH,
  };

  // ───────────────────────── الرسائل والأوراق ─────────────────────────

  function toast(msg) {
    const t = q('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t._x);
    t._x = setTimeout(() => t.classList.remove('show'), 2200);
  }

  let sheetClose = null;
  /** ورقة سفلية واحدة في وقتٍ واحد. `build` يملأها ويرجع ما يُنادى عند الإغلاق. */
  function openSheet(build) {
    closeSheet();
    const body = q('sheetBody');
    body.innerHTML = '<div class="sheet-handle"></div>';
    sheetClose = build(body) ?? null;
    q('sheet').classList.add('show');
  }
  function closeSheet() {
    if (!q('sheet').classList.contains('show')) return false;
    q('sheet').classList.remove('show');
    sheetClose?.();
    sheetClose = null;
    return true;
  }
  function sheetItem(icon, label, run, { pressed, danger } = {}) {
    const b = el('button', `sheet-item${danger ? ' sheet-item--danger' : ''}`);
    b.type = 'button';
    b.innerHTML = glyph(icon);
    b.append(el('span', null, label));
    if (pressed !== undefined) {
      b.setAttribute('aria-pressed', String(pressed));
      if (pressed) b.insertAdjacentHTML('beforeend', `<span class="trail">${glyph('check', { size: 20 })}</span>`);
    }
    b.onclick = run;
    return b;
  }

  // ───────────────────────── الأعمال المحفوظة ─────────────────────────
  // المزامنة تحفظ عنوان العمل وغلافه؛ ونُسخه (أي مصدر يحمله) تُحفظ هنا ليُفتح
  // العمل من المكتبة بلا بحث جديد.

  const serverWork = (ref) => sync.rows('works', (x) => x.series_ref === ref)[0] ?? null;
  /**
   * يحفظ نسخ العمل في الجهاز، ويخبر الخادم بما لا يعرفه منها: عملٌ فتحتَه
   * يُفتح بعدها على كل جهاز بنفس نسخه، بلا بحث.
   */
  function rememberWork(w) {
    const all = readJson(WORKS_KEY, {});
    const editions = w._work.editions ?? [];
    all[w.id] = { key: w._work.key, title: titleOf(w), thumbnailUrl: w._work.thumbnailUrl, editions };
    writeJson(WORKS_KEY, all);
    const facts = { title: titleOf(w), coverUrl: w._work.thumbnailUrl ?? null, editions };
    if (!editions.length || !describesMore(serverWork(String(w.id)), facts)) return;
    sync.enqueue('work.describe', { seriesRef: String(w.id), ...facts, editions: compactEditions(editions) });
  }
  function workFromRef(ref, fallbackTitle, cover) {
    const saved = readJson(WORKS_KEY, {})[ref];
    const row = serverWork(ref);
    const title = displayTitle(ref, row?.title, saved?.title, fallbackTitle);
    const thumbnailUrl = saved?.thumbnailUrl ?? row?.cover_url ?? cover ?? null;
    // نسخ الجهاز أولًا (تحمل تفاصيل آخر فتح)، ثم ما عرفه غيره عبر الخادم
    const editions = mergeEditions(saved?.editions, serverEditions(row));
    const base = { key: saved?.key ?? ref.replace(/^ext:/, ''), title, thumbnailUrl, editions };
    return {
      id: ref,
      title: { english: title },
      genres: [],
      status: null,
      coverImage: { large: thumbnailUrl, extraLarge: thumbnailUrl },
      bannerImage: thumbnailUrl,
      staff: { edges: [] },
      _work: base,
    };
  }

  const me = () => sync.user?.userId;

  // ترجمة الفصول مقدمًا: الطابور المحفوظ (lib/translate-jobs.js)، يُنشأ مبكرًا فكل من يسأله يجده
  const translationJobs = createJobRunner({ sync, engine, translatePage, readerQuiet, native: { jobProgress, jobFinished, jobStop } });
  const jobStatus = new Map(translationJobs.jobs().map((j) => [j.id, j.status]));
  let jobSheetRefresh = null;
  translationJobs.subscribe((list) => {
    for (const j of list) {
      const was = jobStatus.get(j.id);
      if (was && was !== j.status) {
        if (j.status === 'done') toast(`جاهزة للقراءة: ${j.title} ✓`);
        else if (j.status === 'paused' && j.reason) toast(BLOCK_TEXT[j.reason] ?? 'توقفت الترجمة');
      }
      jobStatus.set(j.id, j.status);
    }
    jobSheetRefresh?.();
    if (state.current) renderTranslateToggle(state.current);
    if (currentPage() === 'settings') renderSettings();
  });
  // بعد الدخول: ما كان شغّالًا يكمل من حيث وقف (الحساب يحتاج لحظة ليجهز)
  (function resumeJobsWhenSignedIn(tries = 0) {
    if (sync.user) return void translationJobs.resumeAll();
    if (tries < 60) setTimeout(() => resumeJobsWhenSignedIn(tries + 1), 5000);
  })();

  const libraryRows = () => sync.rows('library', (r) => r.user_id === me() && !r.removed);
  const inCollection = (kind, ref) =>
    kind === 'completed'
      ? sync.rows('completions', (r) => r.user_id === me() && r.series_ref === ref && r.member).length > 0
      : sync.rows('collections', (r) => r.user_id === me() && r.kind === kind && r.series_ref === ref && r.member).length > 0;
  function libraryEntry(ref) {
    const row = libraryRows().find((r) => r.series_ref === ref);
    const later = inCollection('read_later', ref);
    const favorite = inCollection('favorite', ref);
    const completed = inCollection('completed', ref);
    if (!row && !later && !favorite && !completed) return null;
    return { row, later, favorite, completed, addedAt: row?.added_at ?? 0 };
  }
  function libraryWorks(filter = 'all') {
    const refs = new Set([
      ...libraryRows().map((r) => r.series_ref),
      ...sync.rows('collections', (r) => r.user_id === me() && r.member).map((r) => r.series_ref),
      ...sync.rows('completions', (r) => r.user_id === me() && r.member).map((r) => r.series_ref),
    ]);
    return [...refs]
      .map((ref) => {
        const row = libraryRows().find((r) => r.series_ref === ref);
        const col = sync.rows('collections', (r) => r.user_id === me() && r.series_ref === ref)[0];
        const work = sync.rows('works', (w) => w.series_ref === ref)[0];
        return {
          entry: libraryEntry(ref),
          work: workFromRef(ref, row?.series_title ?? col?.series_title ?? work?.title, row?.cover_url ?? col?.cover_url ?? work?.cover_url),
        };
      })
      .filter(({ entry }) => {
        if (!entry) return false;
        if (filter === 'reading') return Boolean(entry.row);
        if (filter === 'later') return entry.later;
        if (filter === 'favorite') return entry.favorite;
        if (filter === 'completed') return entry.completed;
        return true;
      })
      .map(({ work }) => work);
  }
  const descriptorOf = (w) => ({
    seriesRef: String(w.id),
    seriesTitle: titleOf(w),
    coverUrl: w.coverImage?.large ?? null,
    sourceId: w._work?.editions?.[0]?.sourceId ?? null,
  });

  // «آخر المشاهدات»: لا يكفي فتح بطاقة العمل. للعمل مكان هنا فقط بعد
  // قراءة 20% من فصل واحد أو تعليم فصل كمقروء. الفلتر ينظّف أيضًا السجلات
  // القديمة التي كانت تُنشأ بمجرد فتح صفحة العمل.
  function qualifiesOwnView(row) {
    if (row.chapter_number == null) return Boolean(row.chapter_label);
    const chapterKey = chapterKeyOf(String(row.series_ref), {
      sourceId: '',
      chapter: { chapterNumber: Number(row.chapter_number), name: row.chapter_label ?? '' },
    });
    // بحث بالمفتاح: السجل يُرسم كثيرًا، ومسح كل العلامات لكل صف كان يثقله
    if (sync.row('chapter_marks', `${me()}/${chapterKey}`)?.read) return true;
    return Number(sync.row('progress', `${me()}/${chapterKey}`)?.ratio) >= 0.2;
  }
  const viewRows = (userId = me()) =>
    sync
      .rows('work_views', (r) => r.user_id === userId && !r.removed)
      .filter((r) => userId !== me() || qualifiesOwnView(r))
      .sort((a, b) => (b.viewed_at ?? 0) - (a.viewed_at ?? 0));
  function recordChapterView(w, row) {
    if (!w || !row) return;
    const number = Number.isFinite(row.number) && row.number >= 0 ? row.number : null;
    sync.enqueue('view.add', {
      seriesRef: String(w.id),
      seriesTitle: titleOf(w),
      coverUrl: w.coverImage?.large ?? null,
      chapterLabel: row.chapter?.name?.trim() || (number !== null ? `الفصل ${number}` : null),
      chapterNumber: number,
      at: Date.now(),
    });
  }
  function removeView(ref) {
    sync.enqueue('view.remove', { seriesRef: ref });
  }
  const historyWorks = () => viewRows().map((v) => workFromRef(v.series_ref, v.series_title, v.cover_url));
  /** السجل القديم كان في الجهاز: يُنقل مرة إلى الحساب بترتيبه ثم يُترك. */
  function migrateLocalHistory() {
    const flag = `${HISTORY_KEY}.moved.${me()}`;
    if (!me() || localStorage.getItem(flag)) return;
    const local = readJson(HISTORY_KEY, []);
    if (!viewRows().length) {
      const t = Date.now();
      local.slice(0, 60).forEach((h, i) => {
        if (h?.ref) sync.enqueue('view.add', { seriesRef: h.ref, seriesTitle: h.title ?? null, coverUrl: h.cover ?? null, at: t - (i + 1) * 60_000 });
      });
    }
    try {
      localStorage.setItem(flag, '1');
    } catch {
      // يُعاد النقل مرة أخرى فقط، والخادم يدمج المكرر
    }
  }

  // ───────────────────────── الصور والبطاقات ─────────────────────────

  function fallbackArt(container, label) {
    const d = el('div', 'image-fallback');
    d.append(el('span', null, initialOf(label)));
    container.replaceChildren(d);
  }
  /**
   * الصورة بعد تحميلها فقط، ومكانها هيكلٌ لامع حتى ذلك. التسابق محروس
   * بعلامة: البطاقة المعاد استعمالها لا تعرض صورة طلبٍ قديم.
   *
   * الترتيب: الملف المحفوظ على الجهاز (فوري وبلا شبكة)، ثم المحرّك بترويسات
   * المصدر (ويُحفظ)، ثم الرابط مباشرة، لكل غلاف من أغلفة نسخ العمل. والحرف
   * الأول لا يظهر إلا إن فشل كل ذلك.
   */
  const nearWaiters = new Map();
  const nearObserver =
    typeof IntersectionObserver === 'undefined'
      ? null
      : new IntersectionObserver(
          (entries) => {
            for (const e of entries) {
              if (!e.isIntersecting) continue;
              nearObserver.unobserve(e.target);
              nearWaiters.get(e.target)?.();
              nearWaiters.delete(e.target);
            }
          },
          { rootMargin: '600px 600px' },
        );
  function nearViewport(node) {
    if (!nearObserver) return Promise.resolve();
    return new Promise((resolve) => {
      nearWaiters.get(node)?.();
      nearWaiters.set(node, resolve);
      nearObserver.observe(node);
    });
  }
  /**
   * أغلفةٌ ظهرت في هذه الجلسة: عملٌ → الرابط الذي عُرض. إعادة رسم القسم (وتتكرر
   * مع كل تحديث للقوائم) كانت تبني الغلاف فارغًا ثم تحمّله، فيومض ويختفي
   * ويرجع. الآن يوضع المعروف في نفس اللحظة، والذاكرة تعطيه بلا انتظار.
   */
  const shownCovers = new Map();
  async function mountImage(container, work, opts = {}) {
    const token = String(Math.random());
    container.dataset.imageToken = token;
    const known = shownCovers.get(String(work?.id ?? ''));
    if (known) {
      const current = container.querySelector(':scope > img');
      if (current?.getAttribute('src') === known) return known;
      const img = new Image();
      img.alt = '';
      img.decoding = 'sync';
      img.src = known;
      if (opts.position) img.style.objectPosition = opts.position;
      container.replaceChildren(img);
      return known;
    }
    const tryUrl = (url, timeoutMs) =>
      new Promise((resolve) => {
        const img = new Image();
        let finished = false;
        const done = (ok) => {
          if (finished) return;
          finished = true;
          clearTimeout(timer);
          resolve(ok ? img : null);
        };
        const timer = setTimeout(() => done(false), timeoutMs);
        img.alt = '';
        img.decoding = 'async';
        img.onload = () => done(true);
        img.onerror = () => done(false);
        img.src = url;
      });
    const show = (img, url) => {
      if (opts.position) img.style.objectPosition = opts.position;
      container.replaceChildren(img);
      if (id) shownCovers.set(id, img.getAttribute('src') ?? url);
      return url;
    };
    // الغلاف المعروف لهذا العمل أولًا (من أي شاشة عرفته)، ثم وصف الخادم، ثم القائمة
    const id = String(work?.id ?? '');
    const serverCover = id ? sync.rows('works', (x) => x.series_ref === id)[0]?.cover_url : null;
    const seen = new Set();
    const candidates = [
      ...[knownCover(id), serverCover].filter(Boolean).map((url) => ({ url, sourceId: work?._work?.editions?.find((e) => e.manga?.thumbnailUrl === url)?.sourceId ?? work?._work?.editions?.[0]?.sourceId ?? null })),
      ...coverCandidates(work),
    ].filter((c) => !seen.has(c.url) && seen.add(c.url));
    // المحفوظ أولًا وبلا هيكل لامع: الغلاف الذي رأيته أمس يظهر كما هو
    for (const { url } of candidates) {
      const local = cachedCover(url);
      if (!local) continue;
      const img = await tryUrl(local, 2500);
      if (container.dataset.imageToken !== token) return null;
      if (img) {
        rememberCover(id, url);
        return show(img, local);
      }
      forgetCover(url);
    }
    container.replaceChildren(el('div', 'skeleton'));
    // ما لم يُحفظ بعد يُجلب حين يقترب من الشاشة: الظاهر أولًا، والشبكة لا
    // تنشغل بستين غلافًا في آخر الصفحة قبل الذي أمامك
    await nearViewport(container);
    if (container.dataset.imageToken !== token) return null;
    for (const { url, sourceId } of candidates) {
      const saved = await nativeCover(url, sourceId);
      if (container.dataset.imageToken !== token) return null;
      const img = (saved && (await tryUrl(saved, 6000))) || (await tryUrl(url, 9000));
      if (container.dataset.imageToken !== token) return null;
      if (img) {
        rememberCover(id, url);
        return show(img, img.src);
      }
    }
    if (container.dataset.imageToken !== token) return null;
    fallbackArt(container, titleOf(work));
    // لا فراغ دائم: الغلاف يُطلب من تفاصيل العمل في الخلفية، والبطاقة تُعاد حين يصل
    waitingCovers.set(container, work);
    resolveCoverLater(work);
    return null;
  }
  const waitingCovers = new Map();
  onCoverKnown((workId, url) => {
    for (const [container, work] of waitingCovers) {
      if (!container.isConnected) {
        waitingCovers.delete(container);
        continue;
      }
      if (String(work.id) !== workId) continue;
      waitingCovers.delete(container);
      void mountImage(container, { ...work, coverImage: { ...(work.coverImage ?? {}), extraLarge: url, large: url } });
    }
  });
  const coverTried = new Map();
  let coverActive = 0;
  const coverWaiting = [];
  /** تفاصيل العمل من أوثق نسخة تحمل غلافه غالبًا. مرتين في آنٍ، ومرة لكل عمل كل عشر دقائق. */
  function resolveCoverLater(work) {
    const id = String(work?.id ?? '');
    if (!id || !available() || !work?._work?.editions?.length) return;
    if (Date.now() - (coverTried.get(id) ?? 0) < 10 * 60_000) return;
    coverTried.set(id, Date.now());
    const run = async () => {
      coverActive += 1;
      try {
        const full = await describe(work);
        const url = full?._work?.thumbnailUrl || full?.coverImage?.large || null;
        if (url && url !== work.coverImage?.large) {
          rememberWork({ ...full, _work: { ...full._work, thumbnailUrl: url } });
          announceCover(id, url);
        }
      } catch {
        // المصدر ما ردّ: يُعاد بعد عشر دقائق عند أول ظهور للبطاقة
      } finally {
        coverActive -= 1;
        coverWaiting.shift()?.();
      }
    };
    if (coverActive < 2) void run();
    else coverWaiting.push(run);
  }

  function card(work, { meta } = {}) {
    const a = el('article', 'work-card');
    a.tabIndex = 0;
    a.setAttribute('role', 'link');
    a.setAttribute('aria-label', titleOf(work));
    const p = el('div', 'poster');
    const t = el('div', 'work-title', titleOf(work));
    t.dir = 'auto';
    const m = el('div', 'work-meta', meta ?? (STATUS_AR[work.status] || ''));
    void mountImage(p, work);
    a.append(p, t, m);
    a.onclick = () => void openWork(work);
    a.onkeydown = (e) => {
      if (e.key === 'Enter') void openWork(work);
    };
    return a;
  }
  const renderStrip = (target, items) => target.replaceChildren(...items.slice(0, 14).map((w) => card(w)));
  const renderGrid = (target, items) => target.replaceChildren(...items.map((w) => card(w)));
  const skeletonCards = (n) =>
    Array.from({ length: n }, () => {
      const x = el('div', 'work-card');
      x.setAttribute('aria-hidden', 'true');
      x.innerHTML = '<div class="poster"><div class="skeleton"></div></div><span class="skeleton-line"></span><span class="skeleton-line"></span>';
      return x;
    });

  /** حالة فارغة: رمز الموقف لا شعار التطبيق، وجملة تقول ما العمل. */
  function emptyState(target, { icon = 'library', title, text, action, error = false }) {
    const box = el('div', `empty${error ? ' empty--error' : ''}`);
    const inner = el('div');
    inner.innerHTML = `<div class="empty-art">${glyph(icon)}</div>`;
    inner.append(el('h3', null, title));
    if (text) inner.append(el('p', null, text));
    if (action) {
      const b = el('button', 'btn btn-secondary', action.label);
      b.type = 'button';
      if (action.icon) b.insertAdjacentHTML('afterbegin', glyph(action.icon));
      b.onclick = action.run;
      inner.append(b);
    }
    box.append(inner);
    target.replaceChildren(box);
  }

  // ───────────────────────── الرئيسية ─────────────────────────

  function sectionBlock(title, kind, items) {
    const s = el('section', 'section');
    s.dataset.signature = `${title}:${items.map((w) => String(w?.id ?? w?.title ?? '')).join(',')}`;
    const h = el('div', 'section-head');
    h.append(el('h2', null, title));
    if (kind) {
      const b = el('button', 'link');
      b.type = 'button';
      b.innerHTML = `<span>الكل</span>${glyph('chevron')}`;
      b.setAttribute('aria-label', `عرض الكل: ${title}`);
      b.onclick = () => void openCollection(kind);
      h.append(b);
    }
    const strip = el('div', 'card-strip');
    renderStrip(strip, items);
    s.append(h, strip);
    return s;
  }
  /**
   * ما يقرؤه أصدقاؤك فعلًا: أعمال في «آخر المشاهدات» عندهم خلال أسبوعين،
   * الأكثر أصدقاءً أولًا ثم الأحدث. من سجلّهم نفسه، لا تقدير.
   */
  function friendsReading() {
    const since = Date.now() - 14 * 86_400_000;
    const byRef = new Map();
    for (const v of sync.rows('work_views', (r) => r.user_id !== me() && !r.removed && (r.viewed_at ?? 0) >= since && r.chapter_label)) {
      const e = byRef.get(v.series_ref) ?? { ref: v.series_ref, users: new Set(), at: 0, title: v.series_title, cover: v.cover_url };
      e.users.add(v.user_id);
      e.at = Math.max(e.at, v.viewed_at ?? 0);
      e.title ??= v.series_title;
      e.cover ??= v.cover_url;
      byRef.set(v.series_ref, e);
    }
    return [...byRef.values()]
      .sort((a, b) => b.users.size - a.users.size || b.at - a.at)
      .map((e) => workFromRef(e.ref, e.title, e.cover));
  }
  /**
   * الرئيسية من بيانات حقيقية فقط، كل قسم بمصدره وترتيبه:
   *   - آخر المشاهدات: سجلّك (20% من فصل أو تعليم).
   *   - أعمال تتابعها: مكتبتك.
   *   - يقرأها أصدقاؤك: سجلّات أصدقائك.
   *   - الأكثر رواجًا: «الرائج» عند كل المصادر، مرتّبًا بحضوره فيها وموضعه.
   *   - آخر التحديثات: «الأحدث» عند كل المصادر، بأقرب موضع.
   * لا «مقترحة» ولا «مميزة» بلا معنى: ما لا نعرفه لا نخترعه.
   */
  // آخر ما عُرض: إعادة البناء لنفس القوائم تُسقط الصور لحظةً ثم تعيدها
  // (وميض مع كل نبض مزامنة). نفس الأعمال بنفس الترتيب = لا شيء يُلمس.
  let homeSignature = '';
  function renderHome() {
    const blocks = [];
    const history = historyWorks();
    if (history.length) blocks.push(sectionBlock('آخر المشاهدات', 'history', history.slice(0, 20)));
    const reading = libraryWorks('reading');
    if (reading.length) blocks.push(sectionBlock('أعمال تتابعها', 'libraryReading', reading));
    const friends = friendsReading();
    if (friends.length) blocks.push(sectionBlock('يقرأها أصدقاؤك', null, friends.slice(0, 20)));
    if (state.home.trending.length) blocks.push(sectionBlock('الأكثر رواجًا', 'trending', state.home.trending));
    if (state.home.recent.length) blocks.push(sectionBlock('آخر التحديثات', 'recent', state.home.recent));
    if (!blocks.length) return;
    const signature = blocks.map((b) => b.dataset.signature ?? '').join('|');
    if (signature === homeSignature && q('homeSections').childElementCount === blocks.length) return;
    homeSignature = signature;
    q('homeSections').replaceChildren(...blocks);
  }
  function renderHomeSkeleton() {
    q('homeSections').replaceChildren(
      ...['الأكثر رواجًا', 'آخر التحديثات'].map((title) => {
        const s = el('section', 'section');
        s.setAttribute('aria-busy', 'true');
        const h = el('div', 'section-head');
        h.append(el('h2', null, title));
        const strip = el('div', 'card-strip');
        strip.append(...skeletonCards(5));
        s.append(h, strip);
        return s;
      }),
    );
  }
  async function loadHome() {
    if (!available()) {
      renderHeroFallback();
      const box = el('div');
      emptyState(box, { icon: 'layers', title: 'المصادر داخل تطبيق أندرويد', text: 'الكتالوج يُقرأ من مصادرنا العربية بمحرّك التطبيق — افتح VANTARA على الجوال.' });
      renderHome();
      q('homeSections').append(box.firstElementChild);
      return;
    }
    // آخر رئيسية رأيتها تظهر فورًا، والمصادر تحدّثها وهي تردّ واحدًا واحدًا —
    // لا شاشة تنتظر أبطأ مصدر من ستة عشر. قائمتان حقيقيتان: الرائج والأحدث.
    const cached = (await readKv('home.v2'))?.value;
    const hasCache = Boolean(cached?.trending?.length || cached?.recent?.length);
    const heroFrom = (list) => list.filter((w) => !!w.coverImage?.large).slice(0, 6);
    if (hasCache) {
      state.home.trending = cached.trending ?? [];
      state.home.recent = cached.recent ?? [];
      state.heroItems = heroFrom(state.home.trending);
      renderHero();
      renderHome();
    } else {
      renderHomeSkeleton();
      renderHeroSkeleton();
    }
    let heroDone = hasCache;
    let paintTimer = null;
    let saveTimer = null;
    const paint = () => {
      clearTimeout(paintTimer);
      paintTimer = setTimeout(() => {
        // البانر من أول عمل له غلاف، ويكتمل مع وصول الباقي. كان ينتظر ثلاثة ثم
        // الستة عشر كلها، فمصدرٌ بطيء يُبقي مكانه مربعًا أسود
        const next = heroFrom(state.home.trending);
        if (!heroDone && next.length > state.heroItems.length && !state.heroDragging) {
          state.heroItems = next;
          renderHero();
          if (next.length >= 6) heroDone = true;
        }
        if (currentPage() === 'home') renderHome();
        // يُحفظ ما وصل فورًا: الفتحة القادمة تبدأ منه ولو علق مصدر للنهاية
        if (!hasCache && !saveTimer) {
          saveTimer = setTimeout(() => {
            saveTimer = null;
            void writeKv('home.v2', { trending: state.home.trending.slice(0, 40), recent: state.home.recent.slice(0, 40) });
          }, 1500);
        }
      }, 120);
    };
    const live = (key) => ({ items }) => {
      // أول ردٍّ لا يمحو رئيسية محفوظة أكمل منه
      if (cached?.[key]?.length && items.length < Math.min(cached[key].length, 12)) return;
      state.home[key] = items;
      paint();
    };
    try {
      const [tr, re] = await Promise.all([
        browseLive({ kind: 'popular', page: 1 }, live('trending')),
        browseLive({ kind: 'latest', page: 1 }, live('recent')),
      ]);
      state.home.trending = tr.items;
      state.home.recent = re.items;
      clearTimeout(saveTimer);
      const finalHero = heroFrom(tr.items);
      // لا يُعاد بناء بانرٍ يلفّ أمام المستخدم بنفس الأعمال
      if (finalHero.length && (finalHero.length !== state.heroItems.length || finalHero.some((w, i) => w.id !== state.heroItems[i]?.id))) {
        state.heroItems = finalHero;
        renderHero();
      } else if (!state.heroItems.length) {
        renderHeroFallback();
      }
      renderHome();
      if (!tr.items.length && !re.items.length && !hasCache) throw new Error('empty');
      void writeKv('home.v2', { trending: tr.items.slice(0, 40), recent: re.items.slice(0, 40) });
    } catch {
      // عندنا نسخة محفوظة: تبقى كما هي، بلا شاشة خطأ فوقها
      if (hasCache) return;
      renderHeroFallback();
      const box = el('div');
      emptyState(box, {
        icon: 'offline',
        error: true,
        title: 'تعذّر الوصول إلى المصادر',
        text: 'تحقّق من الاتصال ثم أعد المحاولة.',
        action: { label: 'أعد المحاولة', icon: 'refresh', run: () => void loadHome() },
      });
      q('homeSections').replaceChildren(box.firstElementChild);
    }
  }

  // ── البانر الدائري: حركة v35 كما هي، وتركيبٌ يناسب الأغلفة الطولية ──

  function heroSlide(w) {
    const s = el('div', 'hero-slide');
    s.setAttribute('role', 'group');
    s.setAttribute('aria-label', titleOf(w));
    const back = el('div', 'hero-backdrop');
    const cover = w.coverImage?.large;
    if (cover) back.style.backgroundImage = `url("${cover.replace(/"/g, '%22')}")`;
    const poster = el('div', 'hero-poster');
    void mountImage(poster, w);
    const copy = el('div', 'hero-copy');
    const editions = w._work?.editions ?? [];
    const kicker = [
      (w.genres || []).slice(0, 2).map(genreAr).join(' · '),
      editions.length > 1 ? countLabel(editions.length, 'source') : editions[0]?.label,
    ]
      .filter(Boolean)
      .join(' · ');
    copy.append(el('div', 'hero-kicker', kicker));
    const name = el('h3', 'hero-name', titleOf(w));
    name.dir = 'auto';
    copy.append(name);
    s.append(back, poster, copy);
    s.onclick = () => {
      if (Math.abs(state.heroDeltaX) < 8) void openWork(w);
    };
    return s;
  }
  function renderHero() {
    const items = state.heroItems;
    if (!items.length) return renderHeroFallback();
    const physical = [items[items.length - 1], ...items, items[0]];
    q('heroTrack').replaceChildren(...physical.map(heroSlide));
    q('heroDots').replaceChildren(
      ...items.map((_, i) => {
        const d = el('button', `hero-dot${i === 0 ? ' active' : ''}`);
        d.type = 'button';
        d.setAttribute('aria-label', `العمل ${i + 1} من ${items.length}`);
        d.onclick = (e) => {
          e.stopPropagation();
          heroGoLogical(i);
        };
        return d;
      }),
    );
    state.heroPhysicalIndex = 1;
    heroPosition(false);
    bindHero();
    restartHero();
  }
  function renderHeroSkeleton() {
    q('heroTrack').replaceChildren(el('div', 'skeleton'));
    q('heroDots').replaceChildren();
  }
  function renderHeroFallback() {
    state.heroItems = [];
    const s = el('div', 'hero-slide');
    const copy = el('div', 'hero-copy');
    copy.style.insetInlineStart = '20px';
    copy.append(el('div', 'hero-kicker', 'مانجا · مانهوا · مانها'), el('h3', 'hero-name', 'VANTARA'));
    s.append(copy);
    q('heroTrack').replaceChildren(s);
    q('heroTrack').style.transform = 'none';
    q('heroDots').replaceChildren();
  }
  function logicalIndex() {
    const n = state.heroItems.length;
    if (!n) return 0;
    if (state.heroPhysicalIndex === 0) return n - 1;
    if (state.heroPhysicalIndex === n + 1) return 0;
    return state.heroPhysicalIndex - 1;
  }
  function heroPosition(anim = true) {
    const tr = q('heroTrack');
    tr.style.transition = anim ? 'transform .38s var(--ease-out)' : 'none';
    tr.style.transform = `translateX(${-state.heroPhysicalIndex * 100}%)`;
    const li = logicalIndex();
    root.querySelectorAll('.hero-dot').forEach((d, i) => d.classList.toggle('active', i === li));
    // الالتفاف لا يعتمد على transitionend وحده: صفحةٌ مخفية أو تطبيق في الخلفية
    // لا يطلقه، فكان العدّاد يتجاوز النسخ ويعرض بانرًا فارغًا
    clearTimeout(state.heroWrapTimer);
    if (anim) state.heroWrapTimer = setTimeout(heroWrap, 450);
    else heroWrap();
  }
  /** من النسخة الطرفية إلى الأصل بلا حركة. آمنة مهما تكرّرت. */
  function heroWrap() {
    const n = state.heroItems.length;
    if (!n) return;
    const i = state.heroPhysicalIndex;
    if (i >= 1 && i <= n) return;
    state.heroPhysicalIndex = i <= 0 ? n : 1;
    const tr = q('heroTrack');
    tr.style.transition = 'none';
    tr.style.transform = `translateX(${-state.heroPhysicalIndex * 100}%)`;
    void tr.offsetWidth;
    const li = logicalIndex();
    root.querySelectorAll('.hero-dot').forEach((d, k) => d.classList.toggle('active', k === li));
  }
  function heroNext() {
    if (!state.heroItems.length) return;
    heroWrap();
    state.heroPhysicalIndex += 1;
    heroPosition(true);
  }
  function heroPrev() {
    if (!state.heroItems.length) return;
    heroWrap();
    state.heroPhysicalIndex -= 1;
    heroPosition(true);
  }
  function heroGoLogical(i) {
    state.heroPhysicalIndex = i + 1;
    heroPosition(true);
    restartHero();
  }
  function bindHero() {
    const hero = q('hero');
    if (hero.dataset.bound) return;
    hero.dataset.bound = '1';
    const tr = q('heroTrack');
    tr.addEventListener('transitionend', heroWrap);
    const start = (x) => {
      state.heroDragging = true;
      state.heroStartX = x;
      state.heroDeltaX = 0;
      hero.classList.add('dragging');
      clearInterval(state.heroTimer);
    };
    const move = (x) => {
      if (!state.heroDragging) return;
      state.heroDeltaX = x - state.heroStartX;
      // الشريط يتبع الإصبع: بلا هذا يبدو البانر صورةً ثابتة حتى يُفلت
      tr.style.transform = `translateX(calc(${-state.heroPhysicalIndex * 100}% + ${state.heroDeltaX}px))`;
    };
    const end = () => {
      if (!state.heroDragging) return;
      state.heroDragging = false;
      hero.classList.remove('dragging');
      if (state.heroDeltaX < -42) heroNext();
      else if (state.heroDeltaX > 42) heroPrev();
      else heroPosition(true);
      setTimeout(() => (state.heroDeltaX = 0), 0);
      restartHero();
    };
    hero.addEventListener('touchstart', (e) => start(e.touches[0].clientX), { passive: true });
    hero.addEventListener('touchmove', (e) => move(e.touches[0].clientX), { passive: true });
    hero.addEventListener('touchend', end);
    hero.addEventListener('touchcancel', end);
    hero.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch') start(e.clientX);
    });
    hero.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'touch') move(e.clientX);
    });
    hero.addEventListener('pointerup', (e) => {
      if (e.pointerType !== 'touch') end();
    });
  }
  function restartHero() {
    clearInterval(state.heroTimer);
    // يلفّ والرئيسية أمامك فقط: لا حركة في صفحة مخفية ولا والتطبيق في الخلفية
    if (state.heroItems.length > 1) state.heroTimer = setInterval(() => currentPage() === 'home' && !document.hidden && heroNext(), 5200);
  }

  // ───────────────────────── صفحة العمل ─────────────────────────

  async function openWork(work, { readNumber = null } = {}) {
    // بطاقةٌ بُنيت قبل وصول وصف العمل من الخادم: يُعاد بناؤها بما عُرف منذ ذلك
    if (!work._work?.editions?.length && String(work.id).startsWith('ext:')) {
      work = workFromRef(String(work.id), titleOf(work), work.coverImage?.large);
    }
    if (state.current && String(state.current.id) !== String(work.id)) endWorkSession(String(state.current.id));
    state.current = work;
    state.nextRow = null;
    state.chapterSource = null;
    state.chapterNewestFirst = true;
    state.chapterShown = CHAPTER_BATCH;
    if (work._work?.editions?.length) rememberWork(work);
    showPage('detail');
    renderDetail(work);
    renderChaptersLoading();
    if (!work._work?.editions?.length) {
      // عملٌ من المكتبة على جهاز آخر: نُسخه لم تُحفظ هنا، فيُبحث عنه بعنوانه
      try {
        const { items } = await browse({ query: titleOf(work), keepWestern: true });
        const found = items.find((w) => w.id === work.id) ?? items.find((w) => titlesMatch(titleOf(w), titleOf(work)));
        if (found && state.current === work) {
          // المرجع يبقى مرجعك: مكتبتك وتقدّمك مربوطان به لا بمفتاح النتيجة
          const kept = { ...found, id: work.id, _work: { ...found._work, key: work._work.key } };
          work = kept;
          state.current = kept;
          rememberWork(kept);
        }
      } catch {
        // يبقى العمل بلا نُسخ ويقول ذلك أدناه
      }
    }
    if (state.current !== work) return;
    if (!work._work?.editions?.length) {
      emptyState(q('chapterPanel'), {
        icon: 'search',
        title: 'ما وصلنا للمصادر الحين',
        text: 'نحاول مرة ثانية بعد لحظة، أو المسها الحين.',
        action: { label: 'أعد المحاولة', icon: 'refresh', run: () => void openWork(work, { readNumber }) },
      });
      setReadCta(null);
      return;
    }
    // VANTARA: الفصول المحفوظة فورًا، وكل مصدر يردّ يضيف ما عنده بصمت
    let wanted = readNumber;
    const tryWanted = (w, final) => {
      if (wanted === null) return;
      const row = w._chapters?.find((r) => r.number === wanted);
      if (row) {
        wanted = null;
        openChapter(w, row);
      } else if (final) {
        wanted = null;
        toast('هالفصل مو متوفر في مصادرنا الحين');
      }
    };
    const show = (full, { settled }) => {
      if (state.current?.id !== work.id || currentPage() === 'reader') return;
      if (!full._chapters?.length && !settled) return;
      const first = !state.current?._chapters;
      state.current = full;
      // غلافٌ عرفته التفاصيل تجرّبه البطاقات التي بقيت بلا غلاف، حالًا لا بعد الرجوع
      if (full._work?.thumbnailUrl) announceCover(String(full.id), full._work.thumbnailUrl);
      if (first || full._work?.thumbnailUrl !== work._work?.thumbnailUrl) renderDetail(full);
      else refreshDetailMeta(full);
      renderSources(full);
      renderChapters(full);
      tryWanted(full, settled);
    };
    try {
      const full = await loadWork(work, { onUpdate: show });
      if (state.current?.id !== work.id) return;
      // ما عُرف من نسخ وغلاف يُحفظ للبطاقات وللأجهزة الأخرى
      rememberWork(full);
      if (!full._chapters?.length) {
        emptyState(q('chapterPanel'), {
          icon: 'offline',
          error: true,
          title: 'تعذّر جلب الفصول',
          text: 'المصادر لم تردّ الآن.',
          action: { label: 'أعد المحاولة', icon: 'refresh', run: () => void openWork(work) },
        });
        setReadCta(null);
      }
    } catch {
      if (state.current?.id !== work.id) return;
      emptyState(q('chapterPanel'), {
        icon: 'offline',
        error: true,
        title: 'تعذّر جلب الفصول',
        text: 'المصادر لم تردّ الآن.',
        action: { label: 'أعد المحاولة', icon: 'refresh', run: () => void openWork(work) },
      });
      setReadCta(null);
    }
  }
  /** العدد والتصنيف والنبذة تتحدّث مكانها، بلا إعادة الغلاف ولا قفزة. */
  function refreshDetailMeta(w) {
    const sub = q('detailSub');
    sub.replaceChildren();
    if (w.status && STATUS_AR[w.status]) {
      const st = el('span', 'status-dot', STATUS_AR[w.status]);
      st.dataset.status = w.status;
      sub.append(st);
    }
    if (w._chapters) sub.append(el('span', null, countLabel(w._chapters.length, 'chapter')));
    const editions = w._sources ?? [];
    if (editions.length > 1) sub.append(el('span', null, countLabel(editions.length, 'source')));
    renderInfo(w);
  }
  function renderDetail(w) {
    const title = titleOf(w);
    const h1 = q('detailTitle');
    h1.textContent = title;
    h1.dir = 'auto';
    q('detailTopTitle').textContent = title;
    q('detailTopTitle').dir = 'auto';

    const sub = q('detailSub');
    sub.replaceChildren();
    if (w.status && STATUS_AR[w.status]) {
      const s = el('span', 'status-dot', STATUS_AR[w.status]);
      s.dataset.status = w.status;
      sub.append(s);
    }
    if (w._chapters) sub.append(el('span', null, countLabel(w._chapters.length, 'chapter')));
    const editions = w._sources ?? w._work?.editions ?? [];
    if (editions.length > 1) sub.append(el('span', null, countLabel(editions.length, 'source')));

    q('detailGenres').replaceChildren(...(w.genres || []).slice(0, 4).map((x) => el('span', 'chip', genreAr(x))));

    const cover = q('detailCover');
    if (cover.dataset.for !== String(w.id)) {
      cover.dataset.for = String(w.id);
      const glow = q('detailGlow');
      glow.classList.remove('ready');
      glow.style.backgroundImage = '';
      void mountImage(cover, w).then((url) => {
        if (!url || state.current?.id !== w.id) return;
        glow.style.backgroundImage = `url("${url.replace(/"/g, '%22')}")`;
        glow.classList.add('ready');
      });
    }

    const text = clean(w.description);
    const d = q('description');
    d.textContent = text || (w.description === undefined ? '' : 'لا توجد نبذة من المصدر.');
    d.classList.add('clamped');
    q('summaryBlock').hidden = w.description === undefined && !text;
    requestAnimationFrame(() => {
      q('moreToggle').hidden = d.scrollHeight <= d.clientHeight + 2;
      q('moreToggle').textContent = 'المزيد';
    });
    refreshLibraryDetail();
    renderRating();
    renderInfo(w);
  }
  function toggleSummary() {
    const d = q('description');
    const clamped = d.classList.toggle('clamped');
    q('moreToggle').textContent = clamped ? 'المزيد' : 'أقل';
  }
  /**
   * «ترجمة تلقائية» بجانب العين: تظهر فقط لعملٍ فيه فصول إنجليزية، ومقفلة
   * افتراضيًا. مفعّلة = كل فصل إنجليزي تدخله يجهّز 30% منه بالعربي أولًا.
   */
  function renderTranslateToggle(w) {
    const b = q('detailTlBtn');
    if (!b) return;
    const hasEnglish = Boolean(w?._chapters?.some((c) => c.lang === 'en'));
    b.hidden = !hasEnglish || !readTranslateSettings().enabled;
    const on = translationOn(String(w?.id ?? ''));
    b.setAttribute('aria-pressed', String(on));
    b.classList.toggle('detail-tl--on', on);
    const running = translationJobs.forWork(String(w?.id ?? '')).some((j) => j.status === 'running');
    b.classList.toggle('detail-tl--busy', running);
    const label = running ? 'الترجمة العربية: فصول تُترجم الحين' : on ? 'الترجمة العربية: شغّالة لهذا العمل' : 'الترجمة العربية';
    b.setAttribute('aria-label', label);
    b.title = label;
  }
  function toggleReadingTranslation(w) {
    const on = !translationOn(String(w.id));
    setTranslation(String(w.id), on);
    renderTranslateToggle(w);
    toast(on ? 'الترجمة أثناء القراءة شغّالة لهذا العمل' : 'الترجمة أثناء القراءة مقفلة: الإنجليزي يُعرض كما هو');
  }

  // ───────────────── ترجمة الفصول مقدمًا ─────────────────
  // زر الترجمة في صفحة العمل: الترجمة أثناء القراءة، أو تجهيز فصول كاملة في
  // الخلفية (الطابور في lib/translate-jobs.js، والإشعار من خدمة أندرويد).

  const chaptersWord = (n) => (n === 1 ? 'فصل واحد' : n === 2 ? 'فصلين' : `${n} فصول`);
  const pagesWord = (n) => (n === 1 ? 'صفحة واحدة' : n === 2 ? 'صفحتين' : `${n} صفحة`);

  /** بطاقة مهمة: التقدّم، والحالة، وإيقاف/استئناف/إلغاء. */
  function jobCard(job) {
    const card = el('div', 'tl-job');
    const p = progressOf(job);
    const head = el('div', 'tl-job__head');
    head.append(el('strong', null, job.title));
    const first = job.chapters[0]?.number;
    const last = job.chapters[job.chapters.length - 1]?.number;
    head.append(el('small', null, `${first === last ? `الفصل ${first}` : `الفصول ${first}–${last}`} · ${job.mode === 'fast' ? 'أسرع' : 'أعلى جودة'}`));
    const bar = el('div', 'tl-job__bar');
    const fill = el('span');
    fill.style.width = `${Math.round((job.status === 'done' && !p.failed && !p.unreachable ? 1 : p.ratio) * 100)}%`;
    bar.append(fill);
    const state_ =
      job.status === 'done'
        ? p.failed || p.unreachable
          ? finishedText(job)
          : `اكتملت: ${chaptersWord(job.chapters.length)} جاهزة للقراءة`
        : job.status === 'paused'
          ? job.reason
            ? BLOCK_TEXT[job.reason] ?? 'متوقفة'
            : `متوقفة · ${p.done}/${p.total || '…'} صفحة`
          : p.total
            ? `${p.done}/${p.total} صفحة · ${chaptersWord(p.chaptersDone)} من ${job.chapters.length}${p.unknown ? ' (نحسب الباقي)' : ''}`
            : 'نجهّز الفصول…';
    const actions = el('div', 'tl-job__actions');
    const act = (label, run, cls = 'btn btn-secondary') => {
      const b = el('button', cls, label);
      b.type = 'button';
      b.onclick = run;
      actions.append(b);
    };
    if (job.status === 'running') act('إيقاف مؤقت', () => translationJobs.pause(job.id));
    if (job.status === 'paused') act('استئناف', () => translationJobs.resume(job.id), 'btn btn-primary');
    if (job.status !== 'done') act('إلغاء', () => translationJobs.cancel(job.id));
    else act('إزالة من القائمة', () => translationJobs.cancel(job.id));
    card.append(head, bar, el('p', 'tl-job__state', state_), actions);
    return card;
  }

  function openTranslateMenu() {
    const w = state.current;
    if (!w) return;
    const ref = String(w.id);
    const build = (body) => {
      body.append(el('h3', null, 'الترجمة العربية'));
      const on = translationOn(ref);
      body.append(
        sheetItem('translateAr', 'الترجمة أثناء القراءة', () => {
          toggleReadingTranslation(w);
          body.replaceChildren(el('div', 'sheet-handle'));
          build(body);
        }, { pressed: on }),
      );
      body.append(sheetItem('download', 'ترجم فصولًا مقدمًا', () => openTranslateAhead(w)));
      const list = translationJobs.forWork(ref);
      if (list.length) {
        body.append(el('div', 'settings-group-label', 'فصول تُترجم لهذا العمل'));
        for (const job of list) body.append(jobCard(job));
      }
    };
    openSheet((body) => {
      build(body);
      jobSheetRefresh = () => {
        body.replaceChildren(el('div', 'sheet-handle'));
        build(body);
      };
      return () => {
        jobSheetRefresh = null;
      };
    });
  }
  const toggleTranslateCurrent = openTranslateMenu;

  /**
   * الإعدادات ← أداء الترجمة: من سجل جوالك (لا تقديرات): الوسيط لصفحة بلا نص
   * وبنص، وأثقل المراحل، والفصول الأخيرة؛ و«قِس القديم مقابل الجديد» على صفحات
   * ترجمتها؛ ونسخ التقرير كاملًا.
   */
  function openPerfSheet() {
    let benchmarks = [];
    let engines = null;
    const sec = (ms) => (ms === null || ms === undefined ? '—' : `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} ث`);
    const build = (body) => {
      body.append(el('h3', null, 'أداء الترجمة'));
      const entries = readPerf();
      const s = summarize(entries);
      if (!s.pages) body.append(el('p', null, 'ما فيه قياس بعد. ترجم صفحات وارجع هنا.'));
      for (const [label, g] of [['صفحة بلا نص', s.textless], ['صفحة فيها حوار', s.text]]) {
        if (!g.pages) continue;
        body.append(el('p', null, `${label}: ${sec(g.median)} (وسيط ${g.pages} صفحة)`));
        const top = Object.entries(g.stages)
          .filter(([k]) => !['total'].includes(k))
          .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
          .slice(0, 8);
        const list = el('ul', 'perf-list');
        for (const [k, v] of top) list.append(el('li', null, `${k}: ${sec(v)}`));
        body.append(list);
      }
      for (const c of s.chapters.slice(-3)) body.append(el('p', null, `فصل ${c.chapterKey.split('#').pop()}: ${c.pages} صفحة في ${sec(c.wallMs)}`));
      for (const b of benchmarks) {
        body.append(el('p', null, `القديم ${sec(totalOf(b.legacy))} ← الجديد ${sec(totalOf(b.current))} · ${b.identical ? 'الناتج متطابق بكسلًا بكسلًا' : 'الناتج مختلف!'}`));
      }
      const bench = el('button', 'btn btn-secondary btn-block', 'قِس القديم مقابل الجديد');
      bench.type = 'button';
      bench.onclick = async () => {
        const pages = readPerf()
          .filter((e) => e.path && e.hash && e.translated > 0)
          .slice(-3);
        if (!pages.length) return toast('ترجم صفحة فيها حوار أولًا');
        bench.disabled = true;
        bench.textContent = 'نقيس… (دقيقة تقريبًا)';
        benchmarks = [];
        for (const e of pages) {
          const saved = await cachedPage(e.hash);
          const regions = (saved?.regions ?? []).filter((r) => typeof r.arabic === 'string' && r.arabic).map((r) => ({ id: r.id, arabic: r.arabic }));
          const res = await benchmarkPage({ path: e.path, regions }).catch(() => null);
          if (res) benchmarks.push({ page: `${e.chapterKey?.split('#').pop() ?? ''}#${e.pageIndex}`, ...res });
        }
        if (!benchmarks.length) toast('القياس يحتاج تحديث التطبيق، أو ملفات الصفحات انمسحت');
        refresh();
      };
      body.append(bench);
      for (const line of engineLines(engines)) body.append(el('p', null, line));
      const tune = el('button', 'btn btn-secondary btn-block', 'قِس إعدادات المحرك');
      tune.type = 'button';
      tune.onclick = async () => {
        // أطول صفحة فيها حوار ترجمتها (فيها أكثر مربعات، والفرق يظهر أوضح)
        const page = readPerf()
          .filter((e) => e.path && e.translated > 0)
          .slice(-20)
          .sort((a, b) => (b.native?.analyze?.counts?.glyphTiles ?? 0) - (a.native?.analyze?.counts?.glyphTiles ?? 0))[0];
        if (!page) return toast('ترجم صفحة فيها حوار أولًا');
        tune.disabled = true;
        tune.textContent = 'نقيس… (دقيقتان تقريبًا، خلّ الشاشة مفتوحة)';
        engines = await benchmarkEngines({ path: page.path }).catch(() => null);
        if (!engines) toast('القياس يحتاج تحديث التطبيق، أو ملف الصفحة انمسح');
        refresh();
      };
      body.append(tune);
      const copy = el('button', 'btn btn-secondary btn-block');
      copy.type = 'button';
      copy.innerHTML = `${glyph('share')}<span>انسخ التقرير</span>`;
      copy.onclick = async () => {
        try {
          await navigator.clipboard.writeText(formatReport(readPerf(), benchmarks, engines));
          toast('انسخ. ألصقه لي');
        } catch {
          toast('ما قدرت أنسخ');
        }
      };
      body.append(copy);
      const clear = el('button', 'btn btn-secondary btn-block', 'امسح السجل');
      clear.type = 'button';
      clear.onclick = () => {
        clearPerf();
        benchmarks = [];
        refresh();
      };
      body.append(clear);
    };
    let sheetBody = null;
    const refresh = () => {
      if (!sheetBody) return;
      sheetBody.replaceChildren(el('div', 'sheet-handle'));
      build(sheetBody);
    };
    openSheet((body) => {
      sheetBody = body;
      build(body);
      return () => {
        sheetBody = null;
      };
    });
  }

  /** الإعدادات ← قائمة الترجمة: كل المهام، بتقدّمها وأزرارها. */
  function openJobsSheet() {
    const build = (body) => {
      body.append(el('h3', null, 'قائمة الترجمة'));
      const list = translationJobs.jobs();
      if (!list.length) {
        body.append(el('p', null, 'ما فيه فصول تُترجم الحين. افتح أي عمل واضغط زر الترجمة ← «ترجم فصولًا مقدمًا».'));
        return;
      }
      for (const job of list) body.append(jobCard(job));
      if (list.some((j) => j.status === 'done')) {
        const clear = el('button', 'btn btn-block btn-secondary', 'إزالة المكتملة من القائمة');
        clear.type = 'button';
        clear.onclick = () => translationJobs.clearFinished();
        body.append(clear);
      }
    };
    openSheet((body) => {
      build(body);
      jobSheetRefresh = () => {
        body.replaceChildren(el('div', 'sheet-handle'));
        build(body);
      };
      return () => {
        jobSheetRefresh = null;
      };
    });
  }

  /**
   * «ترجم فصولًا مقدمًا»: المصدر (إنجليزي)، من فصل إلى فصل، عدد الصفحات
   * والحصة والوقت المتوقع، والوضع (أعلى جودة / أسرع)، ثم ابدأ.
   */
  function openTranslateAhead(w) {
    const ref = String(w.id);
    const sources = (w._sources ?? []).filter((x) => x.lang === 'en');
    let alive = true;
    openSheet((body) => {
      body.append(el('h3', null, 'ترجم فصولًا مقدمًا'));
      if (!sources.length) {
        body.append(el('p', null, 'هالعمل ما له مصدر إنجليزي. الترجمة تكون من الإنجليزي فقط.'));
        return () => (alive = false);
      }
      const intro = el('p', 'tl-ahead__note', 'اختر الفصول، وروح اقرأ شي ثاني. ترجع تلاقيها جاهزة بلا انتظار.');
      body.append(intro);

      let sourceId = sources[0].sourceId;
      let mode = 'quality';
      const rowsOf = (sid) => editionRows(w, sid);
      const range = (sid) => englishSources(rowsOf(sid))[0] ?? { min: 0, max: 0, count: 0 };

      // المصدر
      body.append(el('div', 'field-label tl-ahead__label', 'المصدر'));
      const srcSeg = el('div', 'segmented tl-ahead__sources');
      body.append(srcSeg);

      // من / إلى
      const field = (label) => {
        const f = el('label', 'field');
        f.append(el('span', 'field-label', label));
        const input = el('input', 'field-input');
        input.type = 'number';
        input.inputMode = 'decimal';
        input.step = 'any';
        f.append(input);
        return { f, input };
      };
      const from = field('من الفصل');
      const to = field('إلى الفصل');
      const pair = el('div', 'tl-ahead__range');
      pair.append(from.f, to.f);
      body.append(pair);

      // الوضع
      body.append(el('div', 'field-label tl-ahead__label', 'الوضع'));
      const modeSeg = el('div', 'segmented');
      const modeNote = el('p', 'tl-ahead__note');
      for (const [value, label] of [['quality', 'أعلى جودة'], ['fast', 'أسرع']]) {
        const b = el('button', null, label);
        b.type = 'button';
        b.onclick = () => {
          mode = value;
          paintMode();
          void recount();
        };
        modeSeg.append(b);
      }
      const paintMode = () => {
        for (const b of modeSeg.children) b.setAttribute('aria-pressed', String(b.textContent === (mode === 'fast' ? 'أسرع' : 'أعلى جودة')));
        modeNote.textContent =
          mode === 'fast'
            ? 'نفس لونا بدون تفكير: أسرع، وأحيانًا أخطاء أكثر. زين لفصول الأكشن قليلة الكلام.'
            : 'لونا بكامل تركيزها: أدق ترجمة، وتاخذ وقت أطول شوي.';
      };
      body.append(modeSeg, modeNote);

      // الملخص: الفصول، الصفحات، الحصة، الوقت
      const summary = el('div', 'tl-ahead__summary');
      body.append(summary);
      const keep = el('p', 'tl-ahead__note', 'تقدر تطفي الشاشة وتستخدم تطبيقات ثانية. بس لا تسكّر VANTARA من قائمة التطبيقات. بيطلع لك إشعار بالتقدّم، ولو انقطع شي يكمل من نفس الصفحة بدون ما يعيد شي.');
      body.append(keep);
      const start = el('button', 'btn btn-block btn-primary', 'ابدأ الترجمة');
      start.type = 'button';
      body.append(start);

      const counts = {};
      let usage = null;
      let counting = 0;
      void sync
        .translation('/v1/translate/usage')
        .then((res) => {
          if (res.status === 200) usage = res.body;
          paintSummary();
        })
        .catch(() => {});

      const chosen = () => pickChapters(rowsOf(sourceId), sourceId, from.input.value, to.input.value);
      function paintSummary() {
        if (!alive) return;
        const rows = chosen();
        summary.replaceChildren();
        if (!rows.length) {
          summary.append(el('p', null, 'ما فيه فصول بهالنطاق عند هالمصدر.'));
          start.disabled = true;
          return;
        }
        start.disabled = false;
        const known = rows.filter((r) => Number.isFinite(counts[chapterKeyOf(ref, r)]));
        const pages = known.reduce((n, r) => n + counts[chapterKeyOf(ref, r)], 0);
        const allKnown = known.length === rows.length;
        const approx = allKnown ? pages : known.length ? Math.round((pages / known.length) * rows.length) : null;
        summary.append(el('strong', null, `${chaptersWord(rows.length)} · ${approx === null ? 'نحسب الصفحات…' : `${allKnown ? '' : 'تقريبًا '}${pagesWord(approx)}`}`));
        if (usage?.limit) {
          const chapterLimit = usage.chapterLimit ?? 100;
          const chaptersUsed = usage.chapters ?? 0;
          summary.append(
            el('small', null, `حصتك هالأسبوع: ${usage.used} من ${usage.limit} صفحة · ${chaptersUsed} من ${chapterLimit} فصل. توقف بس لما تتجاوز الاثنين، والفصل اللي بديته يكمل. الصفحات المترجمة من قبل ما تنحسب.`),
          );
          const pagesOver = approx !== null && usage.used + approx > usage.limit;
          const chaptersOver = chaptersUsed + rows.length > chapterLimit;
          if (pagesOver && chaptersOver) summary.append(el('small', 'tl-ahead__warn', 'الحصة ما تكفي كل هالفصول: يترجم لين يوصل الحد ويوقف، ويكمل من نفس الصفحة بعد تجددها الخميس.'));
          if (usage.budgetUsd && usage.spentUsd >= usage.budgetUsd * 0.8) {
            summary.append(el('small', 'tl-ahead__warn', `الترجمة قريبة من سقف الشهر للتطبيق كله (${Math.round(usage.spentUsd * 3.75)} من ${Math.round(usage.budgetUsd * 3.75)} ريال).`));
          }
        }
        const pace = readPace()[mode];
        const minutes = approx === null ? null : estimateMinutes(approx, pace);
        summary.append(el('small', null, minutes === null ? 'الوقت المتوقع يتضح بعد أول صفحات تترجمها.' : `الوقت المتوقع: حوالي ${minutes < 60 ? `${minutes} دقيقة` : `${Math.round(minutes / 6) / 10} ساعة`}.`));
      }

      /** عدد صفحات الفصول المختارة، أربعة فصول معًا، والملخص يتحدّث أولًا بأول. */
      async function recount() {
        const ticket = ++counting;
        paintSummary();
        const queue = chosen().filter((r) => !Number.isFinite(counts[chapterKeyOf(ref, r)])).slice(0, 200);
        const worker = async () => {
          while (alive && ticket === counting && queue.length) {
            const r = queue.shift();
            try {
              const list = await engine.pages(r.sourceId, r.chapter);
              counts[chapterKeyOf(ref, r)] = list?.length ?? 0;
            } catch {
              // يُحسب وقت الترجمة
            }
            paintSummary();
          }
        };
        await Promise.all([worker(), worker(), worker(), worker()]);
      }

      function paintSources() {
        srcSeg.replaceChildren();
        for (const x of sources) {
          const b = el('button', null, x.label.replace(' · إنجليزي', ''));
          b.type = 'button';
          b.setAttribute('aria-pressed', String(x.sourceId === sourceId));
          b.onclick = () => {
            sourceId = x.sourceId;
            paintSources();
            setRange();
          };
          srcSeg.append(b);
        }
      }
      function setRange() {
        const r = range(sourceId);
        // من أول فصل ما قرأته عند هالمصدر، عشرة فصول
        const unread = rowsOf(sourceId)
          .filter((row) => Number.isFinite(row.number) && row.number >= 0 && !isChapterRead(sync, ref, chapterKeyOf(ref, row)))
          .sort((a, b) => a.number - b.number)[0];
        const lo = unread?.number ?? r.min;
        const ordered = rowsOf(sourceId).map((row) => row.number).filter((n) => Number.isFinite(n) && n >= lo).sort((a, b) => a - b);
        from.input.value = String(lo);
        to.input.value = String(ordered[Math.min(ordered.length - 1, 9)] ?? r.max);
        from.input.min = to.input.min = String(r.min);
        from.input.max = to.input.max = String(r.max);
        void recount();
      }
      let debounce = 0;
      for (const input of [from.input, to.input]) {
        input.oninput = () => {
          clearTimeout(debounce);
          debounce = setTimeout(() => void recount(), 350);
        };
      }

      start.onclick = async () => {
        const rows = chosen();
        if (!rows.length) return;
        const models = await modelsStatus().catch(() => null);
        if (!models?.installed) {
          toast('حمّل ملفات الترجمة أول: الإعدادات ← الترجمة');
          return;
        }
        await notificationPermission();
        const label = sources.find((x) => x.sourceId === sourceId)?.label ?? sourceId;
        const pageCounts = {};
        for (const r of rows) {
          const key = chapterKeyOf(ref, r);
          if (Number.isFinite(counts[key])) pageCounts[key] = counts[key];
        }
        translationJobs.add(createJob({ ref, title: titleOf(w), sourceId, sourceLabel: label, mode, rows, keyOf: (r) => chapterKeyOf(ref, r), pageCounts }));
        // الفصول المجهّزة تُعرض عربية في القارئ حتى في وضع «عند الطلب»
        if (!translationOn(ref)) setTranslation(ref, true);
        renderTranslateToggle(w);
        closeSheet();
        toast(`بدأت ترجمة ${chaptersWord(rows.length)} في الخلفية. بيطلع لك إشعار بالتقدّم`);
      };

      paintSources();
      paintMode();
      setRange();
      return () => {
        alive = false;
        counting += 1;
      };
    });
  }
  function renderInfo(w) {
    renderTranslateToggle(w);
    const role = (needle) =>
      unique((w.staff?.edges || []).filter((e) => (e.role || '').toLowerCase().includes(needle)).map((e) => e.node?.name?.full)).join('، ');
    const pairs = [
      ['المؤلف', role('story')],
      ['الرسام', role('art')],
      ['الحالة', STATUS_AR[w.status]],
      ['الفصول', w._chapters ? String(w._chapters.length) : null],
      ['المصادر', (w._sources ?? w._work?.editions ?? []).map((s) => s.label).join('، ')],
      ['التصنيفات', (w.genres || []).map(genreAr).join('، ')],
    ].filter(([, v]) => v);
    const grid = q('infoGrid');
    grid.replaceChildren(
      ...pairs.map(([a, b]) => {
        const d = el('div', 'info-box');
        d.append(el('div', 'info-label', a), el('div', 'info-value', b));
        return d;
      }),
    );
    // خانة وحيدة في شبكة من عمودين تترك نصفها فارغًا
    if (pairs.length % 2) grid.append(el('div', 'info-box'));
    grid.parentElement.hidden = pairs.length === 0;
  }
  function chapterMessage(text) {
    q('chapterPanel').replaceChildren(el('div', 'no-data', text));
  }
  function renderChaptersLoading() {
    q('chapterCount').textContent = '';
    q('sourcesBlock').hidden = true;
    q('detailProgress').hidden = true;
    const list = el('div', 'chapter-list');
    list.setAttribute('aria-busy', 'true');
    for (let i = 0; i < 6; i++) {
      const row = el('div', 'chapter-row');
      row.innerHTML =
        '<div class="chapter-open"><span class="skeleton-line" style="width:40%;margin:0"></span><span class="skeleton-line" style="width:24%"></span></div>';
      list.append(row);
    }
    q('chapterPanel').replaceChildren(list);
    setReadCta(undefined);
  }

  /**
   * زرّ القراءة: «ابدأ» لمن لم يقرأ، «تابع» لمن قرأ، ومعه الفصل الذي سيُفتح.
   * `undefined` = الفصول تُجمع، `null` = لا فصول.
   */
  function setReadCta(next, { started = false } = {}) {
    const btn = q('readCta');
    const label = q('readCtaLabel');
    const sub = q('readCtaSub');
    btn.disabled = !next;
    sub.textContent = '';
    if (next === undefined) label.textContent = 'جارٍ جمع الفصول';
    else if (next === null) label.textContent = 'لا فصول متاحة';
    else {
      label.textContent = started ? 'تابع القراءة' : 'ابدأ القراءة';
      sub.textContent = next.chapter.name || `الفصل ${next.number}`;
      sub.dir = 'auto';
    }
  }

  /**
   * المصدر تحت زرّ القراءة: «القارئ الذكي» أولًا (يدمج أفضل نسخة لكل فصل ولا
   * يفرض مصدرًا بعينه)، ثم مصدران، والباقي في ورقة «كل المصادر».
   *
   * المصدران الظاهران: المختار إن كان أحد المصادر، ثم الأكثر فصولًا.
   */
  function renderSources(w) {
    // العربي أولًا دائمًا، ثم الأكثر فصولًا؛ الإنجليزي بعده بوسمه
    const sources = [...(w._sources ?? [])].sort((a, b) => (a.lang === 'en') - (b.lang === 'en') || b.count - a.count);
    const failed = w._failedSources ?? [];
    q('sourcesBlock').hidden = sources.length + failed.length < 2;
    const pick = (value) => {
      state.chapterSource = value;
      state.chapterShown = CHAPTER_BATCH;
      renderSources(w);
      renderChapters(w);
    };
    const chip = (label, count, value, extra = '') => {
      const b = el('button', `source-chip${extra}`);
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(state.chapterSource === value));
      b.setAttribute('aria-pressed', String(state.chapterSource === value));
      b.append(el('span', null, label));
      if (count !== null) b.append(el('b', null, String(count)));
      b.onclick = () => pick(value);
      return b;
    };
    const smart = chip('القارئ الذكي', null, null, ' source-chip--smart');
    smart.insertAdjacentHTML('afterbegin', glyph('spark'));
    const selected = sources.find((x) => x.sourceId === state.chapterSource);
    const shown = selected ? [selected, ...sources.filter((x) => x !== selected)].slice(0, 2) : sources.slice(0, 2);
    const chips = [smart, ...shown.map((x) => chip(x.label, x.count, x.sourceId))];
    const hiddenCount = sources.length - shown.length + failed.length;
    if (hiddenCount > 0 || failed.length) {
      const all = el('button', 'source-chip source-chip--all');
      all.type = 'button';
      all.innerHTML = glyph('layers');
      all.append(el('span', null, 'كل المصادر'), el('b', null, String(sources.length + failed.length)));
      all.setAttribute('aria-label', `كل المصادر المتوفرة لهذا العمل: ${countLabel(sources.length + failed.length, 'source')}`);
      all.onclick = () => openSourcesSheet(w, sources, failed, pick);
      chips.push(all);
    }
    q('sourceRow').replaceChildren(...chips);
  }
  function openSourcesSheet(w, sources, failed, pick) {
    openSheet((body) => {
      body.append(el('h3', null, 'المصادر المتوفرة'));
      const note = el('p', null, 'القارئ الذكي يجمع فصول كل المصادر ويختار لكل فصل أوثق نسخة. اختر مصدرًا لتقرأ فصوله كما هي عنده.');
      note.style.marginBottom = '8px';
      body.append(note);
      const row = (icon, label, count, value) => {
        const b = sheetItem(icon, label, () => {
          closeSheet();
          pick(value);
        }, { pressed: state.chapterSource === value });
        if (count !== null) {
          const c = el('span', 'value', countLabel(count, 'chapter'));
          c.style.cssText = 'margin-inline-start:auto;color:var(--text-3);font-size:var(--fs-meta)';
          b.querySelector('.trail')?.before(c) ?? b.append(c);
        }
        return b;
      };
      body.append(row('spark', 'القارئ الذكي', w._chapters?.length ?? 0, null));
      for (const x of sources) body.append(row('layers', x.label, x.count, x.sourceId));
      for (const f of failed) {
        const b = el('div', 'sheet-item');
        b.innerHTML = glyph('alert');
        b.querySelector('.icon').style.color = 'var(--warning)';
        b.append(el('span', null, f.label));
        const c = el('span', null, 'ما ردّ الآن');
        c.style.cssText = 'margin-inline-start:auto;color:var(--text-3);font-size:var(--fs-meta)';
        b.append(c);
        b.style.opacity = '.7';
        body.append(b);
      }
    });
  }

  function visibleRows(w) {
    const rows = state.chapterSource ? editionRows(w, state.chapterSource) : w._chapters ?? [];
    return state.chapterNewestFirst ? rows : [...rows].reverse();
  }

  /**
   * الفصل الذي يُكمَل منه: صف التقدم الأحدث لهذا العمل. لم ينتهِ (< 98%) →
   * هو نفسه؛ انتهى → الذي يليه بالترتيب. الفصول من المصدر المعروض نفسه، فلا
   * يُبدَّل المصدر على المستخدم.
   */
  function continueRow(ref, base) {
    const userId = sync.user?.userId;
    const rows = sync.rows('progress', (r) => r.user_id === userId && r.series_ref === ref);
    if (!rows.length || !base.length) return null;
    const latest = rows.reduce((a, b) => ((b.updated_at ?? 0) > (a.updated_at ?? 0) ? b : a));
    // الترتيب من الأقدم للأحدث
    const ordered = [...base].sort((a, b) => (Number(a.number) || 0) - (Number(b.number) || 0));
    const at = ordered.findIndex((r) => chapterKeyOf(ref, r) === latest.chapter_key);
    if (at < 0) return null;
    if ((latest.ratio ?? 0) < 0.98) return ordered[at];
    return ordered[at + 1] ?? ordered[at];
  }

  function renderChapters(w) {
    const all = w._chapters ?? [];
    if (!all.length) {
      q('chapterCount').textContent = '';
      chapterMessage('المصادر لم تُرجع فصولًا لهذا العمل.');
      setReadCta(null);
      return;
    }
    const ref = String(w.id);
    const read = (r) => isChapterRead(sync, ref, chapterKeyOf(ref, r));
    const readCount = all.filter(read).length;
    const base = state.chapterSource ? editionRows(w, state.chapterSource) : all;
    // «تابع» = آخر فصل كنت فيه فعلًا (آخر تقدم محفوظ)، ولو لم تُعلَّم الفصول قبله
    // مقروءة؛ أنهيته؟ فالذي بعده. ولا تقدم؟ فأول فصل غير مقروء من الأقدم.
    const next = continueRow(ref, base) ?? [...base].reverse().find((r) => !read(r)) ?? base[0] ?? all[0];
    state.nextRow = next;
    setReadCta(next, { started: readCount > 0 });
    // الفصل الذي سيفتحه «ابدأ/تابع» يُجهَّز الآن، لا بعد الضغطة
    const warmKey = next ? `${next.sourceId}|${next.chapter?.url}` : null;
    if (warmKey && warmKey !== state.warmKey && available()) {
      state.warmKey = warmKey;
      clearTimeout(state.warmTimer);
      state.warmTimer = setTimeout(() => warmChapter(engine, next), 600);
    }

    q('detailProgress').hidden = false;
    q('progressFill').style.width = `${Math.round((readCount / all.length) * 100)}%`;
    q('progressText').textContent = readCount ? `قرأت ${readCount} من ${all.length}` : 'لم تبدأ بعد';

    const rows = visibleRows(w);
    q('chapterCount').textContent = String(rows.length);
    const list = el('div', 'chapter-list');
    const fragment = document.createDocumentFragment();
    const nextKey = chapterKeyOf(ref, next);
    for (const r of rows.slice(0, state.chapterShown)) {
      fragment.append(chapterRow(w, r, read(r), chapterKeyOf(ref, r) === nextKey));
    }
    list.append(fragment);
    const parts = [list];
    const rest = rows.length - state.chapterShown;
    if (rest > 0) {
      const more = el('button', 'btn btn-secondary chapter-more', `اعرض ${countLabel(rest, 'chapter')} أخرى`);
      more.type = 'button';
      more.onclick = () => {
        state.chapterShown += 400;
        renderChapters(w);
      };
      parts.push(more);
    }
    q('chapterPanel').replaceChildren(...parts);
  }
  function chapterRow(w, r, isRead, isNext) {
    const ref = String(w.id);
    const row = el('div', `chapter-row${isRead ? ' is-read' : ''}${isNext ? ' is-next' : ''}`);
    const open = el('button', 'chapter-open');
    open.type = 'button';
    const no = el('div', 'chapter-no', r.chapter.name || `الفصل ${r.number}`);
    no.dir = 'auto';
    const note = el(
      'div',
      'chapter-note',
      [dateLabel(r.chapter.dateUpload), r.chapter.scanlator].filter(Boolean).join(' · '),
    );
    open.append(no, note);
    open.onclick = () => openChapter(w, r);
    const eye = el('button', 'chapter-eye');
    eye.type = 'button';
    const paint = (on) => {
      eye.classList.toggle('chapter-eye--read', on);
      eye.setAttribute('aria-pressed', String(on));
      eye.innerHTML = glyph('eye') + (on ? `<span class="chapter-eye__check">${glyph('check')}</span>` : '');
      const label = on ? 'مقروء — المس لإلغاء التعليم' : 'علّمه مقروءًا';
      eye.setAttribute('aria-label', label);
      eye.title = label;
      row.classList.toggle('is-read', on);
    };
    paint(isRead);
    eye.onclick = (e) => {
      e.stopPropagation();
      const on = !isChapterRead(sync, ref, chapterKeyOf(ref, r));
      markChapter(sync, ref, r, on);
      if (on) recordChapterView(w, r);
      paint(on);
      // التقدّم وزرّ «تابع» يتبعان العين بعد لحظة، لا بعد المزامنة
      clearTimeout(state.eyeTimer);
      state.eyeTimer = setTimeout(() => state.current === w && renderChapters(w), 450);
    };
    row.append(open, eye);
    return row;
  }
  function dateLabel(ms) {
    if (!ms) return '';
    const days = Math.floor((Date.now() - ms) / 86_400_000);
    if (days < 1) return 'اليوم';
    if (days < 2) return 'أمس';
    if (days < 7) return `قبل ${countLabel(days, 'day')}`;
    return new Date(ms).toLocaleDateString('ar', {
      day: 'numeric',
      month: 'short',
      year: days > 330 ? 'numeric' : undefined,
      numberingSystem: 'latn',
    });
  }
  function flipChapterOrder() {
    if (!state.current?._chapters) return;
    state.chapterNewestFirst = !state.chapterNewestFirst;
    toast(state.chapterNewestFirst ? 'الأحدث أولًا' : 'الأقدم أولًا');
    renderChapters(state.current);
  }
  function readNow() {
    if (state.current && state.nextRow) openChapter(state.current, state.nextRow);
  }
  function openChapter(w, row) {
    // المصدر المختار يقرأ فصوله هو؛ الذكي يمرّ على الأفضل لكل فصل
    const rows = state.chapterSource ? editionRows(w, state.chapterSource) : w._chapters;
    deps.openReader({ seriesRef: String(w.id), title: titleOf(w), work: w, rows, row, sourceLocked: Boolean(state.chapterSource) });
  }

  // ── ورقة المعاينة ──
  // من المجلس والملف: لمسة على عملٍ تعرض غلافه ونبذته أولًا، ثم «افتح».
  // لمسةٌ بالغلط وأنت تمرّر لا تنقلك من مكانك.

  function previewWork(work, { chapter = null } = {}) {
    let alive = true;
    openSheet((body) => {
      const box = el('div', 'pv');
      const cover = el('div', 'pv-cover');
      void mountImage(cover, work);
      const copy = el('div', 'pv-copy');
      const title = el('h3', 'pv-title', titleOf(work));
      title.dir = 'auto';
      const meta = el('div', 'pv-meta');
      const desc = el('p', 'pv-desc');
      desc.innerHTML = '<span class="skeleton-line"></span><span class="skeleton-line"></span>';
      copy.append(title, meta, desc);
      box.append(cover, copy);
      body.append(box);

      const actions = el('div', 'sheet-actions pv-actions');
      if (chapter && Number.isFinite(chapter.number)) {
        const read = el('button', 'btn btn-primary');
        read.type = 'button';
        read.innerHTML = glyph('book');
        read.append(el('span', null, `اقرأ ${chapter.label}`));
        read.onclick = () => {
          closeSheet();
          void openWork(work, { readNumber: chapter.number });
        };
        const page = el('button', 'btn btn-secondary', 'صفحة العمل');
        page.type = 'button';
        page.onclick = () => {
          closeSheet();
          void openWork(work);
        };
        actions.append(read, page);
      } else {
        const open = el('button', 'btn btn-primary btn-block');
        open.type = 'button';
        open.innerHTML = glyph('book');
        open.append(el('span', null, 'افتح العمل'));
        open.onclick = () => {
          closeSheet();
          void openWork(work);
        };
        actions.append(open);
      }
      body.append(actions);

      if (!available()) {
        desc.textContent = '';
        return () => (alive = false);
      }
      describe(work)
        .then((full) => {
          if (!alive) return;
          const bits = [STATUS_AR[full.status], (full.genres || []).slice(0, 3).map(genreAr).join(' · '), full._chapterCount ? countLabel(full._chapterCount, 'chapter') : null].filter(Boolean);
          meta.textContent = bits.join(' · ');
          const text = clean(full.description);
          desc.textContent = text || 'لا توجد نبذة من المصدر.';
          desc.dir = 'auto';
          if (full._work?.editions?.length && !work._work?.editions?.length) work = full;
        })
        .catch(() => {
          if (alive) desc.textContent = 'ما قدرنا نجيب النبذة الحين.';
        });
      return () => (alive = false);
    });
  }

  // ── المكتبة والتقييم (في حسابك) ──

  function toggleLibraryCurrent() {
    if (!state.current) return;
    const d = descriptorOf(state.current);
    if (libraryEntry(d.seriesRef)?.row) {
      sync.enqueue('library.remove', { seriesRef: d.seriesRef });
      toast('أزيل من مكتبتك');
    } else {
      sync.enqueue('library.add', d);
      toast('أضيف إلى مكتبتك');
    }
    afterLibraryChange();
  }
  function toggleLaterCurrent() {
    if (!state.current) return;
    const d = descriptorOf(state.current);
    const member = !inCollection('read_later', d.seriesRef);
    sync.enqueue('readLater.set', { ...d, member });
    toast(member ? 'في «أقرأ لاحقًا»' : 'أزيل من «أقرأ لاحقًا»');
    afterLibraryChange();
  }
  function toggleFavoriteCurrent() {
    if (!state.current) return;
    const d = descriptorOf(state.current);
    const member = !inCollection('favorite', d.seriesRef);
    sync.enqueue('favorite.set', { ...d, member });
    toast(member ? 'أضيف إلى المفضلة' : 'أزيل من المفضلة');
    afterLibraryChange();
  }
  /** أفضل 5: قائمة قصيرة مرتبة. حين تمتلئ تختار ما يخرج بدل أن يُرفض الطلب. */
  const TOP_MAX = 5;
  function topRows() {
    return sync
      .rows('collections', (r) => r.user_id === me() && r.kind === 'top' && r.member)
      .sort((a, b) => (a.position ?? 99) - (b.position ?? 99) || a.updated_at - b.updated_at);
  }
  /**
   * «أفضل 5» خانات ثابتة من 1 إلى 5. خانة كل عمل موضعه المحفوظ؛ ما حُفظ قديمًا
   * بلا موضع صالح (أو بموضع مكرّر) يأخذ أول خانة فارغة بترتيبه.
   * @returns {Array<object|null>} خمس خانات
   */
  function topSlots() {
    const slots = [null, null, null, null, null];
    const loose = [];
    for (const row of topRows()) {
      const p = Number(row.position);
      if (Number.isInteger(p) && p >= 1 && p <= TOP_MAX && !slots[p - 1]) slots[p - 1] = row;
      else loose.push(row);
    }
    for (const row of loose) {
      const free = slots.indexOf(null);
      if (free < 0) break;
      slots[free] = row;
    }
    return slots;
  }
  const topTitle = (row) => displayTitle(row.series_ref, sync.rows('works', (w) => w.series_ref === row.series_ref)[0]?.title);
  /**
   * يضع عملًا في خانة يختارها صاحبه. الخانة المشغولة: عملها يبادل مكانه إن
   * كان هذا في خانة أخرى، أو يخرج إن كان جديدًا. لا عمل في خانتين أبدًا.
   */
  function placeInTop(d, slot) {
    const slots = topSlots();
    const from = slots.findIndex((r) => r?.series_ref === d.seriesRef);
    const occupant = slots[slot - 1];
    if (from === slot - 1) return;
    if (occupant && occupant.series_ref !== d.seriesRef) {
      if (from >= 0) sync.enqueue('top.set', { seriesRef: occupant.series_ref, member: true, position: from + 1 });
      else sync.enqueue('top.set', { seriesRef: occupant.series_ref, member: false });
    }
    sync.enqueue('top.set', { ...d, member: true, position: slot });
    // الخانات الأخرى تُثبَّت بمواضعها: قائمة قديمة بلا مواضع تصير صريحة مرة واحدة
    slots.forEach((r, i) => {
      if (!r || r.series_ref === d.seriesRef || r === occupant || Number(r.position) === i + 1) return;
      sync.enqueue('top.set', { seriesRef: r.series_ref, member: true, position: i + 1 });
    });
  }
  function removeFromTop(ref) {
    sync.enqueue('top.set', { seriesRef: ref, member: false });
  }
  /** «أضف إلى أفضل 5»: ورقة بخمس خانات، والمستخدم يختار الرقم. */
  function openTopPicker(w = state.current) {
    if (!w) return;
    const d = descriptorOf(w);
    openSheet((body) => {
      const slots = topSlots();
      const here = slots.findIndex((r) => r?.series_ref === d.seriesRef);
      body.append(el('h3', null, here >= 0 ? `في أفضل 5 — رقم ${here + 1}` : 'أضف إلى أفضل 5'));
      const note = el('p', null, 'اختر رقمه. الخانة المشغولة يطلع عملها أو يبادل مكانه.');
      note.style.marginBottom = '8px';
      body.append(note);
      const list = el('div', 'top-slots');
      slots.forEach((row, i) => {
        const b = el('button', `top-slot${i === here ? ' top-slot--here' : ''}${row ? '' : ' top-slot--empty'}`);
        b.type = 'button';
        b.append(el('span', `top-slot-no${i === 0 ? ' top-slot-no--gold' : ''}`, String(i + 1)));
        const t = el('bdi', 'top-slot-title', row ? topTitle(row) : 'فارغة');
        b.append(t);
        if (row && i !== here) b.append(el('span', 'top-slot-hint', here >= 0 ? 'يبادل' : 'يطلع'));
        b.onclick = () => {
          closeSheet();
          placeInTop(d, i + 1);
          toast(`صار رقم ${i + 1} في أفضل 5`);
          afterLibraryChange();
        };
        list.append(b);
      });
      body.append(list);
      if (here >= 0) {
        body.append(
          sheetItem('trash', 'أزله من أفضل 5', () => {
            closeSheet();
            removeFromTop(d.seriesRef);
            toast('أُزيل من أفضل 5');
            afterLibraryChange();
          }, { danger: true }),
        );
      }
    });
  }
  const toggleTopCurrent = () => openTopPicker(state.current);
  function afterLibraryChange() {
    refreshLibraryDetail();
    // الطابور يكتب في المرآة مع الدفع؛ onChange يعيد الرسم حين يعود
    setTimeout(refreshLibraryDetail, 700);
  }
  function refreshLibraryDetail() {
    if (!state.current) return;
    const e = libraryEntry(String(state.current.id));
    const btn = q('libraryBtn');
    const inLib = !!e?.row;
    btn.setAttribute('aria-pressed', String(inLib));
    btn.innerHTML = glyph('library', { filled: inLib });
    const label = inLib ? 'في مكتبتي — المس للإزالة' : 'أضف إلى مكتبتي';
    btn.setAttribute('aria-label', label);
    btn.title = label;
    const fav = root.querySelector('.icon-btn--fav');
    fav.setAttribute('aria-pressed', String(!!e?.favorite));
    fav.innerHTML = glyph('heart', { filled: !!e?.favorite });
  }
  function userRating(ref) {
    const row = sync.rows('ratings', (r) => r.user_id === me() && r.series_ref === String(ref))[0];
    return row?.score ? Math.round(row.score / 2) : 0;
  }
  let pendingRating = null;
  /** التقييم نجومٌ في مكانها: لمسة واحدة، بلا نافذة. */
  function renderRating() {
    const box = q('rateStars');
    const current = pendingRating?.ref === state.current?.id ? pendingRating.stars : state.current ? userRating(state.current.id) : 0;
    box.replaceChildren(
      ...[1, 2, 3, 4, 5].map((i) => {
        const b = el('button', i <= current ? 'on' : '');
        b.type = 'button';
        b.setAttribute('role', 'radio');
        b.setAttribute('aria-checked', String(i === current));
        b.setAttribute('aria-label', `تقييمك ${i} من 5`);
        b.innerHTML = glyph('star', { filled: i <= current, size: 20 });
        b.onclick = () => {
          if (!state.current) return;
          // الخادم يحفظ من 10؛ النجوم خمس
          sync.enqueue('rating.set', { ...descriptorOf(state.current), score: i * 2 });
          pendingRating = { ref: state.current.id, stars: i };
          toast(`قيّمته ${i} من 5`);
          renderRating();
        };
        return b;
      }),
    );
  }

  // ── قائمة ⋮ في صفحة العمل ──

  function openWorkMenu() {
    if (!state.current) return;
    const w = state.current;
    const e = libraryEntry(String(w.id));
    openSheet((body) => {
      const title = el('h3', null, titleOf(w));
      title.dir = 'auto';
      title.style.marginBottom = '8px';
      body.append(title);
      body.append(
        sheetItem('clock', 'أقرأ لاحقًا', () => {
          closeSheet();
          toggleLaterCurrent();
        }, { pressed: !!e?.later }),
        sheetItem('star', inCollection('top', String(w.id)) ? 'في أفضل 5 — غيّر رقمه' : 'أضف إلى أفضل 5', () => {
          closeSheet();
          setTimeout(() => toggleTopCurrent(), 0);
        }, { pressed: inCollection('top', String(w.id)) }),
        sheetItem('check', 'أكملته', () => {
          closeSheet();
          const member = !inCollection('completed', String(w.id));
          sync.enqueue('completed.set', { ...descriptorOf(w), member });
          toast(member ? 'في «المكتمل»' : 'أزيل من «المكتمل»');
        }, { pressed: inCollection('completed', String(w.id)) }),
      );
      if (deps.report) {
        body.append(
          sheetItem('flag', 'بلّغ عن مشكلة في العمل', () => {
            closeSheet();
            openReport(w);
          }),
        );
      }
    });
  }
  function avatarNode(person, size = 44) {
    if (person.avatarKey) {
      const img = el('img');
      img.src = person.avatarKey;
      img.alt = '';
      img.style.cssText = `width:${size}px;height:${size}px;border-radius:99px;object-fit:cover;flex:none`;
      return img;
    }
    const s = el('span', 'avatar-letter', initialOf(person.displayName));
    s.style.cssText = `width:${size}px;height:${size}px;border-radius:99px;flex:none`;
    return s;
  }
  function latestChapter(rows) {
    return rows.reduce((best, row) => {
      if (!best) return row;
      const a = Number(best.number);
      const b = Number(row.number);
      if (!Number.isFinite(a)) return row;
      return Number.isFinite(b) && b > a ? row : best;
    }, null);
  }
  function refreshChaptersSoon(w) {
    clearTimeout(state.eyeTimer);
    state.eyeTimer = setTimeout(() => state.current?.id === w.id && renderChapters(w), 30);
  }
  /** تعليم (أو إلغاء) دفعة فصول: عملية واحدة، والصفحة تتحدث حالًا. */
  function markRows(w, rows, read, historyRow = null) {
    const changed = markChapters(sync, String(w.id), rows, read);
    if (read && historyRow) recordChapterView(w, historyRow);
    refreshChaptersSoon(w);
    return changed;
  }
  /** «من ← إلى»: للتعليم أو للإلغاء، بنفس الورقة. */
  function openChapterRange(w, read) {
    openSheet((body) => {
      body.append(el('h3', null, read ? 'علّم الفصول التي قرأتها' : 'ألغِ تعليم فصول'));
      const numbers = (w._chapters ?? []).map((r) => r.number).filter((n) => Number.isFinite(n) && n >= 0);
      const hint = el('p', null, numbers.length ? `فصول العمل من ${Math.min(...numbers)} إلى ${Math.max(...numbers)}` : '');
      hint.style.marginBottom = '8px';
      body.append(hint);
      const field = (label) => {
        const f = el('label', 'field');
        f.append(el('span', 'field-label', label));
        const input = el('input', 'field-input');
        input.type = 'number';
        input.inputMode = 'decimal';
        input.step = 'any';
        input.placeholder = 'رقم الفصل';
        f.append(input);
        return { f, input };
      };
      const from = field('من');
      const to = field('إلى');
      const save = el('button', `btn btn-block ${read ? 'btn-primary' : 'btn-secondary'}`, read ? 'علّمها مقروءة' : 'ألغِ تعليمها');
      save.type = 'button';
      save.onclick = () => {
        const start = Number(from.input.value);
        const end = Number(to.input.value);
        if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) {
          toast('اكتب نطاقًا صحيحًا من فصل إلى فصل');
          return;
        }
        const rows = (w._chapters ?? []).filter((row) => Number.isFinite(row.number) && row.number >= start && row.number <= end);
        if (!rows.length) {
          toast('ما لقينا فصولًا داخل هذا النطاق');
          return;
        }
        const historyRow = rows.reduce((best, row) => (!best || row.number > best.number ? row : best), null);
        closeSheet();
        const n = markRows(w, rows, read, historyRow);
        toast(n ? `${read ? 'علّمت' : 'ألغيت تعليم'} ${countLabel(n, 'chapter')}` : read ? 'كلها مقروءة من قبل' : 'ما فيها فصل معلّم');
      };
      body.append(from.f, to.f, save);
      requestAnimationFrame(() => from.input.focus());
    });
  }
  function markPreviousReading() {
    const w = state.current;
    const rows = w?._chapters ?? [];
    if (!w || !rows.length) {
      toast('انتظر لين تجهز الفصول');
      return;
    }
    const ref = String(w.id);
    const readCount = rows.filter((r) => isChapterRead(sync, ref, chapterKeyOf(ref, r))).length;
    openSheet((body) => {
      body.append(el('h3', null, 'قراءتك لهذا العمل'));
      const note = el('p', null, readCount ? `علّمت ${countLabel(readCount, 'chapter')} من ${rows.length}.` : 'هل قرأته من قبل؟ علّم ما قرأته ويظهر في سجلّك.');
      note.style.marginBottom = '8px';
      body.append(note);
      body.append(
        sheetItem('check', 'نعم، كله', () => {
          closeSheet();
          const n = markRows(w, rows, true, latestChapter(rows));
          toast(n ? `علّمت ${countLabel(n, 'chapter')} مقروءة` : 'كلها مقروءة من قبل');
        }),
        sheetItem('eye', 'من فصل إلى فصل', () => openChapterRange(w, true)),
      );
      if (readCount) {
        body.append(el('div', 'settings-group-label', 'إلغاء'));
        body.append(
          sheetItem('close', 'ألغِ تعليم فصول (من ← إلى)', () => openChapterRange(w, false), { danger: true }),
          sheetItem('trash', 'ألغِ تعليم كل الفصول', () => {
            closeSheet();
            const n = clearChapterMarks(sync, ref);
            refreshChaptersSoon(w);
            toast(n ? `ألغيت تعليم ${countLabel(n, 'chapter')}` : 'ما فيه فصل معلّم');
          }, { danger: true }),
        );
      }
    });
  }

  /** مشاركة العمل (أو فصلٍ منه): الورقة المشتركة مع القارئ في `share.js`. */
  function openShare(w, chapter = null) {
    openShareSheet({
      sync,
      friends: deps.friends?.() ?? [],
      openSheet,
      closeSheet,
      sheetBody: () => q('sheetBody'),
      toast,
      work: { ref: String(w.id), title: titleOf(w), cover: w.coverImage?.large ?? null },
      chapter,
    });
  }
  function everyoneFace(size = 58) {
    const s = el('span', 'avatar-letter share-everyone');
    s.innerHTML = glyph('users', { size: Math.round(size * 0.42) });
    s.style.cssText = `width:${size}px;height:${size}px;border-radius:99px;flex:none`;
    return s;
  }
  const REPORT_CHOICES = [
    ['DUPLICATE_WORK', 'العمل مكرر'],
    ['WRONG_CHAPTER_NUMBER', 'أرقام الفصول خطأ'],
    ['LOW_QUALITY', 'جودة الصور ضعيفة'],
    ['OTHER', 'شيء ثاني'],
  ];
  function openReport(w) {
    openSheet((body) => {
      body.append(el('h3', null, 'وش المشكلة؟'));
      for (const [kind, label] of REPORT_CHOICES) {
        body.append(
          sheetItem('flag', label, async () => {
            closeSheet();
            try {
              await deps.report({ kind, seriesRef: String(w.id), sourceId: w._work?.editions?.[0]?.sourceId ?? null });
              toast('وصل البلاغ، شكرًا');
            } catch {
              toast('ما قدرنا نرسل البلاغ الآن');
            }
          }),
        );
      }
    });
  }

  // ───────────────────────── المكتبة ─────────────────────────

  // ── «آخر المشاهدات»: قائمة لا شبكة — الغلاف، الاسم، آخر فصل ومتى، وحذف ──
  function viewedLabel(at) {
    const days = Math.floor((Date.now() - at) / 86_400_000);
    if (days < 7) return timeAgo(at).replace(/^الآن$/, 'منذ أقل من دقيقة');
    return new Date(at).toLocaleDateString('ar', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', numberingSystem: 'latn' }).replace('، ', ' - ');
  }
  function chapterRatio(userId, ref, number) {
    if (number == null) return null;
    const key = chapterKeyOf(ref, { chapter: { chapterNumber: number, name: '' }, sourceId: '' });
    const row = sync.rows('progress', (r) => r.user_id === userId && r.chapter_key === key)[0];
    return row ? Math.max(0, Math.min(1, Number(row.ratio) || 0)) : null;
  }
  /**
   * @param {HTMLElement} target
   * @param {{ userId?: string, own?: boolean, limit?: number }} [opts]
   */
  function renderHistoryList(target, { userId = me(), own = userId === me(), limit = Infinity } = {}) {
    const rows = viewRows(userId);
    if (!rows.length) {
      emptyState(target, {
        icon: 'history',
        title: own ? 'ما قريت شي بعد' : 'ما فيه مشاهدات',
        text: own ? 'يظهر العمل هنا بعد قراءة 20% من فصل أو تعليم فصل كمقروء.' : 'لما يقرأ فصلًا يظهر هنا.',
      });
      return;
    }
    // مجموعات بالأيام كما يُقرأ السجل: اليوم، أمس، هذا الأسبوع، أقدم
    const startOfDay = new Date().setHours(0, 0, 0, 0);
    const dayOf = (at) => (at >= startOfDay ? 'اليوم' : at >= startOfDay - 86_400_000 ? 'أمس' : at >= startOfDay - 6 * 86_400_000 ? 'هذا الأسبوع' : 'أقدم');
    const list = el('div', 'rv-list');
    let day = null;
    for (const v of rows.slice(0, limit)) {
      const at = v.viewed_at ?? Date.now();
      const d = dayOf(at);
      if (d !== day) {
        day = d;
        list.append(el('div', 'rv-day', d));
      }
      const work = workFromRef(v.series_ref, v.series_title, v.cover_url);
      const item = el('div', 'rv-row');
      const open = el('button', 'rv-open');
      open.type = 'button';
      const cover = el('span', 'rv-cover');
      void mountImage(cover, work);
      const copy = el('span', 'rv-copy');
      copy.append(el('bdi', 'rv-title', titleOf(work)));
      const meta = el('span', 'rv-meta');
      if (v.chapter_label || v.chapter_number != null) {
        const ch = el('span', 'rv-chapter');
        ch.innerHTML = glyph('book', { size: 13 });
        ch.append(el('bdi', null, v.chapter_label || `الفصل ${v.chapter_number}`));
        meta.append(ch);
      }
      meta.append(el('time', 'rv-time', d === 'اليوم' || d === 'أمس' ? timeAgo(at).replace(/^الآن$/, 'الآن') : viewedLabel(at)));
      copy.append(meta);
      // تقدّم الفصل الأخير إن كان في منتصفه: شريط رفيع لا رقم «0%»
      const ratio = chapterRatio(userId, v.series_ref, v.chapter_number);
      if (ratio !== null && ratio > 0.02 && ratio < 0.98) {
        const bar = el('span', 'rv-progress');
        bar.style.setProperty('--p', `${Math.round(ratio * 100)}%`);
        copy.append(bar);
      }
      open.append(cover, copy);
      open.onclick = () => void openWork(work);
      item.append(open);
      if (own) {
        const del = el('button', 'rv-del');
        del.type = 'button';
        del.innerHTML = glyph('close', { size: 18 });
        del.setAttribute('aria-label', `احذف ${titleOf(work)} من آخر المشاهدات`);
        del.onclick = () => {
          item.classList.add('rv-row--gone');
          setTimeout(() => removeView(v.series_ref), 180);
        };
        item.append(del);
      }
      list.append(item);
    }
    target.replaceChildren(list);
  }

  function renderLibrary() {
    const tabs = [['all', 'الكل'], ['reading', 'أتابعها'], ['history', 'آخر المشاهدات'], ['later', 'لاحقًا'], ['completed', 'المكتمل'], ['favorite', 'المفضلة']];
    q('libraryTabs').replaceChildren(
      ...tabs.map(([k, l]) => {
        const b = el('button', `library-tab${k === state.libraryFilter ? ' active' : ''}`, l);
        b.type = 'button';
        b.setAttribute('role', 'tab');
        b.setAttribute('aria-selected', String(k === state.libraryFilter));
        const n = k === 'history' ? viewRows().length : libraryWorks(k).length;
        if (n) b.append(el('b', null, String(n)));
        b.onclick = () => {
          state.libraryFilter = k;
          renderLibrary();
        };
        return b;
      }),
    );
    if (state.libraryFilter === 'history') {
      q('libraryToolbar').hidden = true;
      q('libraryGrid').classList.remove('grid');
      renderHistoryList(q('libraryGrid'));
      return;
    }
    q('libraryGrid').classList.add('grid');
    const items = libraryWorks(state.libraryFilter);
    const sort = q('librarySort')?.value || 'added';
    if (sort === 'title') items.sort((a, b) => titleOf(a).localeCompare(titleOf(b), 'ar'));
    else items.sort((a, b) => (libraryEntry(b.id)?.addedAt || 0) - (libraryEntry(a.id)?.addedAt || 0));
    const grid = q('libraryGrid');
    q('libraryToolbar').hidden = items.length < 2;
    q('libraryCount').textContent = countLabel(items.length, 'work');
    if (!items.length) {
      const copy = {
        all: ['مكتبتك فاضية', 'المس رمز المكتبة في صفحة أي عمل، ويظهر هنا على أجهزتك كلها.'],
        reading: ['ما تتابع شي الحين', 'الأعمال اللي تضيفها لمكتبتك تظهر هنا.'],
        later: ['القائمة فاضية', 'من قائمة الخيارات في صفحة العمل اختر «أقرأ لاحقًا».'],
        favorite: ['ما عندك مفضلة', 'القلب في صفحة العمل يضيفه هنا.'],
        completed: ['ما أكملت شي بعد', 'من قائمة ⋮ في صفحة العمل اختر «أكملته»، أو خلّص آخر فصل في عمل مكتمل.'],
      }[state.libraryFilter];
      emptyState(grid, {
        icon: { favorite: 'heart', later: 'clock' }[state.libraryFilter] ?? 'library',
        title: copy[0],
        text: copy[1],
        action: state.libraryFilter === 'all' ? { label: 'اكتشف أعمالًا', icon: 'compass', run: () => navTo('discover') } : undefined,
      });
      return;
    }
    renderGrid(grid, items);
  }

  // ───────────────────────── المجموعات والاستكشاف والبحث ─────────────────────────

  const COLLECTIONS = {
    trending: { title: 'الأكثر رواجًا', kind: 'popular' },
    recent: { title: 'آخر التحديثات', kind: 'latest' },
  };
  async function openCollection(kind) {
    if (kind === 'history') {
      state.libraryFilter = 'history';
      navTo('library');
      return;
    }
    if (kind === 'libraryReading') {
      state.libraryFilter = 'reading';
      navTo('library');
      return;
    }
    const c = COLLECTIONS[kind] || COLLECTIONS.trending;
    state.collection = { kind: c.kind, page: 0, hasNext: true, items: [], genre: null };
    q('collectionTitle').textContent = c.title;
    q('collectionGrid').replaceChildren(...skeletonCards(9));
    q('collectionMore').hidden = true;
    showPage('collection');
    await loadMoreCollection();
  }
  async function loadMoreCollection() {
    if (!state.collection.hasNext) return;
    const btn = q('collectionMore');
    btn.disabled = true;
    btn.textContent = 'جارٍ التحميل…';
    try {
      const r = state.collection.genre
        ? await browse({ genre: state.collection.genre.names, page: state.collection.page + 1 })
        : await browse({ kind: state.collection.kind, page: state.collection.page + 1 });
      state.collection.page = r.page;
      state.collection.hasNext = r.hasNextPage;
      state.collection.items = uniqueById([...state.collection.items, ...r.items]);
      if (!state.collection.items.length) {
        emptyState(q('collectionGrid'), {
          icon: 'search',
          title: 'ما فيه نتائج',
          text: state.collection.genre ? `ما لقينا مصدرًا فيه تصنيف «${state.collection.genre.ar}».` : 'المصادر ما رجّعت أعمالًا هنا.',
        });
      } else {
        renderGrid(q('collectionGrid'), state.collection.items);
      }
      btn.hidden = !state.collection.hasNext;
    } catch {
      if (!state.collection.items.length) {
        emptyState(q('collectionGrid'), {
          icon: 'offline',
          error: true,
          title: 'تعذّر التحميل',
          action: { label: 'أعد المحاولة', icon: 'refresh', run: () => void loadMoreCollection() },
        });
      } else toast('تعذّر تحميل المزيد');
    } finally {
      btn.disabled = false;
      btn.textContent = 'تحميل المزيد';
    }
  }
  /** أغلفة من أعمال التصنيف مما حمّلته الرئيسية: البلاطة تُري التصنيف لا تسمّيه فقط. */
  function genreCovers(g, used) {
    const pool = uniqueById([...(state.home.trending || []), ...(state.home.recent || [])]);
    const match = pool.filter((w) => w.coverImage?.large && (w.genres || []).some((x) => x === g.en || x === g.ar));
    // غلاف لم تأخذه بلاطة قبلها أولًا: لا تتشابه البلاطات
    const picked = [...match.filter((w) => !used.has(w.id)), ...match.filter((w) => used.has(w.id))].slice(0, 2);
    for (const w of picked) used.add(w.id);
    return picked;
  }
  function openCategories() {
    showPage('categories');
    const used = new Set();
    q('categoryGrid').replaceChildren(
      ...GENRES.map((g) => {
        const b = el('button', 'category');
        b.type = 'button';
        b.style.setProperty('--hue', String(g.hue));
        b.append(el('strong', null, g.ar));
        const art = el('span', 'category-art');
        for (const w of genreCovers(g, used)) {
          const img = el('img');
          img.alt = '';
          img.loading = 'lazy';
          img.decoding = 'async';
          img.onerror = () => img.remove();
          img.src = w.coverImage.large;
          art.append(img);
        }
        b.append(art);
        b.onclick = () => void openGenre(g);
        return b;
      }),
    );
  }
  async function openGenre(g) {
    // فلتر التصنيف في كل مصدر، لا البحث بالكلمة: «مغامرة» في العنوان ليست مغامرة
    state.collection = { kind: 'genre', page: 0, hasNext: true, items: [], genre: g };
    q('collectionTitle').textContent = g.ar;
    q('collectionGrid').replaceChildren(...skeletonCards(9));
    q('collectionMore').hidden = true;
    showPage('collection');
    await loadMoreCollection();
  }

  async function loadMoreDiscover() {
    const btn = q('discoverMore');
    if (!available()) {
      emptyState(q('discoverGrid'), { icon: 'layers', title: 'المصادر داخل تطبيق أندرويد', text: 'الاستكشاف يقرأ كتالوج مصادرنا كاملًا من محرّك التطبيق.' });
      btn.hidden = true;
      return;
    }
    if (!state.catalogHasNext) return;
    btn.disabled = true;
    btn.textContent = 'جارٍ التحميل…';
    if (!state.catalog.length) {
      btn.hidden = true;
      q('discoverGrid').replaceChildren(...skeletonCards(12));
    }
    try {
      const r = await browse({ kind: 'catalogue', page: state.catalogPage + 1 });
      state.catalogPage = r.page;
      state.catalogHasNext = r.hasNextPage;
      state.catalog = uniqueById([...state.catalog, ...r.items]);
      if (!state.discoverQuery) renderGrid(q('discoverGrid'), state.catalog);
      btn.hidden = !state.catalogHasNext || !!state.discoverQuery;
    } catch {
      if (!state.catalog.length) {
        emptyState(q('discoverGrid'), {
          icon: 'offline',
          error: true,
          title: 'تعذّر تحميل الكتالوج',
          action: { label: 'أعد المحاولة', icon: 'refresh', run: () => void loadMoreDiscover() },
        });
      } else toast('تعذّر تحميل المزيد');
    } finally {
      btn.disabled = false;
      btn.textContent = 'أعمال أكثر';
    }
  }
  /** البحث في الاستكشاف يسأل كل المصادر، لا ما حُمّل منها في الصفحة فقط. */
  function discoverSearch(term) {
    state.discoverQuery = term.trim();
    root.querySelector('#discover .search-clear').hidden = !state.discoverQuery;
    clearTimeout(state.searchTimer);
    if (!state.discoverQuery) {
      renderGrid(q('discoverGrid'), state.catalog);
      q('discoverMore').hidden = !state.catalogHasNext;
      return;
    }
    q('discoverMore').hidden = true;
    const term0 = state.discoverQuery;
    state.searchTimer = setTimeout(() => void runSearch(term0, q('discoverGrid'), () => state.discoverQuery), 380);
  }
  function clearDiscoverSearch() {
    q('discoverSearch').value = '';
    discoverSearch('');
    q('discoverSearch').focus();
  }
  async function runSearch(term, grid, stillWanted) {
    grid.replaceChildren(...skeletonCards(6));
    try {
      const { items } = await browse({ query: term });
      if (stillWanted() !== term) return 0;
      if (items.length) renderGrid(grid, items);
      else emptyState(grid, { icon: 'search', title: 'لا نتائج', text: 'جرّب اسمًا آخر، أو الاسم بالإنجليزي.' });
      return items.length;
    } catch {
      if (stillWanted() !== term) return 0;
      emptyState(grid, {
        icon: 'offline',
        error: true,
        title: 'تعذّر البحث الآن',
        action: { label: 'أعد المحاولة', icon: 'refresh', run: () => void runSearch(term, grid, stillWanted) },
      });
    }
  }
  // البحث قبل أن تكتب ليس صفحة فارغة: آخر ما بحثت عنه، والتصنيفات، والرائج
  const SEARCHES_KEY = 'vantara.v35.searches';
  const recentSearches = () => readJson(SEARCHES_KEY, []).filter((x) => typeof x === 'string').slice(0, 8);
  function rememberSearch(term) {
    const t = term.trim();
    if (t.length < 2) return;
    writeJson(SEARCHES_KEY, [t, ...recentSearches().filter((x) => x.toLowerCase() !== t.toLowerCase())].slice(0, 8));
  }
  function searchFor(term) {
    q('searchInput').value = term;
    debouncedSearch(term, { now: true });
  }
  function renderSearchIdle() {
    const host = q('searchIdle');
    host.replaceChildren();
    const recent = recentSearches();
    if (recent.length) {
      const head = el('div', 'search-head');
      head.append(el('h2', null, 'آخر ما بحثت عنه'));
      const clear = el('button', 'text-btn', 'امسح');
      clear.type = 'button';
      clear.onclick = () => {
        writeJson(SEARCHES_KEY, []);
        renderSearchIdle();
      };
      head.append(clear);
      const row = el('div', 'search-recent');
      for (const t of recent) {
        const b = el('button', 'search-chip');
        b.type = 'button';
        b.innerHTML = glyph('history', { size: 16 });
        const label = el('bdi', null, t);
        b.append(label);
        b.onclick = () => searchFor(t);
        row.append(b);
      }
      host.append(head, row);
    }
    const genresHead = el('div', 'search-head');
    genresHead.append(el('h2', null, 'تصفّح بالتصنيف'));
    const all = el('button', 'text-btn', 'الكل');
    all.type = 'button';
    all.onclick = () => openCategories();
    genresHead.append(all);
    const genres = el('div', 'search-genres');
    for (const g of GENRES.slice(0, 10)) {
      const b = el('button', 'search-genre', g.ar);
      b.type = 'button';
      b.style.setProperty('--hue', String(g.hue));
      b.onclick = () => void openGenre(g);
      genres.append(b);
    }
    host.append(genresHead, genres);
    const trending = (state.home.trending || []).slice(0, 6);
    if (trending.length) {
      const head = el('div', 'search-head');
      head.append(el('h2', null, 'الرائج الآن'));
      const list = el('div', 'search-trend');
      trending.forEach((w, i) => {
        const b = el('button', 'search-trend-row');
        b.type = 'button';
        const cover = el('span', 'search-trend-cover');
        void mountImage(cover, w);
        const copy = el('span', 'search-trend-copy');
        copy.append(el('bdi', 'search-trend-title', titleOf(w)));
        const meta = (w.genres || []).slice(0, 2).map(genreAr).join(' · ');
        if (meta) copy.append(el('span', 'search-trend-meta', meta));
        b.append(el('span', 'search-trend-rank', String(i + 1)), cover, copy);
        b.onclick = () => void openWork(w);
        list.append(b);
      });
      host.append(head, list);
    }
  }
  function showSearchIdle(idle) {
    q('searchIdle').hidden = !idle;
    q('searchGrid').hidden = idle;
    if (idle) {
      q('searchCount').hidden = true;
      renderSearchIdle();
    }
  }
  function openSearch() {
    showPage('search');
    if (!q('searchInput').value.trim()) showSearchIdle(true);
    setTimeout(() => q('searchInput')?.focus(), 60);
  }
  function clearSearch() {
    q('searchInput').value = '';
    debouncedSearch('');
    q('searchInput').focus();
  }
  let searchTerm = '';
  function debouncedSearch(term, { now = false } = {}) {
    searchTerm = term.trim();
    root.querySelector('#search .search-clear').hidden = !searchTerm;
    clearTimeout(state.searchTimer);
    if (!searchTerm) return showSearchIdle(true);
    state.searchTimer = setTimeout(
      async () => {
        const t = searchTerm;
        showSearchIdle(false);
        q('searchCount').hidden = true;
        const found = await runSearch(t, q('searchGrid'), () => searchTerm);
        if (searchTerm !== t) return;
        if (found) {
          rememberSearch(t);
          // الكلمة معزولة بـbdi: بحثٌ إنجليزي لا يقلب ترتيب السطر العربي
          q('searchCount').replaceChildren(document.createTextNode(`${countLabel(found, 'work')} لـ `), el('bdi', null, t));
          q('searchCount').hidden = false;
        }
      },
      now ? 0 : 330,
    );
  }

  // ───────────────────────── الإشعارات ─────────────────────────
  // سطرٌ واحد لكل إشعار: وجه المرسل، «مشعل أرسل لك فريم»، ومتى. والغلاف في
  // الطرف الآخر يقول عن أي عمل بلا كلام زائد.

  const nameOf = (userId) =>
    sync.rows('profiles', (p) => p.user_id === userId)[0]?.display_name ||
    sync.rows('accounts', (a) => a.user_id === userId)[0]?.username ||
    'صديق';
  const personOf = (userId) => ({
    userId,
    displayName: nameOf(userId),
    avatarKey: sync.rows('profiles', (p) => p.user_id === userId)[0]?.avatar_key ?? null,
  });
  const KIND_ICON = { FRAME: 'camera', RECOMMENDATION: 'spark', COMMENT_REPLY: 'edit', REACTION: 'heart', FRIEND_ACTIVITY: 'activity', SYSTEM: 'info' };

  function notificationCopy(row) {
    const frameId = frameIdFromLink(row.link);
    const frame = frameId ? sync.rows('frames', (f) => f.id === frameId)[0] : null;
    const work = row.series_ref ? sync.rows('works', (x) => x.series_ref === row.series_ref)[0] : null;
    switch (row.kind) {
      case 'FRAME':
        return {
          text: frame?.broadcast ? 'شارك فريمًا مع الجميع' : 'أرسل لك فريم',
          cover: frame?.cover_url ?? null,
          open: () => void deps.go({ name: 'frame', id: frameId }),
        };
      case 'RECOMMENDATION':
        return {
          text: 'رشّح لك',
          title: work?.title ?? row.body ?? null,
          cover: work?.cover_url ?? null,
          open: () => {
            majlis.markSeen('rec', String(row.id).split(':')[0]);
            if (row.series_ref) void openWork(workFromRef(row.series_ref, work?.title ?? row.body, work?.cover_url));
          },
        };
      case 'REACTION':
        if (String(row.link ?? '').startsWith('vantara://majlis/')) {
          const kind = row.link.split('/')[3];
          const noun = { frame: 'فريمك', rec: 'ترشيحك', activity: 'نشاطك' }[kind] ?? 'رسالتك';
          return { text: `تفاعل ${row.body ?? ''} مع ${noun}`, cover: null, open: () => showPage('majlis') };
        }
        return { text: 'تفاعل مع تعليقك', cover: work?.cover_url ?? null };
      case 'COMMENT_REPLY':
        return { text: 'ردّ على تعليقك', cover: work?.cover_url ?? null };
      case 'FRIEND_ACTIVITY':
        return { text: row.body || 'عنده جديد', cover: work?.cover_url ?? null };
      default:
        return { text: row.body || 'تنبيه', cover: null, system: true };
    }
  }
  function timeAgo(ms) {
    const minutes = Math.max(0, Math.floor((Date.now() - ms) / 60_000));
    if (minutes < 1) return 'الآن';
    if (minutes < 60) return minutes === 1 ? 'قبل دقيقة' : minutes === 2 ? 'قبل دقيقتين' : `قبل ${minutes} ${minutes <= 10 ? 'دقائق' : 'دقيقة'}`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return hours === 1 ? 'قبل ساعة' : hours === 2 ? 'قبل ساعتين' : `قبل ${hours} ${hours <= 10 ? 'ساعات' : 'ساعة'}`;
    const days = Math.floor(hours / 24);
    if (days === 1) return 'أمس';
    if (days < 7) return days === 2 ? 'قبل يومين' : `قبل ${days} أيام`;
    return new Date(ms).toLocaleDateString('ar', { day: 'numeric', month: 'long', numberingSystem: 'latn' });
  }
  function notificationRow(row) {
    const copy = notificationCopy(row);
    // جديدُ هذه الزيارة يبقى مميّزًا حتى تغادر، ولو صار مقروءًا في الخادم
    if (!row.read) (state.notifFresh ??= new Set()).add(row.id);
    const fresh = !row.read || state.notifFresh?.has(row.id);
    const b = el('button', `notif${fresh ? ' notif--unread' : ''}`);
    b.type = 'button';
    const face = el('span', 'notif-face');
    face.append(copy.system ? everyoneFace(44) : avatarNode(personOf(row.actor_id), 44));
    const badge = el('span', `notif-kind notif-kind--${(row.kind || '').toLowerCase()}`);
    badge.innerHTML = glyph(KIND_ICON[row.kind] ?? 'bell', { size: 12 });
    face.append(badge);
    const text = el('span', 'notif-text');
    const line = el('span', 'notif-line');
    // الاسم والعنوان معزولان: عنوان لاتيني لا يبتلع ما بعده في سطر عربي
    if (!copy.system) line.append(el('bdi', 'notif-name', nameOf(row.actor_id)), document.createTextNode(' '));
    line.append(document.createTextNode(copy.text));
    if (copy.title) line.append(document.createTextNode(' '), el('bdi', 'notif-title', copy.title));
    text.append(line, el('time', null, timeAgo(row.created_at ?? Date.now())));
    b.append(face, text);
    if (copy.cover) {
      const c = el('span', 'notif-cover');
      const img = el('img');
      img.src = copy.cover;
      img.alt = '';
      img.onerror = () => c.remove();
      c.append(img);
      b.append(c);
    }
    b.onclick = () => {
      if (!row.read) sync.enqueue('notification.read', { id: row.id });
      copy.open?.();
    };
    return b;
  }
  const notificationsVisible = () => currentPage() === 'notifications' || (currentPage() === 'majlis' && state.socialTab === 'notifications');
  function renderNotifications() {
    const inHub = currentPage() === 'majlis';
    const body = inHub ? q('socialNotifs') : q('notificationsBody');
    const rows = sync
      .rows('notifications', (r) => r.user_id === me())
      .sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0));
    root.querySelector('[data-act="readAllNotifications"]').hidden = !rows.some((r) => !r.read);
    if (!rows.length) {
      emptyState(body, { icon: 'bell', title: 'ما فيه إشعارات', text: 'لما يرسل لك صديق فريمًا أو يرشّح لك عملًا، يوصلك هنا.' });
      return;
    }
    const startOfDay = new Date().setHours(0, 0, 0, 0);
    const groups = [
      ['اليوم', (t) => t >= startOfDay],
      ['هذا الأسبوع', (t) => t < startOfDay && t >= startOfDay - 6 * 86_400_000],
      ['أقدم', (t) => t < startOfDay - 6 * 86_400_000],
    ];
    const parts = [];
    for (const [label, test] of groups) {
      const inGroup = rows.filter((r) => test(r.created_at ?? 0));
      if (!inGroup.length) continue;
      parts.push(el('div', 'settings-group-label', label));
      const list = el('div', 'notif-list');
      list.append(...inGroup.map(notificationRow));
      parts.push(list);
    }
    body.replaceChildren(...parts);
    // رأيتها في القائمة = قرأتها: النقطة تختفي الآن وعلى كل أجهزتك، والجديد
    // يبقى مميّزًا في هذه الزيارة وحدها لتعرف ما وصل
    clearTimeout(state.notifReadTimer);
    state.notifReadTimer = setTimeout(() => {
      if (!notificationsVisible()) return;
      for (const r of rows) if (!r.read) sync.enqueue('notification.read', { id: r.id });
    }, 900);
  }
  function readAllNotifications() {
    for (const r of sync.rows('notifications', (x) => x.user_id === me() && !x.read)) sync.enqueue('notification.read', { id: r.id });
    toast('علّمتها كلها مقروءة');
    setTimeout(renderNotifications, 400);
  }

  // ───────────────────────── الدرج والتنقّل ─────────────────────────

  const unreadNotifications = () => sync.rows('notifications', (r) => r.user_id === me() && !r.read).length;
  function buildDrawer() {
    const profile = sync.rows('profiles', (p) => p.user_id === me())[0];
    const who = q('drawerMe');
    const name = profile?.display_name || sync.user?.displayName || sync.user?.username || 'حسابي';
    const texts = el('div');
    texts.append(el('strong', null, name), el('small', null, 'ملفّك الشخصي'));
    who.replaceChildren(avatarNode({ avatarKey: profile?.avatar_key, displayName: name }), texts);
    who.insertAdjacentHTML('beforeend', glyph('chevron'));
    who.setAttribute('aria-label', `ملفّك: ${name}`);
    q('drawerVersion').textContent = deps.version ? `VANTARA ${deps.version}` : 'VANTARA';

    const unread = unreadNotifications();
    const here = currentPage();
    q('drawerContent').replaceChildren(
      ...drawerGroups.map(([label, items]) => {
        const g = el('div', 'drawer-group');
        if (label) g.append(el('div', 'drawer-label', label));
        for (const [text, key, ic] of items) {
          const b = el('button', 'drawer-item');
          b.type = 'button';
          b.innerHTML = glyph(ic);
          b.append(el('span', null, text));
          if (key === 'notifications' && unread) b.append(el('span', 'badge', unread > 99 ? '99+' : String(unread)));
          if (key === here) {
            b.classList.add('active');
            b.setAttribute('aria-current', 'page');
          }
          b.onclick = () => drawerNavigate(key);
          g.append(b);
        }
        return g;
      }),
    );
  }
  function openDrawer() {
    buildDrawer();
    q('drawerBackdrop').classList.add('open');
  }
  function closeDrawer() {
    if (!q('drawerBackdrop').classList.contains('open')) return false;
    q('drawerBackdrop').classList.remove('open');
    return true;
  }
  function drawerNavigate(key) {
    closeDrawer();
    if (['home', 'library', 'discover', 'settings', 'majlis'].includes(key)) return navTo(key);
    if (key === 'favorites' || key === 'later' || key === 'history') {
      state.libraryFilter = key === 'favorites' ? 'favorite' : key;
      return navTo('library');
    }
    if (key === 'switchAccount') return confirmSwitchAccount();
    if (key === 'notifications') return openSocial('notifications');
    if (key === 'majlisFeed') return openSocial('majlis');
    if (key === 'profile') return openProfile(me());
    // التوصيات والنشاط صارا في المجلس نفسه: لا شاشة قديمة موازية
    if (key === 'recommendations') return openSocial('recs');
    if (key === 'friends') return openSocial('friends');
    if (key === 'activity') return openSocial('majlis');
  }
  function confirmSwitchAccount() {
    openSheet((body) => {
      body.append(el('h3', null, 'تبديل الحساب؟'));
      body.append(el('p', null, 'ترجع لشاشة «من يتابع؟». قراءتك محفوظة في حسابك.'));
      const row = el('div', 'sheet-actions');
      const cancel = el('button', 'btn btn-secondary', 'إلغاء');
      cancel.type = 'button';
      cancel.onclick = () => closeSheet();
      const ok = el('button', 'btn btn-primary', 'بدّل');
      ok.type = 'button';
      ok.onclick = () => {
        closeSheet();
        deps.switchAccount();
      };
      row.append(cancel, ok);
      body.append(row);
    });
  }

  const MAIN_PAGES = ['home', 'library', 'discover', 'majlis'];
  const currentPage = () => root.querySelector('.page.active')?.id ?? 'home';
  function showPage(id, { push = true } = {}) {
    // الإشعارات صارت قسمًا في «الاجتماع»
    if (id === 'notifications') {
      state.socialTab = 'notifications';
      id = 'majlis';
    }
    const from = currentPage();
    // خرجت من صفحة العمل: ينتهي تفعيل «عند الطلب» له (الفصل ليس صفحة هنا؛ الرجوع منه يبقيك فيها)
    if (from === 'detail' && id !== 'detail' && state.current) endWorkSession(String(state.current.id));
    if (MAIN_PAGES.includes(id)) state.stack = [];
    else if (push && from !== id) state.stack.push(from);
    root.querySelectorAll('.page').forEach((p) => p.classList.toggle('active', p.id === id));
    q('bottomNav').hidden = !MAIN_PAGES.includes(id);
    root.querySelectorAll('.nav').forEach((n) => {
      const on = n.dataset.page === id;
      n.classList.toggle('active', on);
      if (on) n.setAttribute('aria-current', 'page');
      else n.removeAttribute('aria-current');
    });
    q('detailTop').classList.remove('scrolled');
    if (id === 'library') renderLibrary();
    if (id === 'discover' && !state.catalog.length) void loadMoreDiscover();
    if (id === 'settings') {
      usageAsked = false; // الصرف يُقرأ من جديد كل مرة تفتح الإعدادات
      renderSettings();
    }

    if (id !== 'majlis' || state.socialTab !== 'notifications') state.notifFresh = null;
    if (id === 'majlis') {
      renderSocial();
      // وصلتَ للمجلس = رأيت التفاعلات على رسائلك فيه
      for (const n of sync.rows('notifications', (x) => x.user_id === me() && !x.read && x.kind === 'REACTION' && String(x.link ?? '').startsWith('vantara://majlis/'))) {
        sync.enqueue('notification.read', { id: n.id });
      }
    } else majlis.hide();
    if (id !== 'profile') profile?.hide();
    window.scrollTo({ top: 0, behavior: 'instant' });
  }
  function navTo(id) {
    if (id === 'notifications') return openSocial('notifications');
    if (id === 'friends') return openSocial('friends');
    showPage(id);
  }
  function openMajlis(only) {
    openSocial(only === 'recs' ? 'recs' : 'majlis');
  }

  // ───────────────────────── الاجتماع ─────────────────────────
  // أربعة أقسام تحت سقف واحد: الأصدقاء أولًا (من هنا ومن يقرأ ماذا)، ثم
  // المجلس، ثم الإشعارات، ثم التوصيات.

  const SOCIAL_TABS = [
    ['friends', 'الأصدقاء'],
    ['majlis', 'المجلس'],
    ['notifications', 'الإشعارات'],
    ['recs', 'التوصيات'],
  ];
  function openSocial(tab = state.socialTab ?? 'friends') {
    state.socialTab = tab;
    if (currentPage() !== 'majlis') showPage('majlis');
    else renderSocial();
  }
  function renderSocial() {
    const tab = (state.socialTab ??= 'friends');
    const unread = unreadNotifications();
    q('socialTabs').replaceChildren(
      ...SOCIAL_TABS.map(([k, label]) => {
        const b = el('button', `social-tab${k === tab ? ' active' : ''}`, label);
        b.type = 'button';
        b.setAttribute('role', 'tab');
        b.setAttribute('aria-selected', String(k === tab));
        if (k === 'notifications' && unread) b.append(el('span', 'social-tab-dot'));
        b.onclick = () => {
          if (state.socialTab === k) return;
          state.socialTab = k;
          renderSocial();
          window.scrollTo({ top: 0, behavior: 'instant' });
        };
        return b;
      }),
    );
    q('friendsBody').hidden = tab !== 'friends';
    q('majlisBody').hidden = tab !== 'majlis' && tab !== 'recs';
    q('socialNotifs').hidden = tab !== 'notifications';
    if (tab === 'friends') {
      majlis.hide();
      renderFriends();
      void refreshFriendsPresence();
    } else if (tab === 'notifications') {
      majlis.hide();
      renderNotifications();
    } else {
      majlis.show(tab === 'recs' ? 'recs' : 'all');
    }
    if (tab !== 'friends') clearInterval(state.friendsTimer);
  }

  // ── الأصدقاء: وجه، اسم، وما يفعله الآن ──
  let friendsPresence = [];
  async function refreshFriendsPresence() {
    clearInterval(state.friendsTimer);
    state.friendsTimer = setInterval(() => {
      if (currentPage() === 'majlis' && state.socialTab === 'friends' && !document.hidden) void refreshFriendsPresence();
    }, 15_000);
    try {
      friendsPresence = (await deps.presence?.()) ?? [];
    } catch {
      return;
    }
    if (currentPage() === 'majlis' && state.socialTab === 'friends') renderFriends();
  }
  function lastSeenLine(at) {
    if (!at) return 'غير متصل';
    const minutes = Math.floor((Date.now() - at) / 60_000);
    if (minutes < 2) return 'كان هنا قبل شوي';
    return `آخر ظهور ${timeAgo(at)}`;
  }
  function renderFriends() {
    const body = q('friendsBody');
    const ids = sync
      .rows('accounts', () => true)
      .map((a) => a.user_id)
      .filter((id) => id !== me());
    if (!ids.length) {
      emptyState(body, { icon: 'users', title: 'ما فيه أصدقاء بعد', text: 'أصدقاؤك يظهرون هنا أول ما يوصلون.' });
      return;
    }
    const pOf = (id) => friendsPresence.find((p) => p.userId === id) ?? null;
    const rank = (id) => ({ READING: 0, ONLINE: 1, IDLE: 2 })[pOf(id)?.status] ?? 3;
    ids.sort((a, b) => rank(a) - rank(b) || nameOf(a).localeCompare(nameOf(b), 'ar'));
    const list = el('div', 'pal-list');
    for (const id of ids) {
      const p = pOf(id);
      const status = p?.status ?? 'OFFLINE';
      const row = el('div', `pal-row pal-row--${status.toLowerCase()}`);
      const face = el('button', 'pal-face');
      face.type = 'button';
      face.setAttribute('aria-label', `ملف ${nameOf(id)}`);
      face.append(avatarNode(personOf(id), 56));
      if (status !== 'OFFLINE') face.append(el('span', 'pal-dot'));
      face.onclick = () => openProfile(id);
      const copy = el('div', 'pal-copy');
      const name = el('button', 'pal-name', nameOf(id));
      name.type = 'button';
      name.onclick = () => openProfile(id);
      copy.append(name);
      const line = el('div', 'pal-line');
      if (status === 'READING' && p?.seriesTitle) {
        line.append(el('span', null, 'يقرأ الآن: '));
        const work = workFromRef(p.seriesRef ?? `ext:${p.seriesTitle}`, p.seriesTitle);
        const title = el('button', 'pal-work');
        title.type = 'button';
        title.append(el('bdi', null, titleOf(work)));
        title.onclick = () => void openWork(work);
        line.append(title);
        if (p.chapterLabel) line.append(el('span', 'pal-chapter', ` · ${p.chapterLabel}`));
      } else if (status === 'ONLINE' || status === 'IDLE') {
        line.append(el('span', status === 'IDLE' ? 'pal-idle' : 'pal-on', status === 'IDLE' ? 'خامل' : 'متصل الآن'));
      } else {
        line.append(el('span', null, lastSeenLine(p?.lastSeenAt)));
      }
      copy.append(line);
      const go = el('button', 'icon-btn pal-go');
      go.type = 'button';
      go.setAttribute('aria-label', `ملف ${nameOf(id)}`);
      go.innerHTML = glyph('chevron');
      go.onclick = () => openProfile(id);
      row.append(face, copy, go);
      list.append(row);
    }
    body.replaceChildren(list);
  }
  /** رجوع داخل الواجهة. يرجع `false` إن لم يبقَ شيء يُرجَع إليه. */
  function goBack() {
    const prev = state.stack.pop();
    if (prev) {
      showPage(prev, { push: false });
      if (prev === 'detail' && state.current?._chapters) renderChapters(state.current);
      return true;
    }
    if (currentPage() !== 'home') {
      showPage('home');
      return true;
    }
    return false;
  }

  // الإعدادات لكل واحد من العيال: ما يفهمه أي أحد فوق، والتقني تحت «النظام»
  // مطويًّا، وما قد يفصل التطبيق عن الخادم في «منطقة الخطر» بتأكيد صريح.
  // الشاشة القديمة تبقى لحالة واحدة: لا حساب بعد (أول إقلاع)، ولا واجهة أصلًا.
  let systemOpen = false;
  let apkVersion = null;
  let apkVersionAsked = false;
  /**
   * إعدادات > الترجمة.
   *
   *   - تشغيل/إيقاف: مغلقة افتراضيًا. مغلقة = لا زرّ ترجمة في أي مكان.
   *   - تلقائي / عند الطلب.
   *   - ملفات الترجمة على الجوال: تحميل (بالحجم) / حذف / تحديث إن نزل إصدار أحدث.
   *   - ملاحظة: الصفحات المترجمة تُحفظ عندك، فلا تُعاد ترجمتها.
   */
  let modelsInfo = null;
  let modelsBusy = null; // { received, total } أثناء التحميل
  let translateUsage = null;
  let usageAsked = false;
  function renderTranslationSettings(group, row, toggle) {
    const s = readTranslateSettings();
    const rows = [
      toggle('translateAr', 'الترجمة العربية', 'تترجم فصول التكملة الإنجليزية إلى العربية', s.enabled, (enabled) => {
        writeTranslateSettings({ enabled });
        renderSettings();
      }),
    ];
    if (s.enabled) {
      const modeRow = el('div', 'setting');
      modeRow.innerHTML = glyph('sliders');
      const t = el('div');
      t.append(el('strong', null, 'متى تُترجم'));
      t.append(el('small', null, s.mode === 'auto' ? 'تلقائيًا حين تفتح فصلًا إنجليزيًا' : 'حين تضغط «ترجم» في القارئ، وتستمر حتى تخرج من العمل'));
      const seg = el('div', 'segmented');
      for (const [value, label] of [['auto', 'تلقائي'], ['manual', 'عند الطلب']]) {
        const b = el('button', null, label);
        b.type = 'button';
        b.setAttribute('aria-pressed', String(s.mode === value));
        b.onclick = () => {
          writeTranslateSettings({ mode: value });
          renderSettings();
        };
        seg.append(b);
      }
      modeRow.append(t, seg);
      rows.push(modeRow);

      const speedRow = el('div', 'setting');
      speedRow.innerHTML = glyph('spark');
      const st = el('div');
      st.append(el('strong', null, 'نوع الترجمة'));
      st.append(el('small', null, s.speed === 'fast' ? 'سريعة: أسرع، وأحيانًا تغلط أو تخلط مين يتكلم' : 'ذكية: الأدق، تاخذ ثواني أكثر لكل صفحة'));
      const speedSeg = el('div', 'segmented');
      for (const [value, label] of [['smart', 'ذكية'], ['fast', 'سريعة']]) {
        const b = el('button', null, label);
        b.type = 'button';
        b.setAttribute('aria-pressed', String(s.speed === value));
        b.onclick = () => {
          writeTranslateSettings({ speed: value });
          renderSettings();
        };
        speedSeg.append(b);
      }
      speedRow.append(st, speedSeg);
      rows.push(speedRow);
    }
    if (s.enabled) {
      // الصرف الفعلي (من توكنات كل ردّ) وحصتك هذا الأسبوع: للمراقبة
      if (!usageAsked) {
        usageAsked = true;
        void sync
          .translation('/v1/translate/usage')
          .then((res) => {
            if (res.status !== 200) return;
            translateUsage = res.body;
            if (currentPage() === 'settings') renderSettings();
          })
          .catch(() => {});
      }
      if (translateUsage?.budgetUsd) {
        const sar = (usd) => (usd * 3.75).toFixed(usd * 3.75 < 10 ? 1 : 0);
        rows.push(
          row('activity', 'صرف الترجمة هالشهر', `للتطبيق كله من السقف ${sar(translateUsage.budgetUsd)} ريال. حصتك هالأسبوع: ${translateUsage.used} صفحة و${translateUsage.chapters ?? 0} فصل`, {
            value: `${sar(translateUsage.spentUsd ?? 0)} ريال`,
            tone: (translateUsage.spentUsd ?? 0) >= translateUsage.budgetUsd * 0.8 ? 'warn' : undefined,
          }),
        );
      }
      const perf = summarize(readPerf());
      rows.push(
        row('activity', 'أداء الترجمة', 'زمن كل مرحلة على جوالك، لكل صفحة وفصل، وقياس القديم مقابل الجديد', {
          value: perf.text.median ? `${(perf.text.median / 1000).toFixed(1)} ث/صفحة` : null,
          run: openPerfSheet,
        }),
      );
      const all = translationJobs.jobs();
      const runningCount = all.filter((j) => j.status === 'running').length;
      rows.push(
        row('download', 'قائمة الترجمة', 'الفصول اللي تُترجم مقدمًا: إيقاف، استئناف، إلغاء', {
          value: runningCount ? `${runningCount} شغّالة` : all.length ? String(all.length) : null,
          tone: runningCount ? 'ok' : undefined,
          run: openJobsSheet,
        }),
      );
    }
    const note = s.enabled ? 'الصفحات المترجمة تُحفظ عندك: ما تُرجم مرة ما يُعاد تحميله ولا ترجمته. زر «ترجم» في القارئ يسألك ذكية أو سريعة، وهذا الاختيار يكون محددًا مسبقًا. تجهيز فصول مقدمًا من زر الترجمة في صفحة العمل.' : null;
    group('الترجمة', rows, { note });

    if (!s.enabled) return;
    if (!nativeTranslationAvailable()) {
      group('', [row('info', 'ملفات الترجمة', 'الترجمة على الجهاز متاحة في تطبيق أندرويد', {})]);
      return;
    }
    if (!modelsInfo) {
      void modelsStatus().then((info) => {
        modelsInfo = info;
        if (currentPage() === 'settings') renderSettings();
      });
      group('', [row('download', 'ملفات الترجمة', 'جارٍ فحص الملفات…', {})]);
      return;
    }
    const m = modelsInfo;
    const list = [];
    if (modelsBusy) {
      list.push(row('download', 'جارٍ تحميل ملفات الترجمة', `${formatBytes(modelsBusy.received)} من ${formatBytes(modelsBusy.total)}`, {}));
    } else if (!m.installed) {
      list.push(
        row('download', 'تحميل ملفات الترجمة', `مرة واحدة، ${formatBytes(m.expectedBytes)}. بعدها الترجمة تشتغل على الجهاز بلا خادم.`, {
          run: () => void runModelsDownload(),
        }),
      );
    } else {
      list.push(row('check', 'ملفات الترجمة منزّلة', `الإصدار ${m.version ?? '—'}`, { value: formatBytes(m.bytes) }));
      if (m.latestVersion && m.latestVersion !== m.version) {
        list.push(row('refresh', 'تحديث ملفات الترجمة', `نزل إصدار أحدث (${m.latestVersion})`, { run: () => void runModelsDownload() }));
      }
      list.push(
        row('trash', 'حذف ملفات الترجمة', `يحرّر ${formatBytes(m.bytes)}؛ الصفحات المترجمة المحفوظة تبقى`, {
          danger: true,
          run: async () => {
            await removeModels().catch(() => {});
            modelsInfo = null;
            renderSettings();
          },
        }),
      );
    }
    group('ملفات الترجمة على الجوال', list);
  }
  async function runModelsDownload() {
    if (modelsBusy) return;
    modelsBusy = { received: 0, total: modelsInfo?.expectedBytes ?? 0 };
    renderSettings();
    try {
      await downloadModels(({ received, total }) => {
        modelsBusy = { received, total };
        const sub = q('settingsBody')?.querySelector('.setting small');
        if (sub && currentPage() === 'settings') renderSettings();
      });
      toast('ملفات الترجمة جاهزة');
    } catch {
      toast('ما اكتمل التحميل — جرّب مرة ثانية');
    } finally {
      modelsBusy = null;
      modelsInfo = null;
      if (currentPage() === 'settings') renderSettings();
    }
  }

  let pendingPhones = 0;
  let pendingAsked = false;
  /** جوال معتمد يعتمد جوالًا جديدًا برمزه: بديل سير «اعتماد جوال» في GitHub. */
  function openApprovePhone() {
    openSheet((body) => {
      body.append(el('h3', null, 'اعتماد جوال جديد'));
      const hint = el('p', null, 'الجوال الجديد يعرض رمز من ٨ أحرف. اكتبه هنا وبيدخل على طول.');
      hint.style.marginBottom = '8px';
      const f = el('label', 'field');
      f.append(el('span', 'field-label', 'الرمز'));
      const input = el('input', 'field-input');
      input.dir = 'ltr';
      input.autocapitalize = 'characters';
      input.autocomplete = 'off';
      input.spellcheck = false;
      input.maxLength = 9;
      input.placeholder = 'K7Q4-M2XD';
      f.append(input);
      const go = el('button', 'btn btn-block btn-primary', 'اعتمد');
      go.type = 'button';
      go.onclick = async () => {
        const code = input.value.trim();
        if (code.replace(/[^a-z0-9]/gi, '').length !== 8) {
          toast('الرمز ٨ أحرف، مثل K7Q4-M2XD');
          return;
        }
        go.disabled = true;
        try {
          const res = await sync.approveDevice(code);
          if (res?.approved) {
            closeSheet();
            pendingPhones = Math.max(0, pendingPhones - 1);
            toast('اعتمدته ✓ الجوال الجديد يدخل خلال ثوانٍ');
            renderSettings();
          } else {
            toast('ما لقينا طلب بهالرمز: تأكد من الكتابة، أو اطلب رمز جديد (الرمز يعيش ٣٠ دقيقة)');
          }
        } catch {
          toast('تعذّر الاتصال. تأكد من النت وجرّب مرة ثانية');
        } finally {
          go.disabled = false;
        }
      };
      body.append(hint, f, go);
      requestAnimationFrame(() => input.focus());
    });
  }
  function renderSettings() {
    const body = q('settingsBody');
    body.replaceChildren();
    const api = deps.settings;
    const group = (label, rows, { note, cls } = {}) => {
      if (label) body.append(el('div', `settings-group-label${cls ? ` ${cls}-label` : ''}`, label));
      const list = el('div', `settings-list${cls ? ` ${cls}` : ''}`);
      list.append(...rows.filter(Boolean));
      body.append(list);
      if (note) body.append(el('p', 'settings-note', note));
      return list;
    };
    if (!apkVersionAsked && api?.apkVersion) {
      apkVersionAsked = true;
      api
        .apkVersion()
        .then((version) => {
          apkVersion = version;
          if (version && version !== deps.version) renderSettings();
        })
        .catch(() => {});
    }
    const row = (icon, title, sub, { value, run, tone, danger } = {}) => {
      const d = el(run ? 'button' : 'div', `setting${danger ? ' setting--danger' : ''}`);
      if (run) {
        d.type = 'button';
        d.onclick = run;
      }
      d.innerHTML = glyph(icon);
      const t = el('div');
      t.append(el('strong', null, title));
      if (sub) t.append(el('small', null, sub));
      d.append(t);
      if (value) {
        const v = el('span', `value${tone ? ` value--${tone}` : ''}`, value);
        v.dir = 'auto';
        d.append(v);
      }
      if (run) d.insertAdjacentHTML('beforeend', glyph('chevron', { cls: 'icon chev' }));
      return d;
    };
    const toggle = (icon, title, sub, checked, onChange) => {
      const d = el('label', 'setting');
      d.innerHTML = glyph(icon);
      const t = el('div');
      t.append(el('strong', null, title));
      if (sub) t.append(el('small', null, sub));
      const input = el('input');
      input.type = 'checkbox';
      input.className = 'switch-input';
      input.setAttribute('role', 'switch');
      input.checked = checked;
      input.onchange = () => onChange(input.checked);
      d.append(t, input);
      return d;
    };

    group('حسابك', [
      row('user', 'ملفّك الشخصي', 'اسمك وصورتك والبانر', { run: () => openProfile(me()) }),
      row('switchUser', 'تبديل الحساب', null, { value: sync.user?.username ? `@${sync.user.username}` : null, run: confirmSwitchAccount }),
      sync.approveDevice
        ? row('shield', 'اعتماد جوال جديد', 'اكتب الرمز اللي يطلع على الجوال الجديد', {
            value: pendingPhones ? `${pendingPhones} ينتظر` : null,
            tone: pendingPhones ? 'warn' : undefined,
            run: openApprovePhone,
          })
        : null,
    ]);
    if (sync.pendingDevices && !pendingAsked) {
      pendingAsked = true;
      sync.pendingDevices().then((n) => {
        if (n !== pendingPhones) {
          pendingPhones = n;
          if (q('settingsBody')?.isConnected) renderSettings();
        }
      });
    }

    if (api) {
      const popups = api.popups();
      const on = Object.keys(api.labels).filter((k) => popups.kinds[k] !== false).length;
      group(
        'التنبيهات',
        [
          toggle('bell', 'التنبيهات المنبثقة', 'تطلع فوق الشاشة لما يرسل لك أحد فريم أو ترشيح', popups.enabled, (enabled) => {
            api.setPopups({ ...api.popups(), enabled });
            renderSettings();
          }),
          popups.enabled
            ? row('sliders', 'وش يطلع لك', null, { value: on === Object.keys(api.labels).length ? 'الكل' : `${on} من ${Object.keys(api.labels).length}`, run: openPopupKinds })
            : null,
        ],
        { note: 'الإطفاء يوقف التنبيه المنبثق بس. إشعاراتك تبقى في صفحتها.' },
      );
      renderTranslationSettings(group, row, toggle);
      group('المساعدة', [row('flag', 'بلّغ عن مشكلة', 'صار شي غلط؟ قل لنا وش صار', { run: () => openProblemSheet() })]);
    }

    group('عن التطبيق', [
      row('layers', 'المصادر', 'مصادر عربية تشتغل على جهازك', { value: 'عربي' }),
      // بعد تحديث واجهة يسبق رقمُها رقمَ الـAPK؛ كلاهما يظهر لمن يسأل
      row('info', 'الإصدار', apkVersion && apkVersion !== deps.version ? `أندرويد ${apkVersion}` : null, { value: deps.version || '—' }),
      api?.checkUpdate
        ? row('refresh', 'تحديث التطبيق', 'يبحث عن نسخة أحدث ويثبّتها بزرّ واحد', {
            run: async () => {
              toast('نبحث عن تحديث…');
              const found = await api.checkUpdate().catch(() => null);
              if (!found) toast('عندك آخر نسخة');
            },
          })
        : null,
    ]);

    if (!api) return;
    // ── النظام: مطويّ. من يفتحه يعرف أنه دخل مكانًا تقنيًّا ──
    const toggleSystem = el('button', `system-toggle${systemOpen ? ' open' : ''}`);
    toggleSystem.type = 'button';
    toggleSystem.setAttribute('aria-expanded', String(systemOpen));
    toggleSystem.innerHTML = `${glyph('settings')}<span><strong>النظام</strong><small>للمسؤول فقط: المزامنة والخادم</small></span>${glyph('chevron', { cls: 'icon chev' })}`;
    toggleSystem.onclick = () => {
      systemOpen = !systemOpen;
      renderSettings();
      if (systemOpen) q('settingsBody').querySelector('.system-toggle')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    };
    body.append(toggleSystem);
    if (!systemOpen) return;

    const health = api.health();
    const bad = health.state !== 'ok' && health.state !== 'syncing';
    group('', [
      row('refresh', 'حالة المزامنة', health.lastSyncAt ? `آخر مرة ${api.ago(health.lastSyncAt)}` : null, { value: health.message, tone: bad ? 'warn' : 'ok' }),
      row('send', 'زامن الآن', 'آمن: يرسل ويجيب آخر التغييرات', {
        run: async () => {
          toast('جارٍ المزامنة…');
          await api.syncNow().catch(() => {});
          toast('تمّت المزامنة');
          renderSettings();
        },
      }),
    ]);

    if (api.resetWeb && available()) {
      // التحديثات تتراجع وحدها عن واجهة معطوبة؛ هذا للحالة التي لا يراها الكود
      group('', [
        row('refresh', 'الرجوع للواجهة الأصلية', 'يلغي تحديثات الواجهة ويرجع للنسخة المدمجة في التطبيق', {
          run: async () => {
            toast('نرجع للواجهة الأصلية…');
            await api.resetWeb().catch(() => {});
          },
        }),
      ]);
    }

    if (available()) {
      group('', [row('layers', 'فحص المصادر', 'يجرّب كل مصدر: القائمة، البحث، الفصول، الصفحات، الصور، والأغلفة', { run: openSourceCheck })]);
    }

    group(
      'منطقة الخطر',
      [
        row('server', 'عنوان الخادم', 'غلط فيه يفصل التطبيق عن حساباتكم', { value: hostOf(api.endpoints().sync), danger: true, run: () => confirmDanger('serverUrl') }),
        row('layers', 'أعد بناء البيانات المحلية', 'يمسح ما على الجهاز ويجيبه من الخادم من جديد', { danger: true, run: () => confirmDanger('rebuild') }),
        health.quarantined
          ? row('alert', 'عمليات رفضها الخادم', null, { value: String(health.quarantined), danger: true, run: () => confirmDanger('retry') })
          : null,
      ],
      { cls: 'danger-zone', note: 'لا تلمس شي هنا إلا إذا طُلب منك. كل خيار يسألك قبل ما يسوي شي.' },
    );
  }

  /** فحص المصادر الستة عشر على هذا الجهاز وشبكته، خطوةً خطوة. */
  function openSourceCheck() {
    const rows = new Map();
    const report = [];
    openSheet((body) => {
      body.append(el('h3', null, 'فحص المصادر'));
      const note = el('p', null, 'يجرّب كل مصدر كما يستعمله القارئ. ياخذ دقيقة تقريبًا.');
      note.style.marginBottom = '10px';
      body.append(note);
      const list = el('div', 'check-list');
      body.append(list);
      const copy = el('button', 'btn btn-secondary btn-block');
      copy.type = 'button';
      copy.innerHTML = `${glyph('share')}<span>انسخ النتيجة</span>`;
      copy.disabled = true;
      copy.onclick = async () => {
        try {
          await navigator.clipboard.writeText(report.join('\n'));
          toast('انسخت. ألصقها لي');
        } catch {
          toast('ما قدرت أنسخ');
        }
      };
      copy.style.marginTop = '12px';
      body.append(copy);
      const rowOf = (source) => {
        if (rows.has(source.id)) return rows.get(source.id);
        const r = el('div', 'check-row');
        const head = el('div', 'check-head');
        const state = el('span', 'check-state');
        state.append(el('i', 'spinner'));
        head.append(el('strong', null, source.label), state);
        const steps = el('div', 'check-steps');
        r.append(head, steps);
        list.append(r);
        const entry = { r, state, steps, fails: 0, done: 0 };
        rows.set(source.id, entry);
        return entry;
      };
      void checkAllSources(
        (source) => rowOf(source),
        (source, key, res) => {
          const e = rowOf(source);
          e.done += 1;
          if (!res.ok) e.fails += 1;
          const label = CHECK_STEPS.find(([k]) => k === key)?.[1] ?? key;
          const chip = el('span', `check-step check-step--${res.ok ? 'ok' : 'bad'}`, `${res.ok ? '✓' : '✗'} ${label}`);
          chip.title = res.ok ? `${res.detail ?? ''} · ${res.ms}ms` : res.error;
          e.steps.append(chip);
          if (!res.ok) e.steps.append(el('small', 'check-why', `${label}: ${res.error}`));
          report.push(`${source.label} | ${label} | ${res.ok ? 'OK' : 'FAIL'} | ${res.ms}ms | ${res.ok ? res.detail ?? '' : res.error}`);
        },
      ).then(({ list: all }) => {
        for (const s of all) {
          const e = rowOf(s);
          e.state.replaceChildren(el('span', e.fails ? 'check-bad' : 'check-ok', e.fails ? `${e.fails} خلل` : 'سليم'));
        }
        copy.disabled = false;
      });
    });
  }

  function openPopupKinds() {
    const api = deps.settings;
    openSheet((body) => {
      body.append(el('h3', null, 'وش يطلع لك'));
      const list = el('div', 'settings-list');
      list.style.marginTop = '12px';
      for (const [kind, label] of Object.entries(api.labels)) {
        const d = el('label', 'setting');
        d.innerHTML = glyph(KIND_ICON[kind] ?? 'bell');
        const t = el('div');
        t.append(el('strong', null, label));
        const input = el('input');
        input.type = 'checkbox';
        input.className = 'switch-input';
        input.setAttribute('role', 'switch');
        input.checked = api.popups().kinds[kind] !== false;
        input.onchange = () => {
          const cur = api.popups();
          api.setPopups({ ...cur, kinds: { ...cur.kinds, [kind]: input.checked } });
        };
        d.append(t, input);
        list.append(d);
      }
      body.append(list);
      return () => renderSettings();
    });
  }

  /** كل ما في منطقة الخطر يمرّ بسؤال واحد واضح قبل أن يفعل شيئًا. */
  function confirmDanger(what) {
    const api = deps.settings;
    const copy = {
      serverUrl: ['تغيّر عنوان الخادم؟', 'لو كتبت عنوانًا غلط ينفصل التطبيق عن حساباتكم ومزامنتكم. غيّره بس إذا طُلب منك.', 'أبغى أغيّره', () => openServerSheet()],
      rebuild: ['تعيد بناء البيانات؟', 'يمسح النسخة اللي على جهازك ويجيب كل شي من الخادم من جديد. تحتاج اتصال، وتاخذ دقيقة.', 'أعد البناء', async () => {
        toast('جارٍ إعادة البناء…');
        await api.resync().catch(() => {});
        toast('خلصت');
        renderSettings();
      }],
      retry: ['تعيد محاولة المرفوض؟', 'يرجع العمليات اللي رفضها الخادم للطابور ويحاول يرسلها مرة ثانية.', 'أعد المحاولة', () => {
        const n = api.retryQuarantined();
        toast(`أُعيدت ${countLabel(n, 'op')} للطابور`);
        renderSettings();
      }],
    }[what];
    const [title, text, label, run] = copy;
    openSheet((body) => {
      body.append(el('h3', null, title), el('p', null, text));
      const actions = el('div', 'sheet-actions');
      const cancel = el('button', 'btn btn-secondary', 'لا، خلّه');
      cancel.type = 'button';
      cancel.onclick = () => closeSheet();
      const go = el('button', 'btn btn-danger', label);
      go.type = 'button';
      go.onclick = () => {
        closeSheet();
        void run();
      };
      actions.append(cancel, go);
      body.append(actions);
    });
  }

  function hostOf(url) {
    if (!url) return 'غير مضبوط';
    try {
      return new URL(url).host;
    } catch {
      return url;
    }
  }
  function openServerSheet() {
    const api = deps.settings;
    const ep = api.endpoints();
    openSheet((body) => {
      body.append(el('h3', null, 'عناوين الخادم'));
      body.append(el('p', null, 'التطبيق يُعاد تشغيله بعد الحفظ: العناوين تُقرأ عند الإقلاع.'));
      const field = (label, value) => {
        const wrap = el('label', 'field');
        wrap.append(el('span', 'field-label', label));
        const input = el('input', 'field-input');
        input.value = value ?? '';
        input.placeholder = 'https://…';
        input.dir = 'ltr';
        input.inputMode = 'url';
        input.autocomplete = 'off';
        wrap.append(input);
        body.append(wrap);
        return input;
      };
      const syncInput = field('خادم المزامنة (Cloudflare)', ep.sync);
      const apiInput = field('خادم المحتوى', ep.api);
      const save = el('button', 'btn btn-primary btn-block', 'احفظ وأعد التشغيل');
      save.type = 'button';
      const status = el('p', 'settings-note');
      save.onclick = async () => {
        const valid = (v) => !v || /^https:\/\/[^\s]+$/i.test(v);
        const next = { sync: syncInput.value.trim().replace(/\/+$/, ''), api: apiInput.value.trim().replace(/\/+$/, '') };
        if (!next.sync) return void (status.textContent = 'عنوان خادم المزامنة مطلوب.');
        if (!valid(next.sync) || !valid(next.api)) return void (status.textContent = 'العنوان لازم يبدأ بـ https://');
        // لا يُحفظ عنوان لا يردّ: غلطة كتابة واحدة كانت تفصل الجهاز عن حساباته
        save.disabled = true;
        save.textContent = 'نتأكد من الخادم…';
        const reachable = async (url, path, check) => {
          try {
            const r = await fetch(`${url}${path}`, { cache: 'no-store' });
            return r.ok && check(await r.json().catch(() => null));
          } catch {
            return false;
          }
        };
        const syncOk = await reachable(next.sync, '/health', (j) => j?.ok === true);
        // خادم المحتوى قد لا يرسل CORS لهذا المسار: يكفي أنه يردّ أصلًا
        const apiOk = !next.api || (await fetch(`${next.api}/healthz`, { mode: 'no-cors', cache: 'no-store' }).then(() => true, () => false));
        if (!syncOk || !apiOk) {
          save.disabled = false;
          save.textContent = 'احفظ وأعد التشغيل';
          status.textContent = !syncOk ? 'خادم المزامنة ما ردّ. ما حفظنا شي، والعنوان القديم باقي.' : 'خادم المحتوى ما ردّ. ما حفظنا شي.';
          return;
        }
        api.setEndpoints(next);
        save.textContent = 'حُفظ. جارٍ إعادة التشغيل…';
        setTimeout(() => window.location.reload(), 400);
      };
      body.append(save, status);
    });
  }

  function openProblemSheet() {
    const api = deps.settings;
    openSheet((body) => {
      body.append(el('h3', null, 'بلّغ عن مشكلة'));
      body.append(el('p', null, 'اختر نوعها واكتب اللي صار إن حبيت.'));
      let kind = api.reportKinds[0]?.[0];
      const chips = el('div', 'report-kinds');
      for (const [value, label] of api.reportKinds) {
        const c = el('button', 'chip-btn', label);
        c.type = 'button';
        c.setAttribute('aria-pressed', String(value === kind));
        c.onclick = () => {
          kind = value;
          chips.querySelectorAll('.chip-btn').forEach((x) => x.setAttribute('aria-pressed', String(x === c)));
        };
        chips.append(c);
      }
      const note = el('textarea', 'search-input share-note');
      note.rows = 3;
      note.maxLength = 2000;
      note.placeholder = 'وش صار؟ (اختياري)';
      const send = el('button', 'btn btn-primary btn-block', 'أرسل البلاغ');
      send.type = 'button';
      send.onclick = async () => {
        send.disabled = true;
        send.textContent = 'جارٍ الإرسال…';
        try {
          await api.reportProblem(kind, note.value.trim());
          closeSheet();
          toast('وصل البلاغ، شكرًا');
        } catch (error) {
          send.disabled = false;
          send.textContent = 'أرسل البلاغ';
          toast(error?.status === 0 ? 'تعذّر الإرسال. حاول بعد شوي.' : 'تعذّر الإرسال. خادم المحتوى غير متاح.');
        }
      };
      body.append(chips, note, send);
    });
  }

  function paintNotifyDots() {
    const unread = unreadNotifications();
    root.querySelectorAll('.notify-dot, .social-tab-dot').forEach((d) => (d.hidden = unread === 0));
    root.querySelectorAll('.has-dot').forEach((b) => b.setAttribute('aria-label', unread ? `الإشعارات، ${countLabel(unread, 'new')}` : 'الإشعارات'));
  }

  // ───────────────────────── الأفعال المفوَّضة ─────────────────────────

  const actions = {
    backFromDetail: () => goBack(),
    goBack: () => goBack(),
    closeDrawer,
    drawerBackdropClick: (e) => {
      if (e.target === q('drawerBackdrop')) closeDrawer();
    },
    drawerNavigate: (_e, t) => drawerNavigate(t.dataset.arg),
    sheetBackdrop: (e) => {
      if (e.target === q('sheet')) closeSheet();
    },
    loadMoreCollection: () => void loadMoreCollection(),
    loadMoreDiscover: () => void loadMoreDiscover(),
    clearDiscoverSearch,
    clearSearch,
    navTo: (_e, t) => navTo(t.dataset.arg),
    openCategories,
    openCollection: (_e, t) => void openCollection(t.dataset.arg),
    openDrawer,
    openSearch,
    openUtility: (_e, t) => void deps.go({ name: t.dataset.arg }),
    openWorkMenu,
    shareCurrent: () => state.current && openShare(state.current),
    markPreviousReading,
    toggleTranslateCurrent,
    readNow,
    flipChapterOrder,
    toggleSummary,
    toggleFavoriteCurrent,
    toggleLibraryCurrent,
    readAllNotifications,
  };
  root.addEventListener('click', (e) => {
    const t = e.target.closest('[data-act]');
    if (!t || !root.contains(t)) return;
    const run = actions[t.dataset.act];
    if (run) run(e, t);
  });
  root.addEventListener('input', (e) => {
    const t = e.target.closest('[data-input]');
    if (t?.dataset.input === 'debouncedSearch') debouncedSearch(t.value);
    if (t?.dataset.input === 'discoverSearch') discoverSearch(t.value);
  });
  root.addEventListener('submit', (e) => {
    e.preventDefault();
    // «بحث» في لوحة المفاتيح يخفيها: النتائج تحتها لا فوقها
    e.target.querySelector('input')?.blur();
  });
  root.addEventListener('change', (e) => {
    if (e.target.closest('[data-change="renderLibrary"]')) renderLibrary();
  });

  // ترويسة صفحة العمل تكتسي خلفية عند التمرير، وعنوان العمل يظهر فيها
  const onScroll = () => {
    if (currentPage() === 'detail') q('detailTop').classList.toggle('scrolled', window.scrollY > 170);
  };
  window.addEventListener('scroll', onScroll, { passive: true });

  const onKey = (e) => {
    // القارئ فوق القشرة يعالج رجوعه وحده: بلا هذا يرجع Esc خطوتين
    if (e.key === 'Escape' && !document.querySelector('.rd, .fv')) handleBack();
  };
  document.addEventListener('keydown', onKey);
  const unsubscribe = sync.onChange?.((tables) => {
    if (tables.includes('work_views') || tables.includes('progress')) {
      if (currentPage() === 'library' && state.libraryFilter === 'history') renderLibrary();
      else if (currentPage() === 'home' && tables.includes('work_views')) renderHome();
    }
    if (tables.some((t) => ['library', 'collections', 'completions'].includes(t))) {
      refreshLibraryDetail();
      if (currentPage() === 'home') renderHome();
      if (currentPage() === 'library') renderLibrary();
    }
    if (tables.includes('ratings')) {
      pendingRating = null;
      renderRating();
    }
    if (tables.includes('chapter_marks') && currentPage() === 'detail' && state.current?._chapters) renderChapters(state.current);
    majlis.onChange(tables, { visible: currentPage() === 'majlis' && (state.socialTab === 'majlis' || state.socialTab === 'recs') });
    profile.onChange(tables);
    if (tables.includes('notifications')) {
      paintNotifyDots();
      if (notificationsVisible()) renderNotifications();
    }
    if (currentPage() === 'majlis' && state.socialTab === 'friends' && tables.some((t) => ['profiles', 'accounts', 'works'].includes(t))) renderFriends();
  });

  /** زرّ الرجوع (أندرويد وEsc): الورقة ثم الدرج ثم الصفحة السابقة. */
  function handleBack() {
    if (editor?.open) return editor.handleBack();
    return majlis.closeBar() || closeSheet() || closeDrawer() || goBack();
  }

  const majlis = createMajlis({
    sync,
    host: q('majlisBody'),
    presence: () => deps.presence?.() ?? Promise.resolve([]),
    avatarNode,
    mountImage,
    workFromRef,
    openWork: (w) => void openWork(w),
    preview: (w, opts) => previewWork(w, opts),
    openFrame: (id) => void deps.go({ name: 'frame', id }),
    openProfile: (userId) => openProfile(userId),
    openShare: () => navTo('discover'),
    pageImage: available() ? deps.pageImage : null,
    openSheet,
    closeSheet,
  });
  // ما وصل هذا الجهاز قبل فتح الشاشة: المرسل يرى «وصله» الآن لا عند أول مجلس
  setTimeout(() => {
    majlis.acknowledgeDelivered();
    migrateLocalHistory();
  }, 0);
  // مكتبتك وآخر ما فتحت تُجمع فصولها من كل المصادر في الخلفية: تُفتح جاهزة
  setTimeout(() => {
    if (!available()) return;
    const seen = new Set();
    const works = [...libraryWorks('all'), ...historyWorks().slice(0, 12)].filter((w) => !seen.has(w.id) && seen.add(w.id));
    void prewarm(works, { onDone: (full) => rememberWork(full) });
  }, 6000);

  const profile = createProfile({
    sync,
    host: q('profileBody'),
    presence: () => deps.presence?.() ?? Promise.resolve([]),
    avatarNode,
    mountImage,
    workFromRef,
    openWork: (w) => previewWork(w),
    openSheet,
    back: () => goBack(),
    edit: () => editProfile(),
    libraryWorks,
    historyList: (target, opts) => renderHistoryList(target, opts),
    topSlots: () => topSlots().map((r) => (r ? workFromRef(r.series_ref, topTitle(r)) : null)),
    toast: (text) => toast(text),
    removeFromTop: (ref) => removeFromTop(ref),
    openHistory: () => {
      state.libraryFilter = 'history';
      navTo('library');
    },
  });
  let editor = null;
  function editProfile() {
    if (editor?.open) return;
    editor = openProfileEditor({
      sync,
      profile: profile.editable(),
      openSheet,
      closeSheet,
      toast,
      onSaved: (fields) => profile.applyLocal(fields),
      onClose: () => {
        editor = null;
      },
    });
  }
  function openProfile(userId = me()) {
    showPage('profile');
    void profile.show(userId);
  }

  paintNotifyDots();
  void loadHome();
  showPage(page);

  // الرجوع من القارئ أو الأصدقاء يعيد الصفحة كما تُركت، بتمريرها
  let savedScroll = 0;
  return {
    root,
    showPage,
    openWork,
    /** عمل من مرجعه وحده (إشعار، رابط): صفحته في الواجهة لا الشاشة القديمة. */
    openRef: (ref, title, cover) => void openWork(workFromRef(ref, title, cover)),
    openMajlis,
    openProfile,
    handleBack,
    pause() {
      savedScroll = window.scrollY;
      majlis.hide();
      clearInterval(state.heroTimer);
      closeDrawer();
      closeSheet();
    },
    resume(target) {
      const current = currentPage();
      if (target && target !== current && target !== 'detail') {
        showPage(target);
      } else {
        if (current === 'detail' && state.current?._chapters) renderChapters(state.current);
        paintNotifyDots();
        requestAnimationFrame(() => window.scrollTo({ top: savedScroll, behavior: 'instant' }));
      }
      if (state.heroItems.length) restartHero();
      if (currentPage() === 'majlis') renderSocial();
    },
    destroy() {
      majlis.hide();
      clearInterval(state.heroTimer);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll);
      unsubscribe?.();
    },
  };
}

export { seriesRefOf };
