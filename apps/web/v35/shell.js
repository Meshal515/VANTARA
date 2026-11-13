import { diagnosticsUi } from '../lib/diagnostics-ui.js';
import { collectFollowTime } from '../lib/follow-time.js';
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

import { createNativeCatalog, diagnoseManagedAddon } from '../addons/native-catalog.js';
import { createSourceVerification } from '../lib/source-verification.js';
import { SHELL_HTML } from './markup.js';
import { createSheetController } from './sheet-lifecycle.js';
import { renderAddons } from './addons-view.js';
import { renderSourceMode } from './source-mode.js';
import { resolveSourceIdentity, withOfficialIdentity } from './source-identity.js';
import { getAddonRuntime } from '../addons/runtime.js';
import { supportedCapabilities } from '../addons/assessment.js';
import { entitlement } from '../lib/source-entitlement.js';
import { sourceWorkModel, restoreSourceWork } from '../addons/work-view.js';
import { chapterGroups, detailMarkup, groupIndexOf, isNewChapter, isWideMangaArtwork, mangaLook, matchChapters, monthOf, releaseBeat, rowsForMark, rowsInGroup, TABBED_LOOKS } from './manga-work.js';
import { mountDepth } from './depth.js';
import { glyph, iconButton } from './icons.js';
import { CHECK_STEPS, available, browse, browseLive, cachedSpan, chapterSpan, checkAllSources, describe, displayName, editionRows, loadWork, loadWorkOnce, prewarm, resetSources, isFiller, isAdult, scanLatestChapterUpdates, seriesRefOf, setSharedLatest, canonicalEventWorks, mergeWorkPages, matchingWork, withUpdateSources, requestedChapterRow } from './works.js';
import { readKv, writeKv } from '../lib/chapter-store.js';
import { warmChapter } from './reader.js';
import { endWorkSession, setTranslation, translationOn } from './reader-translate.js';
import engine from '../lib/extension-engine.js';
import { chapterKeyOf, clearChapterMarks, continueChapter, isChapterRead, mainChapters, markChapter, markChapters, sameChapterKey, startChapter } from './reading.js';
import { countMainChapters, titlesMatch } from '../lib/catalog.js';
import { announceCover, cachedCover, coverCandidates, coverPreview, forgetCover, knownCover, nativeCover, onCoverKnown, rememberCover } from './covers.js';
import { readTranslateSettings, setTranslationLocked, translationLocked, writeTranslateSettings } from '../lib/translate-settings.js';
import { benchmarkEngines, benchmarkPage, diagnoseCleaning, downloadModels, formatBytes, jobFinished, jobProgress, jobStop, modelsStatus, nativeTranslationAvailable, notificationPermission, removeModels } from '../lib/translation-native.js';
import { clearPerf, engineLines, formatReport, readPerf, summarize, totalOf } from '../lib/translate-perf.js';
import { BLOCK_TEXT, createJob, createJobRunner, englishSources, estimateMinutes, finishedText, pickChapters, progressOf, readPace } from '../lib/translate-jobs.js';
import { cachedPage, readerQuiet, translatePage } from '../lib/translate.js';
import { countLabel } from './plural.js';
import { frameIdFromLink } from '../lib/frame.js';
import { createMajlis } from './majlis.js';
import { createFriends } from './friends.js';
import { rankFriendsReading } from './friends-reading.js';
import { createFeedSnapshot } from './feed-snapshot.js';
import { createRoom } from './majlis-chat.js';
import { prepareRoomAvatar } from './media-encode.js';
import { endpoints } from '../lib/config.js';
import { compactEditions, describesMore, displayTitle, mergeEditions, serverEditions } from './work-ref.js';
import { createProfile } from './profile.js';
import { openShareSheet } from './share.js';
import { createTogether } from './together.js';
import { openProfileEditor } from './profile-editor.js';
import { SECTIONS, readSection, writeSection as storeSection } from './sections.js';
import { addToAnimeList, createAnime, readWatch } from './anime.js';
import { createCinema } from './cinema.js';
import { createAnimeAccount, isAnimeRef, isMediaRef } from './anime-account.js';
import { createRafiq } from './rafiq.js';
import { momentRange, momentStart, repositories as animeRepositories, verify as verifyAnimeSource, withPhaseDeadline } from '../lib/anime-engine.js';
import { fetchAnimeDetail, fetchAnimeHome } from '../lib/anime-meta.js';
import { fetchMangaGenre, fetchMangaMatches, fetchMangaPopular } from '../lib/manga-meta.js';
import { artRatio, createArtStore } from '../lib/art.js';
import { kitsuArt } from '../lib/kitsu-art.js';
import { blockKey, hideWork, hiddenWorks, restoreWork, setHiddenUser } from '../lib/adult-filter.js';
import { heroSlideIn, stripIn } from './motion.js';
import { afterMotion, motionActive, bindTabMotion, fadeIn, finishPageMotion, handoffSurface, pageMotionState, pageIn as pageMotionIn, pageOut, dockIn, dockOut, readyGate, settleIn, veil } from './page-motion.js';
import { createCrossfade, createDock, createLayers, haptic } from './dock.js';
import { onLongPress, roomInitial } from './social-kit.js';
import { canManageDangerZone } from '../lib/identity.js';
import { pinPad } from '../screens/pin-pad.js';
import { reconcileCardNodes } from './card-reconcile.js';
import { imageLoadingNode, imageFallbackNode } from './image-loading.js';
import { copyableText, editableText } from './text-actions.js';
import { recentStore } from '../lib/recent-searches.js';
import { createSourceLatest } from './source-latest.js';
import { connectUpdates, observeMangaChapters } from '../lib/update-engine.js';
import { canonicalRefOf, noteRefAliases, refsOf } from '../lib/manga-alias-store.js';
import { connectSourceReports, playbackHealth } from '../lib/source-report.js';
import { agoAr, latestGroups, mountTimeline } from './updates-view.js';
import { onChapters } from '../lib/extension-engine.js';
import { createInsights, duration as insightDuration } from './insights.js';
import { currentPlatform, supports } from '../lib/capabilities.js';
import { RELEASE, releaseNotesFor } from '../lib/release.js';
import { paintWorkInsights } from './work-insights.js';
import { applyAppearance, migrateAppearance, patchAppearance, toneCss, unifiedLookOn, workStyleOf } from './appearance.js';
import { sideDock } from './side-dock.js';
import { experienceView, readStructure } from './experience.js';
import { appearanceFeature, CATEGORIES, categoryOf, renderAppearancePane } from './settings-center.js';
import { collectItems, loadIdentity, unifiedFeed } from './unified-home.js';
import { createUnifiedView } from './unified-view.js';
import { workMenuEntries, workOptionEntries } from './work-menu.js';
import { EMPTY_COPY, LIBRARY_TABS, libraryShelves } from './library-model.js';
import { createUnifiedLibrary } from './unified-library.js';
import { createUnifiedSearch } from './unified-search.js';
import { createCinemaPager, createUnifiedDiscover } from './unified-discover.js';
import { GENRES_AR as CINEMA_GENRES_AR } from '../lib/cinema-meta.js';
import { trimArtCache } from '../lib/together/art.js';

const AR_GENRE = {
  Action: 'أكشن', Adventure: 'مغامرة', Fantasy: 'فانتازيا', Drama: 'دراما', Comedy: 'كوميديا', Romance: 'رومانسي',
  Supernatural: 'قوى خارقة', 'Sci-Fi': 'خيال علمي', Mystery: 'غموض', Thriller: 'إثارة', Horror: 'رعب', Sports: 'رياضة',
  Psychological: 'نفسي', Mecha: 'ميكا', Music: 'موسيقى', 'Slice of Life': 'حياة يومية', Isekai: 'إيسيكاي',
  Historical: 'تاريخي', Superhero: 'أبطال خارقون', Tragedy: 'مأساة', Medical: 'طبي', Philosophical: 'فلسفي',
  Crime: 'جريمة', 'Magical Girls': 'فتيات سحريات', Wuxia: 'ووشيا', Ecchi: 'إيتشي', 'Mahou Shoujo': 'فتيات سحريات',
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
  ['قوائمي', [['المفضلة', 'favorites', 'heart'], ['أقرأ لاحقًا', 'later', 'clock'], ['آخر المشاهدات', 'history', 'history'], ['إحصائيات المتابعة', 'insights', 'chart']]],
  ['', [['الإضافات', 'addons', 'puzzle'], ['الإعدادات', 'settings', 'settings'], ['تبديل الحساب', 'switchAccount', 'switchUser']]],
];

const WORKS_KEY = 'vantara.v35.works';

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

/** Source opening owns one cancellable lookup, shared across native/runtime hand-off. */
export function createAddonNavigation() {
  let current = null;
  const cancel = () => { current?.cancel(); current = null; };
  return {
    cancel,
    begin() {
      cancel();
      const controller = new AbortController();
      const error = Object.assign(new Error('انتهت مهلة فتح المصدر. أعد المحاولة.'), { code: 'ADDON_TOTAL_TIMEOUT' });
      const timer = setTimeout(() => controller.abort(error), 40_000);
      const check = () => { if (controller.signal.aborted) throw controller.signal.reason; };
      const operation = {
        signal: controller.signal,
        async wait(work, code = 'ADDON_STAGE_TIMEOUT') {
          check();
          try {
            const result = await withPhaseDeadline(Promise.resolve().then(() => { check(); return work(controller.signal); }), 15_000, code, { signal: controller.signal });
            check();
            return result;
          } catch (failure) {
            const reason = controller.signal.aborted ? controller.signal.reason : failure;
            controller.abort(reason);
            clearTimeout(timer);
            throw reason;
          }
        },
        finish() { clearTimeout(timer); },
        cancel() { clearTimeout(timer); controller.abort(new DOMException('ألغي فتح المصدر', 'AbortError')); },
      };
      current = operation;
      return operation;
    },
  };
}

/** A mixed cinema catalogue can omit type; let the person choose without inventing metadata. */
export function promptSourceWorkType(work, addon, { el, openSheet, closeSheet, sheetItem, active, onChoose }) {
  if (work.type || !addon.contentTypes.includes('movie') || !addon.contentTypes.includes('series')) return false;
  let selected = false;
  openSheet(body => {
    body.append(el('h3', null, 'اختر نوع العمل'), el('p', 'work-meta', 'المصدر لم يحدد نوع هذا العمل. كيف تريد فتحه؟'));
    for (const [type, label, icon] of [['movie', 'فيلم', 'film'], ['series', 'مسلسل', 'layers']]) {
      body.append(sheetItem(icon, label, () => {
        if (selected || !active()) return;
        selected = true;
        closeSheet();
        void onChoose({ ...work, type });
      }));
    }
  });
  return true;
}

/**
 * @param {{ sync: any, mount: (node: Element) => void, go: (route: object) => Promise<void>,
 *           openReader: (route: object) => void, switchAccount: () => void, version: string,
 *           friends?: () => Array<{userId: string, displayName: string, avatarKey: string|null}>,
 *           report?: (input: object) => Promise<unknown> }} deps
 */
export function mountV35(deps, { page = 'home' } = {}) {
  void diagnosticsUi.initialize();
  const { sync } = deps;
  setSharedLatest(createSourceLatest(sync));
  // Update Engine: كل فصل يراه أي مسار يُبلَّغ، والخادم يقرّر ما الجديد
  connectUpdates((path, opts) => sync.translation(path, opts));
  connectSourceReports((path, opts) => sync.translation(path, opts));
  onChapters(observeMangaChapters);
  // أجهزة امتلأ تخزينها بكاش الصور (قبل سقفه) تتحرر من أول إقلاع، فتُحفظ الإعدادات من جديد
  try { trimArtCache(); } catch { /* اختياري */ }
  migrateAppearance();
  const root = el('div', 'v35');
  bindTabMotion(root);
  if (globalThis.Capacitor?.getPlatform?.() === 'android') root.classList.add('native-android');
  root.innerHTML = SHELL_HTML;
  const sourceVerification = createSourceVerification();

  // Startup invariant: the shell must mount before any optional native bridge work.
  // Follow-time is telemetry/accounting; a missing, stale, or temporarily broken
  // Capacitor plugin must never strand the app on the static splash screen.
  deps.mount(root);
  let followTimeClosed = false;
  // Optional Debug family binds its private store to the already selected profile.
  // Shell mounting remains synchronous; unavailable bridges never block startup.
  if(globalThis.Capacitor?.Plugins?.VantaraRuntime)queueMicrotask(()=>{
    void getAddonRuntime().then(async addons=>{
      // الجلسة تُقرأ من التخزين بعد الإقلاع؛ الربط قبلها يفتح مخزن «local» الفارغ فتختفي إضافات
      // CloudStream المثبتة في الحساب من الأقسام حتى تُفتح صفحة الإضافات.
      await addons.ready;await sync.ready?.catch?.(()=>{});if(followTimeClosed)return;
      await addons.registry.setProfile(sync.user?.userId ?? 'local');
      if(!followTimeClosed)await addons.reloadSources?.();
    }).catch(()=>{});
  });
  let stopFollowTime = () => {};
  queueMicrotask(() => {
    if (followTimeClosed) return;
    try {
      stopFollowTime = collectFollowTime(sync);
    } catch {
      // The collector is best-effort. Its durable native journal can retry later.
    }
  });
  const q = (id) => root.querySelector(`#${id}`);
  /**
   * القسم المحفوظ للمستخدم (المبدّل). في «توحيد المحتوى» لا مبدّل: فتح فيلم أو أنمي يلبس الصفحة هوية قسمها
   * (applySection) ولا يغيّر القسم الذي اختاره صاحبه، وإلا وجد نفسه في السينما حين يطفئ الموحد (#323 U-12).
   */
  const writeSection = (id) => { if (root.dataset.content !== 'unified') storeSection(id); };
  // الشريط الجانبي للشاشات العريضة يُرسم بعد اكتمال الإقلاع (يقرأ رفيق والحساب)
  const wideScreen = globalThis.matchMedia?.('(min-width: 1024px)');
  let railReady = false;

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

  function toast(msg, ms = 2200) {
    const t = q('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t._x);
    t._x = setTimeout(() => t.classList.remove('show'), ms);
  }

  // ورقة واحدة مشتركة: الإغلاق يُعطّل شجرة اللمس كاملة، لا خلفيتها فقط.
  const sheetController = createSheetController(q('sheet'), q('sheetBody'));
  const openSheet = sheetController.open;
  const closeSheet = sheetController.close;
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

  function openTextActions(value) {
    openSheet((body) => {
      const preview = el('p', 'copy-preview', value.length > 180 ? `${value.slice(0, 180)}…` : value);
      preview.dir = 'auto';
      body.append(preview,
        sheetItem('copy', 'نسخ', async () => {
          try { await navigator.clipboard.writeText(value); toast('نُسخ النص'); }
          catch { toast('تعذّر النسخ'); }
          closeSheet();
        }),
        sheetItem('share', 'مشاركة', async () => {
          closeSheet();
          try {
            if (navigator.share) await navigator.share({ text: value });
            else { await navigator.clipboard.writeText(value); toast('نُسخ النص للمشاركة'); }
          } catch (error) { if (error?.name !== 'AbortError') toast('تعذّرت المشاركة'); }
        }),
      );
    });
  }
  let textPress = null;
  const cancelTextPress = () => { if (textPress) clearTimeout(textPress.timer); textPress = null; };
  root.addEventListener('pointerdown', (event) => {
    cancelTextPress();
    const value = copyableText(event.target);
    if (!value) return;
    const press = { x: event.clientX, y: event.clientY, value, timer: null };
    press.timer = setTimeout(() => {
      if (textPress !== press) return;
      openTextActions(value);
      textPress = null;
    }, 500);
    textPress = press;
  });
  root.addEventListener('pointermove', (event) => {
    if (textPress && Math.hypot(event.clientX - textPress.x, event.clientY - textPress.y) > 8) cancelTextPress();
  });
  for (const kind of ['pointerup', 'pointercancel']) root.addEventListener(kind, cancelTextPress);
  root.addEventListener('contextmenu', (event) => {
    if (editableText(event.target)) return;
    event.preventDefault();
    cancelTextPress();
    const value = copyableText(event.target);
    if (!value) return; // بطاقة العمل تعالج ضغطتها المطوّلة بنفسها.
    event.stopPropagation();
    if (!q('sheet').classList.contains('show')) openTextActions(value);
  }, true);

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
    // الغلاف الموحّد (الخادم) أولًا، ثم ما عرفه هذا الجهاز: نفس الغلاف في كل الشاشات
    const thumbnailUrl = row?.cover_url ?? saved?.thumbnailUrl ?? cover ?? null;
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
  setHiddenUser(me);

  // ترجمة الفصول مقدمًا: الطابور المحفوظ (lib/translate-jobs.js)، يُنشأ مبكرًا فكل من يسأله يجده
  const translationJobs = createJobRunner({ sync, engine, translatePage, readerQuiet, concurrency:24, lookahead:40, prepareConcurrency:2, native: { jobProgress, jobFinished, jobStop } });
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
    if (onSettings()) renderSettings();
  });
  // بعد الدخول: ما كان شغّالًا يكمل من حيث وقف (الحساب يحتاج لحظة ليجهز)
  (function resumeJobsWhenSignedIn(tries = 0) {
    if (!supports('translation')) return;
    if (sync.user) return void translationJobs.resumeAll();
    if (tries < 60) setTimeout(() => resumeJobsWhenSignedIn(tries + 1), 5000);
  })();

  // الأنمي يشارك هذه الجداول بمرجع `anime:<id>`: شاشات المانجا لا تعرضه (له مكتبته)
  const libraryRows = () => sync.rows('library', (r) => r.user_id === me() && !r.removed && !isMediaRef(r.series_ref));
  // عمل صار جزءًا من عمل قانوني (نفس العمل باسم آخر): ما حُفظ باسمه القديم يُقرأ معه
  const inCollection = (kind, ref) => {
    const refs = refsOf(ref);
    return kind === 'completed'
      ? sync.rows('completions', (r) => r.user_id === me() && refs.includes(r.series_ref) && r.member).length > 0
      : sync.rows('collections', (r) => r.user_id === me() && r.kind === kind && refs.includes(r.series_ref) && r.member).length > 0;
  };
  function libraryEntry(ref) {
    const refs = refsOf(ref);
    const row = libraryRows().find((r) => refs.includes(r.series_ref));
    const later = inCollection('read_later', ref);
    const favorite = inCollection('favorite', ref);
    const completed = inCollection('completed', ref);
    if (!row && !later && !favorite && !completed) return null;
    return { row, later, favorite, completed, addedAt: row?.added_at ?? 0 };
  }
  function libraryWorks(filter = 'all') {
    const refs = new Set([
      ...libraryRows().map((r) => r.series_ref),
      ...sync.rows('collections', (r) => r.user_id === me() && r.member && !isMediaRef(r.series_ref)).map((r) => r.series_ref),
      ...sync.rows('completions', (r) => r.user_id === me() && r.member && !isMediaRef(r.series_ref)).map((r) => r.series_ref),
    ]);
    const cards = [...refs]
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
    return mergeWorkPages(cards);
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
      .rows('work_views', (r) => r.user_id === userId && !r.removed && !isMediaRef(r.series_ref))
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
  // البطاقة تقول أين وقفت: «الفصل 47» من سجلّك نفسه
  // «222» وحده لا يقول شيئًا: رقم الفصل يُقرأ «الفصل 222»، والاسم الحرفي يبقى كما هو
  const chapterLabelAr = (label) => (label != null && /^\d+(\.\d+)?$/.test(String(label).trim()) ? `الفصل ${String(label).trim()}` : label ?? null);
  // سجلّان لعمل واحد بمرجعين (قبل الدمج وبعده، أو من «الأكثر قراءة» ومن البحث): بطاقة واحدة بأحدثهما
  const historyWorks = () => { const seen = new Set(); return viewRows().filter((v) => { const k = canonicalRefOf(v.series_ref); return !seen.has(k) && seen.add(k); }).map((v) => ({ ...workFromRef(v.series_ref, v.series_title, v.cover_url), _viewLabel: chapterLabelAr(v.chapter_label), _viewAt: v.viewed_at ?? null })); };
  // ───────────────────────── الصور والبطاقات ─────────────────────────

  function fallbackArt(container, label) {
    container.replaceChildren(imageFallbackNode(initialOf(label)));
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
  /**
   * عقد نُزعت من الصفحة قبل أن تقترب (قائمة أُعيد رسمها) لا تبقى منتظرة ولا مراقبة (#311 D-016): تُكنس حين
   * تكبر الخريطة، فتبقى محدودة بما في الصفحة فعلًا.
   */
  const sweepDetached = (map, release) => {
    if (map.size < 120) return;
    for (const node of [...map.keys()]) if (!node.isConnected) { map.delete(node); release?.(node); }
  };
  function nearViewport(node) {
    if (!nearObserver) return Promise.resolve();
    return new Promise((resolve) => {
      nearWaiters.get(node)?.();
      sweepDetached(nearWaiters, (n) => nearObserver.unobserve(n));
      nearWaiters.set(node, resolve);
      nearObserver.observe(node);
    });
  }
  /**
   * قرار فن العمل الواحد (lib/art.js): كل شاشة تقرأ غلاف العمل من هنا، والبطاقة تحسمه أول ما تقترب من الشاشة
   * فتجده صفحة العمل محسومًا بأبعاده (يظهر بنسبته من أول إطار، والغلاف نفسه في الخارج والداخل). كانت ثلاث
   * قواعد (البطاقات: أول رابط يتحمّل، وصفحة العمل: بالقياس، والفهرس: بشكل الرابط) وأربع ذاكرات.
   */
  const art = createArtStore();
  const failedCanonical = new Map();
  let artActive = 0;
  const artWaiting = [];
  /** مرشحو غلاف عمل: غلاف الخادم الثابت، ثم غلاف البطاقة، ثم أغلفة نسخه من المصادر (لا البنر). */
  function artSources(work) {
    const id = String(work?.id ?? '');
    const canonical = id ? sync.rows('works', (x) => x.series_ref === id)[0]?.cover_url ?? null : null;
    const editions = work?._work?.editions ?? [];
    const urls = [canonical, knownCover(id), work?.coverImage?.extraLarge, work?.coverImage?.large, work?._work?.thumbnailUrl, ...editions.map((e) => e.manga?.thumbnailUrl)];
    const sourceOf = (url) => editions.find((e) => e.manga?.thumbnailUrl === url)?.sourceId ?? editions[0]?.sourceId ?? null;
    return [...new Set(urls.filter((u) => typeof u === 'string' && u))].map((url) => ({ url, sourceId: sourceOf(url) }));
  }
  /**
   * يحسم فن العمل مرة (ثلاثة أعمال في آنٍ على الأكثر). أغلفة المصادر بمحرّكها وترويساتها إن أمكن (ملف محفوظ
   * على الجهاز)، والرسمي من AniList للمانجا بطلب التقييم نفسه (ثمانية عناوين في استعلام).
   */
  function decideArt(work) {
    const id = String(work?.id ?? '');
    if (!id) return Promise.resolve(null);
    const known = art.get(id);
    if (known?.w) return Promise.resolve(known);
    return new Promise((resolve) => {
      const run = async () => {
        artActive += 1;
        try {
          // الرسمي (AniList) يُطلب أولًا فيسير بالتوازي مع أغلفة المصادر، لا خلفها (كان ينتظر حتى 2.5 ثانية لها)
          const title = work?._work?.title || work?.title?.english || titleOf(work);
          // AniList ومعه Kitsu بالهوية نفسها (رقم AniList): غلاف وبنر أعلى جودة وأخف غالبًا (lib/kitsu-art.js)
          const official = id.startsWith('ext:') && title ? artFor(title).then(async (a) => {
            if (!a?.id) return a;
            const more = await Promise.race([kitsuArt(a.id), new Promise((r) => setTimeout(() => r(null), 1200))]);
            return more ? { ...a, more: [{ cover: more.cover?.url ?? null, banner: more.banner?.url ?? null }] } : a;
          }) : null;
          const sources = await Promise.all(artSources(work).slice(0, 4).map((c) =>
            Promise.race([nativeCover(c.url, c.sourceId), new Promise((r) => setTimeout(() => r(null), 2500))]).then((local) => local || c.url)));
          const wideHint = work?.wideBanner || (work?.bannerImage && work.bannerImage !== work.coverImage?.large ? work.bannerImage : null);
          resolve(await art.decide(id, { official, sources, wideHint }));
        } catch { resolve(null); } finally {
          artActive -= 1;
          artWaiting.shift()?.();
        }
      };
      // ثمانية أعمال تُحسم في آنٍ: الشبكة تحمّل 30 غلافًا بالتوازي في ربع ثانية، وثلاثة فقط كانت تجعل قائمة من
      // ثلاثين تنتظر عشر جولات متتالية
      if (artActive < 8) void run();
      else artWaiting.push(run);
    });
  }
  /** يرسم الغلاف المحسوم في حاويته بنسبته الحقيقية. `fade` لظهوره الأول فوق هيكله (لا تبديل لما ظهر). */
  function paintDecided(container, work, d, { position = null, fade = false, onFail = null } = {}) {
    const ratio = artRatio(d);
    if (ratio) container.style.setProperty('--art-ratio', ratio);
    const src = cachedCover(d.cover) ?? d.cover;
    const current = container.querySelector(':scope > img');
    if (current?.getAttribute('src') === src) return d.cover;
    const img = new Image();
    img.alt = '';
    img.decoding = fade ? 'async' : 'sync';
    if (fade) img.classList.add('img-fade');
    if (position) img.style.objectPosition = position;
    img.onerror = () => { art.forget(String(work?.id ?? '')); onFail?.(); };
    img.src = src;
    container.replaceChildren(img);
    return d.cover;
  }
  const idOf = (work) => String(work?.id ?? '');
  const animePosters = new Map();
  /** ملصق أنمي بمعرّف AniList، مرة لكل أنمي في الجلسة. */
  function animePoster(id) {
    if (!animePosters.has(id)) {
      // الفشل لا يُحفظ (#311 D-009): كان null يبقى طول الجلسة فلا يظهر ملصق ذلك الأنمي أبدًا
      animePosters.set(id, fetchAnimeDetail(id).then((m) => m?.poster ?? m?.posterSmall ?? null).catch(() => null)
        .then((url) => { if (!url) animePosters.delete(id); return url; }));
    }
    return animePosters.get(id);
  }

  async function mountImage(container, work, opts = {}) {
    const token = String(Math.random());
    container.dataset.imageToken = token;
    const canonical = work?.id ? sync.rows('works', (x) => x.series_ref === String(work.id))[0]?.cover_url ?? null : null;
    // القرار المحسوم للعمل (من أي شاشة حسمته): يظهر فورًا بنسبته، بلا هيكل ولا انتظار
    const fallBack = () => { if (container.dataset.imageToken === token) void mountLegacy(container, work, opts, token, canonical); };
    const decided = art.get(idOf(work));
    if (decided) return paintDecided(container, work, decided, { position: opts.position, onFail: fallBack });
    // لم يُحسم بعد: هيكل بمقاسه حتى يُحسم، ثم يظهر الغلاف النهائي مرة (لا غلاف مؤقت يُستبدل)
    if (idOf(work) && !idOf(work).startsWith('anime:') && !idOf(work).startsWith('cinema:')) {
      container.replaceChildren(imageLoadingNode());
      await nearViewport(container);
      if (container.dataset.imageToken !== token) return null;
      const d = await decideArt(work);
      if (container.dataset.imageToken !== token) return null;
      if (d) return paintDecided(container, work, d, { position: opts.position, fade: true, onFail: fallBack });
    }
    return mountLegacy(container, work, opts, token, canonical);
  }
  /**
   * المسار الاحتياطي حين لا يُحسم فن (كل الروابط فشلت، أو أنمي/سينما من السجل بلا ملصق): ملف محفوظ، ثم محرّك
   * المصدر، ثم الرابط، ثم الحرف الأول وطلب التفاصيل في الخلفية. لا يحسم قرارًا ولا يتقدم على قرار.
   */
  async function mountLegacy(container, work, opts, token, canonical) {
    // `late`: غلافٌ ثقيل (ميغابايتان على شبكة جوال) تجاوز المهلة لا يُرمى: يكمل
    // تحميله ويحلّ محل الحرف أو المعاينة حين يصل
    const tryUrl = (url, timeoutMs, late = null) =>
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
        img.onload = () => {
          if (!finished) return done(true);
          if (late && container.dataset.imageToken === token) late(img);
        };
        img.onerror = () => done(false);
        img.src = url;
      });
    const show = (img, url, remote = url, sourceId = null) => {
      if (id.startsWith('ext:') && canonical && remote !== canonical && failedCanonical.get(id) === canonical) {
        sync.enqueue('work.cover.repair', { seriesRef: id, expectedCover: canonical, coverUrl: remote, sourceId });
      }
      if (opts.position) img.style.objectPosition = opts.position;
      container.replaceChildren(img);
      // بطاقات أخرى للعمل نفسه بقيت بحرفه (فشلت قبل أن يُعرف): تأخذه الآن
      for (const [other, waiting] of waitingCovers) {
        if (other === container || String(waiting.id) !== id) continue;
        waitingCovers.delete(other);
        if (other.isConnected) void mountImage(other, waiting);
      }
      return url;
    };
    // الغلاف المعروف لهذا العمل أولًا (من أي شاشة عرفته)، ثم وصف الخادم، ثم القائمة
    const id = String(work?.id ?? '');
    const serverCover = id ? sync.rows('works', (x) => x.series_ref === id)[0]?.cover_url : null;
    const seen = new Set();
    const candidates = [
      ...[serverCover, knownCover(id)].filter(Boolean).map((url) => ({ url, sourceId: work?._work?.editions?.find((e) => e.manga?.thumbnailUrl === url)?.sourceId ?? sync.rows('works', (x) => x.series_ref === id)[0]?.source_id ?? work?._work?.editions?.[0]?.sourceId ?? null })),
      ...coverCandidates(work),
    ].filter((c) => !seen.has(c.url) && seen.add(c.url));
    // أنمي من المجلس أو الحضور بلا غلاف محفوظ: ملصقه من AniList
    if (!candidates.length && id.startsWith('anime:')) {
      const poster = await animePoster(id.slice('anime:'.length));
      if (container.dataset.imageToken !== token) return null;
      if (poster) candidates.push({ url: poster, sourceId: null });
    }
    // المحفوظ أولًا وبلا هيكل لامع: الغلاف الذي رأيته أمس يظهر كما هو
    for (const { url, sourceId } of candidates) {
      const local = cachedCover(url);
      if (!local) continue;
      const img = await tryUrl(local, 2500);
      if (container.dataset.imageToken !== token) return null;
      if (img) {
        rememberCover(id, url);
        return show(img, local, url, sourceId);
      }
      forgetCover(url);
    }
    container.replaceChildren(imageLoadingNode());
    // ما لم يُحفظ بعد يُجلب حين يقترب من الشاشة: الظاهر أولًا، والشبكة لا
    // تنشغل بستين غلافًا في آخر الصفحة قبل الذي أمامك
    await nearViewport(container);
    if (container.dataset.imageToken !== token) return null;
    // مصدرٌ يعرض مصغّرًا خفيفًا لغلافه الكبير: يظهر فورًا والكبير يحلّ محله
    let previewShown = false;
    const preview = candidates.map((c) => coverPreview(c.url)).find(Boolean);
    // صفحة العمل (`final`): لا معاينة صغيرة يحلّ محلها الكبير أمام العين؛ الهيكل حتى يصل النهائي
    if (preview && !opts.final) {
      const small = await tryUrl(preview, 4000);
      if (container.dataset.imageToken !== token) return null;
      if (small) {
        if (opts.position) small.style.objectPosition = opts.position;
        container.replaceChildren(small);
        previewShown = true;
      }
    }
    for (const { url, sourceId } of candidates) {
      const saved = await nativeCover(url, sourceId);
      if (container.dataset.imageToken !== token) return null;
      const late = (img) => {
        if (opts.final) img.classList.add('img-fade');
        rememberCover(id, url);
        show(img, img.src, url, sourceId);
      };
      const img = (saved && (await tryUrl(saved, 6000))) || (await tryUrl(url, 9000, late));
      if (container.dataset.imageToken !== token) return null;
      if (img) {
        // من الشبكة: يظهر بتلاشٍ واحد فوق الهيكل (المحفوظ والمعروف يظهران فورًا بلا حركة)
        if (opts.final) img.classList.add('img-fade');
        rememberCover(id, url);
        return show(img, img.src, url, sourceId);
      }
      if (url === canonical) failedCanonical.set(id, canonical);
    }
    if (container.dataset.imageToken !== token) return null;
    if (!previewShown) fallbackArt(container, titleOf(work));
    // لا فراغ دائم: الغلاف يُطلب من تفاصيل العمل في الخلفية، والبطاقة تُعاد حين يصل
    waitCover(container, work);
    resolveCoverLater(work);
    return null;
  }
  /** بطاقات بلا غلاف تنتظر معرفته. محدودة: المنزوعة تُكنس حين تُضاف غيرها (#311 D-006). */
  const waitingCovers = new Map();
  const waitCover = (container, work) => { sweepDetached(waitingCovers); waitingCovers.set(container, work); };
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
    if (!id || !id.startsWith('ext:') || !available()) return;
    if (Date.now() - (coverTried.get(id) ?? 0) < 10 * 60_000) return;
    coverTried.set(id, Date.now());
    const run = async () => {
      coverActive += 1;
      try {
        const full = await describe(work);
        const url = full?._work?.thumbnailUrl || full?.coverImage?.large || null;
        if (url) {
          rememberWork({ ...full, _work: { ...full._work, thumbnailUrl: url } });
          announceCover(id, url);
          for (const [container, waiting] of waitingCovers) {
            if (String(waiting.id) === id && container.isConnected) { waitingCovers.delete(container); void mountImage(container, { ...full, id }); }
          }
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

  const ratingPromises = new Map();
  const ratingQueue = [];
  let ratingTimer = null;
  // التقييم والفن الرسمي من طلب AniList نفسه (ثمانية عناوين في استعلام): artFor لا يكلّف طلبًا إضافيًا
  const artPromises = new Map();
  function matchFor(title) {
    if (!ratingPromises.has(title)) {
      let resolveArtOf;
      artPromises.set(title, new Promise((r) => { resolveArtOf = r; }));
      ratingPromises.set(title, new Promise((resolve) => {
        ratingQueue.push({ title, resolve, resolveArt: resolveArtOf });
        ratingTimer ??= setTimeout(flushRatings, 50);
      }));
    }
  }
  function ratingFor(title) {
    matchFor(title);
    return ratingPromises.get(title);
  }
  function artFor(title) {
    matchFor(title);
    return artPromises.get(title);
  }
  // مطابقة AniList (التقييم والغلاف والبنر الرسمي) لكل ما ظهر من أعمال في طلب واحد: 20 عنوانًا في الطلب وطلبان في
  // آنٍ على الأكثر، بلا انتظار بين الدفعات. القياس الحي: 30 عنوانًا بطلب واحد 170ms، وبدفعات 8 ينتظر بينها 750ms
  // كانت 2.7 ثانية، فتنتظر أغلفة القائمة كلها خلفها.
  const MATCH_BATCH = 20;
  let ratingInFlight = 0;
  async function flushRatings() {
    ratingTimer = null;
    if (ratingInFlight >= 2) return;
    const batch = ratingQueue.splice(0, MATCH_BATCH);
    if (!batch.length) return;
    ratingInFlight += 1;
    if (ratingQueue.length) ratingTimer = setTimeout(flushRatings, 0);
    try {
      const matches = await fetchMangaMatches(batch.map((b) => b.title));
      batch.forEach(({ title, resolve, resolveArt }) => { resolve(matches.get(title)?.rating ?? null); resolveArt(matches.get(title)?.art ?? null); });
    } catch {
      batch.forEach(({ title, resolve, resolveArt }) => { ratingPromises.delete(title); artPromises.delete(title); resolve(null); resolveArt(null); });
    } finally {
      ratingInFlight -= 1;
    }
    if (ratingQueue.length) ratingTimer ??= setTimeout(flushRatings, 0);
  }
  /** «حذف العمل»: يختفي من كل القوائم والبحث وآخر التحديثات، ويبقى في أرشيف حسابك لإعادته. */
  function deleteWork(work) {
    const keys = [work._work?.key, ...(work._work?.keys ?? []), String(work.id)].filter(Boolean);
    hideWork({ id: String(work.id), keys, title: titleOf(work), cover: work.coverUrl ?? work.cover ?? work._work?.thumbnailUrl ?? null });
    for (const node of root.querySelectorAll('.work-card')) if (node._work && (String(node._work.id) === String(work.id) || keys.includes(node._work._work?.key))) node.remove();
    toast('حُذف العمل — تلقاه في الإعدادات › أرشيف الأعمال المحذوفة');
  }
  function openCardActions(work) {
    const ref = String(work.id);
    openSheet((body) => {
      const title = el('h3', null, titleOf(work));
      title.dir = 'auto';
      body.append(title);
      body.append(
        sheetItem('library', libraryEntry(ref)?.row ? 'في المكتبة' : 'أضف إلى المكتبة', () => {
          closeSheet();
          if (!libraryEntry(ref)?.row) { sync.enqueue('library.add', descriptorOf(work)); toast('أضيف إلى مكتبتك'); }
          else toast('العمل في مكتبتك');
        }, { pressed: !!libraryEntry(ref)?.row }),
        sheetItem('clock', inCollection('read_later', ref) ? 'في أقرأ لاحقًا' : 'اقرأ لاحقًا', () => {
          closeSheet();
          if (!inCollection('read_later', ref)) { sync.enqueue('readLater.set', { ...descriptorOf(work), member: true }); toast('في «أقرأ لاحقًا»'); }
          else toast('العمل في «أقرأ لاحقًا»');
        }, { pressed: inCollection('read_later', ref) }),
        sheetItem('trash', 'حذف العمل', () => {
          closeSheet();
          deleteWork(work);
        }, { danger: true }),
      );
    }, { tone: 'manga' });
  }

  function card(work, { meta } = {}) {
    const a = el('article', 'work-card');
    a.dataset.workId = String(work.id);
    a._work = work;
    a.tabIndex = 0;
    a.setAttribute('role', 'link');
    a.setAttribute('aria-label', `${titleOf(work)}، اضغط مطولًا لخيارات المكتبة`);
    // الغلاف غلافٌ فقط؛ التقييم تحت العنوان، والفصول في صفحة العمل.
    const frame = el('div', 'work-card-frame');
    const p = el('div', 'poster');
    const score = el('span', 'work-score');
    score.hidden = true;
    frame.append(p);
    const t = el('div', 'work-title', titleOf(work));
    t.dir = 'auto';
    const m = el('div', 'work-meta');
    setMeta(m, meta ?? latestLabel(work));
    const facts = el('div', 'work-facts');
    facts.append(score);
    void mountImage(p, work);
    a.append(frame, t, m, facts);
    if (work._viewAt) a.append(el('div', 'work-when', `آخر قراءة ${agoAr(work._viewAt)}`));
    onLongPress(a, () => openCardActions(a._work));
    void nearViewport(a).then(async () => {
      if (!a.isConnected) return;
      void ratingFor(work._work?.title || work.title?.english || titleOf(work)).then((rated) => {
        if (!a.isConnected || !rated) return;
        // AniList يعرف العمل للكبار (هنتاي، إيتشي…): يُحجب ويختفي من هنا ومن كل قائمة بعدها
        if (rated.adult) { for (const k of [work._work?.key, ...(work._work?.keys ?? [])]) blockKey(k); a.remove(); return; }
        score.innerHTML = `${glyph('star', { size: 11, filled: true })}<b>${rated.score.toFixed(1)}</b>`;
        score.title = `تقييم AniList: ${rated.score.toFixed(1)} من 10`;
        score.setAttribute('aria-label', score.title);
        score.hidden = false;
      });
    });
    a.onclick = () => void openWork(a._work);
    a.onkeydown = (e) => {
      if (e.key === 'Enter' && e.target === a) void openWork(a._work);
      if ((e.key === ' ' || e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) && e.target === a) {
        e.preventDefault();
        openCardActions(a._work);
      }
    };
    return a;
  }
  /** «الفصل 401 · قبل ساعتين»: الوقت من ذاكرة VANTARA حين يكون الحدث منها. */
  function latestLabel(work) {
    const recent = work._latestChapter;
    if (!recent) return work._viewLabel ?? (work.genres || []).slice(0, 2).map(genreAr).join('، ');
    const n = Number(recent.chapterNumber);
    const label = Number.isFinite(n) && n >= 0 ? `الفصل ${n}` : String(recent.name ?? '').slice(0, 44);
    // عدة فصول نزلت للعمل: بطاقة واحدة ورقم خفيف بعددها
    const more = work._newCount > 1 ? ` +${work._newCount - 1}` : '';
    const when = work._updatePublishedAt > 0 ? agoAr(work._updateAt) : `رُصد ${agoAr(work._updateAt)}`;
    return work._updateAt ? `${label}${more} · ${when}` : label + more;
  }
  /** «الفصل 121 · قبل ساعة»: جزآن، فيصفّهما كل قسم كما صُمّم (سطر واحد أو الفصل يمينًا والوقت يسارًا). */
  function setMeta(node, label) {
    const text = String(label ?? '');
    if (node.dataset.label === text) return;
    node.dataset.label = text;
    const i = text.indexOf(' · ');
    if (i < 0) { node.textContent = text; return; }
    node.replaceChildren(el('span', 'work-meta-main', text.slice(0, i)), el('span', 'work-meta-when', text.slice(i + 3)));
  }
  function reconcileCards(target, items) {
    reconcileCardNodes(target, items, card, (node, work) => {
      node._work = work;
      const meta = node.querySelector('.work-meta');
      if (meta) setMeta(meta, latestLabel(work));
    });
  }
  const renderStrip = (target, items) => reconcileCards(target, items.slice(0, Number(target.dataset.limit) || 14));
  const renderGrid = (target, items) => reconcileCards(target, items);
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

  /**
   * عدد المصادر التي تشغّل أو تقرأ في هذا القسم لحسابك، أو null إن لم يُعرف بعد (فلا نقول «أضف مصدرًا»
   * لحساب موجود لم يصل صفّه من المزامنة). نموذج Stremio: الكتالوج يعرض كل عمل، والمشاهدة/القراءة من
   * مصادر يضيفها المستخدم.
   */
  async function playableSources(section) {
    if (entitlement().state === 'unknown') return null;
    if (section === 'manga') {
      const list = await engine.sources().catch(() => null);
      return list ? list.filter((s) => !s.filler).length : null;
    }
    const addons = await getAddonRuntime().catch(() => null);
    if (!addons) return null;
    await addons.ready;
    const runtimeName = addons.runtimeName ?? addons.registry.runtimeName ?? 'pwa';
    const kinds = section === 'cinema' ? ['movie', 'series'] : ['anime', 'movie', 'series'];
    return addons.registry.list().filter((a) => a.enabled !== false
      && (a.contentTypes ?? []).some((t) => kinds.includes(t))
      && (a.bundled ? (a.capabilities ?? []).includes('streams') : supportedCapabilities(a, runtimeName).includes('streams'))).length;
  }
  function addSource() {
    void openAddons();
  }
  /** «أضف مصدرًا لتقرأ»: مكان قائمة فارغة سببها أن الحساب بلا مصادر مانجا، لا عطل مصدر. */
  async function showAddMangaSource(target) {
    if ((await playableSources('manga')) !== 0) return false;
    emptyState(target, {
      icon: 'layers',
      title: 'أضف مصدرًا لتقرأ',
      text: 'الأعمال تظهر من الكتالوج، والقراءة من مصادر تضيفها أنت.',
      action: { label: 'أضف مصدرًا', icon: 'plus', run: addSource },
    });
    return true;
  }

  // ───────────────────────── الرئيسية ─────────────────────────

  /**
   * أقسام الرئيسية بإيقاع مجلة لا شريطًا مكررًا: لكل نوع تركيبه.
   *   - آخر المشاهدات: بطاقات عريضة تقول أين وقفت.
   *   - الرائج: قائمة مرتّبة بأرقام، ثلاثة صفوف تُسحب أفقيًا.
   *   - آخر التحديثات: شبكة 3×3 ثابتة.
   *   - الباقي: أغلفة طولية.
   */
  const HOME_LAYOUT = {
    history: { kicker: '', layout: 'resume', limit: 12 },
    libraryReading: { kicker: '', layout: 'covers', limit: 14 },
    friends: { kicker: '', layout: 'covers', limit: 14 },
    trending: { kicker: '', layout: 'chart', limit: 12 },
    recent: { kicker: '', layout: 'grid', limit: 9 },
    sourcesNow: { kicker: '', layout: 'grid', limit: 9 },
  };
  function sectionBlock(title, kind, items, layoutKind = kind) {
    const spec = HOME_LAYOUT[layoutKind] ?? { kicker: '', layout: 'covers', limit: 14 };
    const s = el('section', `section section--${spec.layout}`);
    s.dataset.kind = layoutKind ?? 'friends';
    const h = el('div', 'section-head');
    const titles = el('div', 'section-titles');
    if (spec.kicker) titles.append(el('span', 'section-eyebrow', spec.kicker));
    titles.append(el('h2', null, title));
    h.append(titles);
    if (kind) {
      const b = el('button', 'link');
      b.type = 'button';
      b.innerHTML = `<span>الكل</span>${glyph('chevron')}`;
      b.setAttribute('aria-label', `عرض الكل: ${title}`);
      b.onclick = () => void openCollection(kind);
      h.append(b);
    }
    const strip = el('div', `card-strip card-strip--${spec.layout}`);
    // الشبكة على الشاشة العريضة 12 (صفوف كاملة من 4 أو 6 أعمدة)، وعلى الجوال 3×3
    strip.dataset.limit = String(spec.layout === 'grid' && globalThis.matchMedia?.('(min-width: 700px)').matches ? 12 : spec.limit);
    renderStrip(strip, items);
    s.append(h, strip);
    return s;
  }
  /**
   * ما يقرؤه أصدقاؤك فعلًا: أعمال في «آخر المشاهدات» عندهم خلال أسبوعين،
   * الأكثر أصدقاءً أولًا ثم الأحدث. من سجلّهم نفسه، لا تقدير.
   */
  function friendsReading() {
    const friendIds = (deps.friends?.() ?? sync.rows('accounts').map((r) => ({ userId: r.user_id }))).map((p) => p.userId);
    return rankFriendsReading(sync.rows('work_views'), { me: me(), friendIds, canonical: canonicalRefOf })
      .map((e) => workFromRef(e.ref, e.title, e.cover));
  }
  function refreshFriendsHero() {
    // أصدقاء لم يقرؤوا شيئًا خلال أسبوعين لا يتركون البانر فراغًا: الرائج مكانهم.
    const withCover = (list) => list.filter((w) => w.coverImage?.large && !isAdult(w));
    const friends = withCover(friendsReading());
    const next = (friends.length ? friends : withCover(state.home.trending ?? [])).slice(0, 6);
    if (next.length === state.heroItems.length && next.every((w, i) => w.id === state.heroItems[i]?.id)) return;
    state.heroItems = next;
    renderHero();
  }

  /**
   * الرئيسية من بيانات حقيقية فقط، كل قسم بمصدره وترتيبه:
   *   - آخر المشاهدات: سجلّك (20% من فصل أو تعليم).
   *   - أعمال تتابعها: مكتبتك.
   *   - يقرأها أصدقاؤك: سجلّات أصدقائك.
   *   - الأكثر رواجًا: «الرائج» عند كل المصادر، مرتّبًا بحضوره فيها وموضعه.
   *   - آخر التحديثات: أعمال صفحات Latest من المصادر، بترتيب المصدر. رقم الفصل
   *     لا يصل في SManga، لذلك لا ندّعيه حتى يقدمه المصدر بصراحة.
   * لا «مقترحة» ولا «مميزة» بلا معنى: ما لا نعرفه لا نخترعه.
   */
  const homeSnapshots = new Map();
  function homeSnapshot(kind, incoming) {
    // بمفتاح العمل لا بمعرّف البطاقة: بطاقة صار مفتاحها اسمًا آخر بعد دليل جديد تُستبدل في مكانها، لا تبقى بجانب الجديدة
    if (!homeSnapshots.has(kind)) homeSnapshots.set(kind, createFeedSnapshot({ key: (item) => canonicalRefOf(String(item.id)) }));
    return homeSnapshots.get(kind).accept(incoming);
  }
  async function globalPopular(page) {
    const key = `manga.global-popular.${page}`;
    const cached = (await readKv(key))?.value;
    if (cached?.items?.length && Date.now() - cached.at < 6 * 60 * 60_000) return cached;
    try {
      const result = await fetchMangaPopular({ page });
      const ranked = { ...result, at: Date.now() };
      void writeKv(key, ranked);
      return ranked;
    } catch (error) {
      if (cached?.items?.length) return cached;
      throw error;
    }
  }
  let homeBusy = false;
  let homeCheckedAt = 0;
  const keepChapterFacts = (items, before) => {
    const prior = new Map(before.map((w) => [String(w.id), w]));
    return items.map((w) => {
      const old = prior.get(String(w.id));
      return old ? {
        ...w,
        chapters: w.chapters ?? old.chapters,
        _work: { ...w._work, editions: mergeEditions(w._work?.editions, old._work?.editions) },
      } : w;
    });
  };
  const recentFromLatest = (fresh, previous) =>
    mergeWorkPages([...keepChapterFacts(fresh, previous), ...previous]).slice(0, 40);
  let latestJob = null;
  let latestResult = null;
  let latestPartial = null;
  const latestListeners = new Set();
  function latestFirstPage() {
    if (latestJob) return latestJob;
    if (latestResult && Date.now() - latestResult.at < 60_000) return Promise.resolve(latestResult);
    latestJob = browseLive({ kind: 'latestListing', page: 1 }, ({ items, hasNextPage }) => {
      if (!items.length) return;
      latestPartial = { items, hasNextPage, page: 1 };
      state.home.recent = recentFromLatest(items, state.home.recent);
      for (const listener of latestListeners) listener(latestPartial);
      if (state.collection?.kind === 'latestListing' && state.collection.page === 0) {
        if (!state.collection.items.length) state.collection.items = recentFromLatest(items, []);
        renderGrid(q('collectionGrid'), state.collection.items);
      }
      if (currentPage() === 'home') renderHome();
      void writeKv('home.v4', { trending: state.home.trending.slice(0, 40), recent: state.home.recent.slice(0, 40) });
    }, { concurrency: 3 }).then((result) => {
      latestResult = { ...result, at: Date.now() };
      return latestResult;
    }).finally(() => { latestJob = null; });
    return latestJob;
  }
  /** الفهرس يُظهر ما خلفه: ثلاثة أغلفة من كل باب، وسطر يقول ما فيه الآن. */
  function paintIndex() {
    const pick = (list, from = 0) => uniqueById(list ?? []).filter((w) => w.coverImage?.large).slice(from, from + 3);
    const updates = state.home.updates?.length ? state.home.updates : state.home.recent;
    const doors = {
      recent: { works: pick(updates), sub: state.home.updates?.length ? countLabel(state.home.updates.length, 'work') + ' تحدّثت' : 'فصول جديدة الآن' },
      trending: { works: pick(state.home.trending), sub: 'الأكثر قراءة الآن' },
      openCategories: { works: pick(state.home.trending, 3), sub: GENRES.slice(0, 3).map((g) => g.ar).join('، ') },
      catalogue: { works: pick(state.home.recent, 3), sub: 'كل ما في المصادر' },
    };
    for (const b of root.querySelectorAll('#mangaHome .shortcut')) {
      const door = doors[b.dataset.index];
      if (!door) continue;
      const sub = b.querySelector('.shortcut-sub');
      if (sub.textContent !== door.sub) sub.textContent = door.sub;
      const art = b.querySelector('.shortcut-art');
      const key = door.works.map((w) => w.id).join('|');
      if (art.dataset.key === key) continue;
      art.dataset.key = key;
      art.replaceChildren(
        ...door.works.map((w) => {
          const c = el('span', 'shortcut-cover');
          void mountImage(c, w);
          return c;
        }),
      );
    }
  }
  function renderHome() {
    if (!state.heroItems.length) refreshFriendsHero();
    paintIndex();
    const specs = [];
    const history = historyWorks();
    if (history.length) specs.push(['تابع القراءة', 'history', history.slice(0, 20)]);
    const reading = libraryWorks('reading');
    if (reading.length) specs.push(['أعمال تتابعها', 'libraryReading', reading]);
    const friends = friendsReading();
    if (friends.length) specs.push(['يقرأها أصدقاؤك', 'friends', friends.slice(0, 20)]);
    // عمل مكتمل من خارج أعلى الترتيب: لا يكرر أول ما في «الأكثر قراءة»
    const later = state.home.trending.slice(3).filter((w) => w.status === 'FINISHED' && w.coverImage?.large);
    const finished = later.find((w) => w.wideBanner) ?? later[0];
    if (finished) specs.push(['مكتمل، اقرأه دفعة واحدة', 'pick', finished]);
    if (state.home.trending.length) specs.push(['الأكثر قراءة', 'trending', state.home.trending]);
    if (state.home.updates?.length) specs.push(['آخر التحديثات', 'recent', state.home.updates]);
    else if (state.home.recent.length) specs.push(['في المصادر الآن', 'sourcesNow', state.home.recent]);
    if (!specs.length) return;
    const host = q('homeSections');
    const old = new Map([...host.children].filter((s) => s.dataset.kind).map((s) => [s.dataset.kind, s]));
    const blocks = specs.map(([title, kind, items]) => {
      if (kind === 'pick') return pickBlock(old.get('pick'), title, items);
      const snapshot = homeSnapshot(kind, items);
      const section = old.get(kind) ?? sectionBlock(title, kind === 'friends' ? null : kind, snapshot, kind);
      // قسم يظهر لأول مرة (وصلت بياناته) يدخل بتلاشٍ قصير لا فجأة؛ إعادة الرسم لا تحرّكه
      if (!old.has(kind)) fadeIn(section);
      if (old.has(kind)) renderStrip(section.querySelector('.card-strip'), snapshot);
      const pending = homeSnapshots.get(kind).pending;
      let refresh = section.querySelector('.feed-refresh');
      if (pending && !refresh) {
        refresh = el('button', 'feed-refresh');
        refresh.type = 'button';
        refresh.onclick = () => { homeSnapshots.get(kind).refresh(); renderHome(); };
        section.querySelector('.section-head').append(refresh);
      }
      if (refresh) { refresh.hidden = !pending; refresh.textContent = `${pending} أعمال جديدة`; }
      return section;
    });
    // ترتيب الأقسام ثابت كما صُمّم (آخر التحديثات في الأخير)، لا بترتيب وصول بياناتها
    blocks.forEach((block, i) => {
      if (host.children[i] !== block) host.insertBefore(block, host.children[i] ?? null);
    });
    for (const child of [...host.children]) if (!blocks.includes(child)) child.remove();
  }
  /** بطاقة «مكتمل»: عمل واحد يُقرأ دفعة واحدة، بضوء من غلافه نفسه وفعل واحد. */
  function pickBlock(existing, title, w) {
    if (existing?.dataset.workId === String(w.id)) return existing;
    const s = el('section', `section mg-pick${w.wideBanner ? ' mg-pick--wide' : ''}`);
    s.dataset.kind = 'pick';
    s.dataset.workId = String(w.id);
    const art = el('div', 'mg-pick-art');
    art.setAttribute('aria-hidden', 'true');
    if (w.wideBanner) {
      const img = new Image();
      img.alt = '';
      img.decoding = 'async';
      img.loading = 'lazy';
      img.src = w.wideBanner;
      art.append(img);
    } else void mountImage(art, w);
    const copy = el('div', 'mg-pick-copy');
    const name = el('h3', null, titleOf(w));
    name.dir = 'auto';
    const facts = [w.chapters ? countLabel(w.chapters, 'chapter') : null, (w.genres || []).slice(0, 2).map(genreAr).join('، ')].filter(Boolean).join(' · ');
    const b = el('button', 'btn btn-primary', 'ابدأ القراءة');
    b.type = 'button';
    b.onclick = (e) => { e.stopPropagation(); void openWork(w, { autoRead: true }); };
    copy.append(el('small', null, title), name);
    if (facts) copy.append(el('p', null, facts));
    copy.append(b);
    s.append(art);
    if (!w.wideBanner) {
      const cover = el('div', 'mg-pick-cover');
      void mountImage(cover, w);
      s.append(cover);
    }
    s.append(copy);
    s.onclick = () => void openWork(w);
    return s;
  }
  function renderHomeSkeleton() {
    q('homeSections').replaceChildren(
      ...['الأكثر شهرة عالميًا', 'آخر التحديثات في المصادر'].map((title) => {
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
    if (homeBusy) return;
    homeBusy = true;
    // خارج `try`: الـ`finally` يحتاجه، ولو عُرّف داخله لرمى ReferenceError فبقي `homeBusy` عالقًا
    let onLatest = null;
    try {
    if (!available()) {
      if (!state.heroItems.length) renderHeroFallback();
      const box = el('div');
      emptyState(box, { icon: 'layers', title: 'المصادر داخل تطبيق أندرويد', text: 'الكتالوج يُقرأ من مصادرنا العربية بمحرّك التطبيق — افتح VANTARA على الجوال.' });
      renderHome();
      q('homeSections').append(box.firstElementChild);
      return;
    }
    // آخر رئيسية رأيتها تظهر فورًا، والمصادر تحدّثها وهي تردّ واحدًا واحدًا —
    // لا شاشة تنتظر أبطأ مصدر من ستة عشر. قائمتان حقيقيتان: الرائج والأحدث.
    const cached = (await readKv('home.v4'))?.value;
    const hasCache = Boolean(cached?.trending?.length || cached?.recent?.length || state.home.trending.length || state.home.recent.length);
    if (hasCache) {
      if (cached?.trending?.length) state.home.trending = cached.trending;
      if (cached?.recent?.length) state.home.recent = recentFromLatest(state.home.recent, cached.recent.map(({ _latestChapter, ...w }) => w));
      renderHome();
    } else {
      if (!q('homeSections').childElementCount) renderHomeSkeleton();
      if (!state.heroItems.length) renderHeroFallback();
    }
    let paintTimer = null;
    let saveTimer = null;
    const paint = () => {
      clearTimeout(paintTimer);
      paintTimer = setTimeout(() => {
        if (currentPage() === 'home') renderHome();
        // يُحفظ ما وصل فورًا: الفتحة القادمة تبدأ منه ولو علق مصدر للنهاية
        if (!hasCache && !saveTimer) {
          saveTimer = setTimeout(() => {
            saveTimer = null;
            void writeKv('home.v4', { trending: state.home.trending.slice(0, 40), recent: state.home.recent.slice(0, 40) });
          }, 1500);
        }
      }, 120);
    };
    const live = (key) => ({ items }) => {
      // أول مصدر يدخل فوق اللقطة المحفوظة فورًا؛ لا ينتظر اثني عشر عملًا.
      if (key === 'recent') state.home.recent = recentFromLatest(items, state.home.recent);
      else {
        if (state.home[key]?.length && items.length < Math.min(state.home[key].length, 12)) return;
        state.home[key] = items;
      }
      paint();
    };
    onLatest = ({ items }) => live('recent')({ items });
    latestListeners.add(onLatest);
    try {
      // الرائج (AniList) يُرسم فور وصوله: كان ينتظر أبطأ مصدر في Promise.all، فبقيت الرئيسية هياكل
      // فارغة حتى تنتهي مهلة آخر مصدر (قيس: 78 ث مقابل أقل من ثانية للرائج نفسه).
      const trending = globalPopular(1).then((result) => {
        if (result.items.length) {
          state.home.trending = result.items;
          paint();
        }
        return result;
      });
      const [tr, re] = await Promise.all([trending, latestFirstPage()]);
      // ردّ فارغ من مصادر متعثّرة لا يمحو بطاقات سبق تأكيدها.
      if (tr.items.length) state.home.trending = tr.items;
      if (re.items.length) state.home.recent = recentFromLatest(re.items, state.home.recent);
      clearTimeout(saveTimer);
      renderHome();
      if (!tr.items.length && !re.items.length && !hasCache) throw new Error('empty');
      void writeKv('home.v4', { trending: state.home.trending.slice(0, 40), recent: state.home.recent.slice(0, 40) });
    } catch {
      // عندنا نسخة محفوظة: تبقى كما هي، بلا شاشة خطأ فوقها
      if (hasCache) return;
      if (!state.heroItems.length) renderHeroFallback();
      const box = el('div');
      if (await showAddMangaSource(box)) { q('homeSections').replaceChildren(box.firstElementChild); return; }
      emptyState(box, {
        icon: 'offline',
        error: true,
        title: 'تعذّر الوصول إلى المصادر',
        text: 'تحقّق من الاتصال ثم أعد المحاولة.',
        action: { label: 'أعد المحاولة', icon: 'refresh', run: () => void loadHome() },
      });
      q('homeSections').replaceChildren(box.firstElementChild);
    }
    } finally {
      if (onLatest) latestListeners.delete(onLatest);
      homeCheckedAt = Date.now();
      homeBusy = false;
    }
  }

  // ── البانر الدائري: حركة v35 كما هي، وتركيبٌ يناسب الأغلفة الطولية ──

  /**
   * «غلاف العدد»: صفحتان متقابلتان. الغلاف كاملًا واضحًا في صفحة، والكلام في
   * المقابلة برقم الصفحة كمجلة. لا ضباب ولا توهّج: أغلفة المصادر صغيرة، فتُعرض
   * بحجمها الصادق لا مكبّرة مشوّشة.
   */
  // ─── بانر المانجا: معرض الأغلفة ───
  // الغلاف المختار في الوسط بحجمه، والسابق يمينًا والتالي يسارًا (اتجاه القراءة)، وخلفها ضوء من
  // ألوان الغلاف نفسه. الضبابية تُخفي صغر أغلفة المصادر بدل أن تفضحها. السحب يمينًا يجلب التالي.
  // هندسة المعرض: لكل موضع (0 الوسط، 1 التالي…) إزاحة وحجم وشفافية، وما بينها يُحسب بالتدرج، فالسحب
  // يحرك الأغلفة مع الإصبع إطارًا بإطار، والإفلات يكمل إلى أقرب موضع. لا غلاف يختفي فجأة.
  const HERO_GEOMETRY = [
    { min: 1100, x: [0, 215, 400, 540], s: [1, 0.58, 0.46, 0.38], o: [1, 0.55, 0.3, 0] },
    { min: 700, x: [0, 180, 310, 420], s: [1, 0.58, 0.46, 0.38], o: [1, 0.55, 0.28, 0] },
    { min: 0, x: [0, 128, 214, 290], s: [1, 0.57, 0.46, 0.38], o: [1, 0.55, 0.3, 0] },
  ];
  const heroGeometry = () => HERO_GEOMETRY.find((g) => (globalThis.innerWidth ?? 390) >= g.min);
  const lerpAt = (arr, t) => {
    const k = Math.min(Math.floor(t), arr.length - 2);
    return arr[k] + (arr[k + 1] - arr[k]) * (Math.min(t, arr.length - 1) - k);
  };
  /** يضع الغلاف عند موضع متصل p؛ التالي (p>0) على اليسار كاتجاه القراءة. */
  function placeCover(c, p, animate) {
    const g = heroGeometry();
    const a = Math.min(Math.abs(p), 3);
    const x = -Math.sign(p) * lerpAt(g.x, a);
    const prev = Number(c.dataset.p ?? p);
    c.dataset.p = String(p);
    // الذي يلفّ من طرف إلى طرف يمرّ وهو خارج الشاشة: بلا حركة، فلا يطير عرضها
    const jump = Math.abs(prev - p) > 2.5;
    c.style.transition = animate && !jump ? '' : 'none';
    c.style.transform = `translate(-50%, -50%) translateX(${x.toFixed(1)}px) scale(${lerpAt(g.s, a).toFixed(4)})`;
    c.style.opacity = lerpAt(g.o, a).toFixed(3);
    c.style.zIndex = String(10 - Math.round(a * 2));
    c.style.pointerEvents = a > 2.2 ? 'none' : '';
    if (jump && animate) { void c.offsetWidth; c.style.transition = ''; }
  }
  function heroCoverNode(w, i) {
    const c = el('button', 'mg-cover');
    c.type = 'button';
    c.dataset.i = String(i);
    c.dataset.workId = String(w.id);
    c.setAttribute('aria-label', titleOf(w));
    void mountImage(c, w);
    c.onclick = () => {
      if (Math.abs(state.heroDeltaX) >= 8) return;
      if (Number(c.dataset.pos) === 0) void openWork(w);
      else heroGoLogical(i);
    };
    return c;
  }
  function paintHeroCopy(w, animate) {
    const copy = q('heroCopy');
    const kicker = [(w.genres || []).slice(0, 2).map(genreAr).join('، '), STATUS_AR[w.status]].filter(Boolean).join(' · ');
    const name = el('h3', 'hero-name', titleOf(w));
    name.dir = 'auto';
    const acts = el('div', 'mg-acts');
    // بقرار المالك: «اقرأ الآن» وحدها نصًا تفاعليًا بلا حاوية (التفاصيل بلمس الغلاف نفسه)
    const read = el('button', 'mg-read');
    read.type = 'button';
    read.innerHTML = '<span>اقرأ الآن</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 6.5v11c0 .9.98 1.45 1.74.98l8.7-5.5a1.15 1.15 0 0 0 0-1.96l-8.7-5.5A1.15 1.15 0 0 0 8 6.5z"/></svg>';
    read.onclick = () => void openWork(w, { autoRead: true });
    acts.append(read);
    const lines = [kicker ? el('div', 'hero-kicker', kicker) : null, name, acts].filter(Boolean);
    const swap = () => {
      copy.replaceChildren(...lines);
      copy.classList.remove('mg-swapping');
    };
    clearTimeout(state.heroCopyTimer);
    if (!animate || !copy.childElementCount) return swap();
    // الكلام يتلاشى ثم يظهر الجديد مكانه: لا قفزة نص ولا سطور تتطاير
    copy.classList.add('mg-swapping');
    state.heroCopyTimer = setTimeout(swap, 140);
  }
  function paintHeroAmbient(w) {
    const amb = q('heroAmb');
    const key = String(w.id);
    if (amb.dataset.key === key) return;
    amb.dataset.key = key;
    const layer = el('div', 'mg-amb-layer');
    amb.append(layer);
    // لا تظهر الطبقة قبل صورتها: كانت مكانها الفاتح يظهر أولًا ثم يغمق حين تصل الصورة.
    // الطبقات معتمة داخل حاوية بشفافية ثابتة، فالتبديل انتقال ألوان بالغمق نفسه لا إضاءة ثم إطفاء.
    const show = () => {
      if (!layer.isConnected || amb.dataset.key !== key) return;
      requestAnimationFrame(() => layer.classList.add('in'));
      const old = [...amb.children].filter((n) => n !== layer);
      setTimeout(() => old.forEach((n) => n.remove()), 1000);
    };
    void mountImage(layer, w).then((url) => {
      const img = layer.querySelector(':scope > img');
      if (!url || !img) return layer.remove();
      if (img.complete && img.naturalWidth) show();
      else img.decode?.().then(show, () => layer.remove()) ?? img.addEventListener('load', show, { once: true });
    }, () => layer.remove());
  }
  function renderHero() {
    const items = state.heroItems;
    if (!items.length) return renderHeroFallback();
    q('hero').classList.remove('mg-hero--empty');
    q('heroTrack').replaceChildren(...items.map((w, i) => heroCoverNode(w, i)));
    q('heroDots').replaceChildren();
    state.heroIndex = Math.min(state.heroIndex ?? 0, items.length - 1);
    heroPosition(false);
    bindHero();
    restartHero();
  }
  function renderHeroSkeleton() {
    q('heroTrack').replaceChildren(el('div', 'skeleton mg-cover-skeleton'));
    q('heroCopy').replaceChildren();
    q('heroDots').replaceChildren();
  }
  function renderHeroFallback() {
    state.heroItems = [];
    q('hero').classList.add('mg-hero--empty');
    q('heroTrack').replaceChildren();
    q('heroAmb').replaceChildren();
    delete q('heroAmb').dataset.key;
    const copy = q('heroCopy');
    copy.replaceChildren(el('div', 'hero-kicker', 'مانجا · مانهوا · مانها'), el('h3', 'hero-name', 'VANTARA'));
    q('heroDots').replaceChildren();
  }
  /** المواضع حول المختار مع إزاحة السحب الجارية (offset بوحدة «غلاف واحد»). */
  function layoutHero(offset, animate) {
    const n = state.heroItems.length;
    if (!n) return;
    for (const c of q('heroTrack').children) {
      if (!c.dataset.i) continue;
      let d = (Number(c.dataset.i) - state.heroIndex + n) % n;
      if (d > n / 2) d -= n;
      c.dataset.pos = String(d);
      c.tabIndex = d === 0 ? 0 : -1;
      c.setAttribute('aria-hidden', String(Math.abs(d) > 1));
      placeCover(c, d - offset, animate);
    }
  }
  function heroPosition(anim = true) {
    const items = state.heroItems;
    const n = items.length;
    if (!n) return;
    state.heroIndex = ((state.heroIndex % n) + n) % n;
    layoutHero(0, anim);
    paintHeroCopy(items[state.heroIndex], anim);
    paintHeroAmbient(items[state.heroIndex]);
  }
  function heroNext() {
    if (!state.heroItems.length) return;
    state.heroIndex += 1;
    heroPosition(true);
  }
  function heroPrev() {
    if (!state.heroItems.length) return;
    state.heroIndex -= 1;
    heroPosition(true);
  }
  function heroGoLogical(i) {
    state.heroIndex = i;
    heroPosition(true);
    restartHero();
  }
  function bindHero() {
    const hero = q('hero');
    if (hero.dataset.bound) return;
    hero.dataset.bound = '1';
    const stage = q('heroTrack');
    let lastX = 0, lastT = 0, velocity = 0, frame = 0;
    const step = () => heroGeometry().x[1];
    const start = (x) => {
      if (!state.heroItems.length) return;
      state.heroDragging = true;
      state.heroStartX = lastX = x;
      lastT = performance.now();
      velocity = 0;
      state.heroDeltaX = 0;
      hero.classList.add('dragging');
      clearInterval(state.heroTimer);
    };
    const move = (x) => {
      if (!state.heroDragging) return;
      const now = performance.now();
      velocity = (x - lastX) / Math.max(1, now - lastT);
      lastX = x;
      lastT = now;
      state.heroDeltaX = x - state.heroStartX;
      // الأغلفة تتبع الإصبع نفسه: سحب مسافة غلاف يجلب الغلاف التالي إلى الوسط
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => layoutHero(state.heroDeltaX / step(), false));
    };
    const end = () => {
      if (!state.heroDragging) return;
      state.heroDragging = false;
      cancelAnimationFrame(frame);
      hero.classList.remove('dragging');
      // المسافة تحدد كم غلافًا، والنفضة القصيرة السريعة غلافًا واحدًا فقط: لا تخطٍّ لم يقصده الإصبع
      let shift = Math.round(state.heroDeltaX / step());
      if (!shift && (Math.abs(velocity) > 0.35 || Math.abs(state.heroDeltaX) > 24)) shift = Math.sign(state.heroDeltaX || velocity);
      shift = Math.max(-3, Math.min(3, shift));
      state.heroIndex += shift;
      if (shift) heroPosition(true);
      else layoutHero(0, true);
      setTimeout(() => (state.heroDeltaX = 0), 0);
      restartHero();
    };
    stage.addEventListener('touchstart', (e) => start(e.touches[0].clientX), { passive: true });
    stage.addEventListener('touchmove', (e) => move(e.touches[0].clientX), { passive: true });
    stage.addEventListener('touchend', end);
    stage.addEventListener('touchcancel', end);
    stage.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch') start(e.clientX);
    });
    stage.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'touch') move(e.clientX);
    });
    stage.addEventListener('pointerup', (e) => {
      if (e.pointerType !== 'touch') end();
    });
    stage.addEventListener('pointerleave', (e) => {
      if (e.pointerType !== 'touch') end();
    });
    stage.addEventListener('pointercancel', (e) => {
      if (e.pointerType !== 'touch') end();
    });
    stage.addEventListener('dragstart', (e) => e.preventDefault());
    // تغيّر عرض الشاشة يغيّر المسافات: تُعاد المواضع بلا حركة
    globalThis.addEventListener?.('resize', () => layoutHero(0, false), { passive: true });
  }
  function restartHero() {
    clearInterval(state.heroTimer);
    // يلفّ والرئيسية أمامك فقط: لا حركة في صفحة مخفية ولا والتطبيق في الخلفية
    if (state.heroItems.length > 1) state.heroTimer = setInterval(() => currentPage() === 'home' && root.dataset.section === 'manga' && !document.hidden && heroNext(), 5200);
  }

  // ───────────────────────── صفحة العمل ─────────────────────────

  async function openWork(work, { readNumber = null, readLanguage = null, expectedChapter = null, autoRead = false } = {}) {
    // كيان داخلي (فحص/اختبار) لا يُفتح كعمل أبدًا
    if (/^__/.test(String(work?.id ?? ''))) return;
    // عملٌ فُتح من نتائج بحث مكتوب: هذا ما قصدته، فيُحفظ في «آخر ما بحثت عنه»
    if (currentPage() === 'search' && searchTerm) rememberSearch(searchTerm);
    // أنمي (ترشيح، إشعار، حضور…): صفحته في قسم الأنمي، لا صفحة مانجا بنفس العنوان
    if (isAnimeRef(String(work?.id ?? ''))) return openAnimeRef(String(work.id), { title: titleOf(work), cover: work.coverImage?.large ?? null });
    if (String(work?.id ?? '').startsWith('cinema:')) return openCinemaRef(String(work.id), { title: titleOf(work), cover: work.coverImage?.large ?? null });
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
    state.chapterRange = null;
    if (work._work?.editions?.length) rememberWork(work);
    showPage('detail');
    mountDetail();
    renderDetail(work);
    renderChaptersLoading();
    if (!work._work?.editions?.length) {
      // عملٌ من المكتبة على جهاز آخر: نُسخه لم تُحفظ هنا، فيُبحث عنه بعنوانه
      try {
        const { items } = await browse({ query: titleOf(work), keepWestern: true });
        const found = matchingWork(items, work);
        if (found && state.current === work) {
          // المرجع يبقى مرجعك: مكتبتك وتقدّمك مربوطان به لا بمفتاح النتيجة
          const kept = { ...found, id: work.id, _work: { ...found._work, key: work._work.key } };
          // مرجع «الأكثر قراءة» (اسم AniList) ومرجع المصادر عمل واحد: المكتبة والتقدّم يُقرآن من الاثنين
          if (String(found.id) !== String(work.id)) noteRefAliases([[String(work.id), String(found.id)]]);
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
      if (await showAddMangaSource(q('chapterPanel'))) { setReadCta(null); return; }
      if (state.current !== work) return;
      emptyState(q('chapterPanel'), {
        icon: 'search',
        title: 'ما وصلنا للمصادر الحين',
        text: 'نحاول مرة ثانية بعد لحظة، أو المسها الحين.',
        action: { label: 'أعد المحاولة', icon: 'refresh', run: () => void openWork(work, { readNumber, readLanguage, expectedChapter }) },
      });
      setReadCta(null);
      return;
    }
    // VANTARA: الفصول المحفوظة فورًا، وكل مصدر يردّ يضيف ما عنده بصمت
    let wanted = readNumber;
    const tryWanted = (w, final) => {
      if (wanted === null) return;
      const row = requestedChapterRow(w,wanted,{arabicOnly:readLanguage==='ar'});
      if (row) {
        wanted = null;
        openChapter(w, row);
      } else if (final) {
        const number=wanted;wanted = null;
        toast(readLanguage==='ar'?`الفصل ${number} غير متاح في المصادر العربية حاليًا؛ قد يكون مقفلًا عند المصدر`:'هالفصل مو متوفر في مصادرنا الحين');
      }
    };
    const show = (full, { settled }) => {
      if (state.current?.id !== work.id) return;
      if (!full._chapters?.length && !settled) return;
      // والقارئ مفتوح: تُحفظ النسخة الأحدث (يقرؤها القارئ بـgetWork) بلا رسم الصفحة التي خلفه
      if (currentPage() === 'reader') { state.current = full; return; }
      // الصفحة تتحرك (تدخل أو تغادر): تُرسم الفصول حين تنتهي الحركة، لا في منتصفها (page-motion.js: afterMotion)
      const page = q('detail');
      if (motionActive(page)) return void afterMotion(page, () => { if (state.current?.id === work.id && currentPage() === 'detail') show(state.current?._chapters ? state.current : full, { settled }); });
      // غادرها المستخدم: تُحفظ النسخة الأحدث بلا رسم صفحة لا تُرى
      if (currentPage() !== 'detail') { state.current = full; return; }
      const first = !state.current?._chapters;
      state.current = full;
      // غلافٌ عرفته التفاصيل تجرّبه البطاقات التي بقيت بلا غلاف، حالًا لا بعد الرجوع
      if (full._work?.thumbnailUrl) announceCover(String(full.id), full._work.thumbnailUrl);
      if (first || full._work?.thumbnailUrl !== work._work?.thumbnailUrl) renderDetail(full);
      else refreshDetailMeta(full);
      renderSources(full);
      renderChapters(full);
      tryWanted(full, settled);
      // «اقرأ الآن» من الرئيسية: ما يفعله زر القراءة هنا تمامًا (تابع من حيث وقفت، أو ابدأ)، مرة واحدة
      if (autoRead && state.nextRow && currentPage() === 'detail') { autoRead = false; readNow(); }
      if(settled&&expectedChapter!==null&&!requestedChapterRow(full,expectedChapter,{arabicOnly:true}))toast(`الفصل ${expectedChapter} غير متاح للقراءة في المصادر العربية التي أجابت`);
    };
    try {
      const full = await loadWork(work, { onUpdate: show, requestedChapter: expectedChapter??readNumber, arabicOnly: readLanguage==='ar' });
      if (state.current?.id !== work.id) return;
      // ما عُرف من نسخ وغلاف يُحفظ للبطاقات وللأجهزة الأخرى
      rememberWork(full);
      if (!full._chapters?.length) {
        // مصدرٌ ردّ بلا فصول ليس مصدرًا صامتًا: نقول ما حدث فعلًا ولكل مصدر سببه
        const failed = full._failedSources ?? [];
        emptyState(q('chapterPanel'), {
          icon: 'offline',
          error: true,
          title: 'تعذّر جلب الفصول',
          text: failed.length
            ? failed.map((f) => `${displayName(f.label, f.sourceId)}: ${f.reason ?? 'لم يرد في الوقت'}`).join(' · ')
            : 'ردّت المصادر، ولا فصول فيها لهذا العمل الآن.',
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
  /**
   * هيكل صفحة العمل بالنمط المختار في الإعدادات (manga-work.js). يُبنى عند كل فتح عمل؛ التحديثات بعده
   * (وصول الفصول، المكتبة، التقييم) تملأ العناصر نفسها بلا إعادة بناء.
   */
  let unbindMangaDepth = () => {};
  const desktopPointer = globalThis.matchMedia?.('(min-width: 1024px) and (hover: hover) and (pointer: fine)') ?? null;
  let classicDock = null;
  function mountDetail() {
    unbindMangaDepth();
    closeDetailMenu();
    state.marking = null;
    const page = q('detail');
    // «النمط الموحد» (الإعدادات): هيكل «المعرض» بلبوس unified-look.css، بلا عمق تمرير
    const unified = unifiedLookOn();
    const look = unified ? 'gallery' : mangaLook(workStyleOf('manga'));
    page.dataset.look = look;
    if (unified) page.dataset.unified = '';
    else delete page.dataset.unified;
    // «ويبتوني» يبني على أساس «المعرض» (data-base) ويختلف بقواعده
    if (TABBED_LOOKS.includes(look)) page.dataset.base = 'gallery';
    else delete page.dataset.base;
    classicDock?.destroy();
    classicDock = null;
    page.innerHTML = detailMarkup(look, { glyph, iconButton });
    state.detailLook = look;
    // «كلاسيكي» هو صفحة Stable كما هي، وعلى الكمبيوتر كانت عمودين: الغلاف وأفعاله عمود يلتصق بالشاشة بجانب
    // الاسم والفصول (side-dock.js). سقط الاستدعاء مع الأنماط فصار الغلاف بنصف الشاشة وما حوله فارغ؛ يُعاد له
    // وحده، على شاشة الفأرة وحدها (قانون الكمبيوتر). الجوال واللمس: العناصر في أماكنها حرفيًا.
    if (look === 'page' && !unified) {
      classicDock = sideDock(
        () => [q('detailCover'), page.querySelector('.detail-cta'), page.querySelector('.detail-quick'), q('detailProgress')],
        { query: desktopPointer, className: 'detail-side' },
      );
    }
    state.chapterQuery = '';
    // عمق التمرير من جدول depth.js كبقية الأقسام؛ لكل نمط مانجا صفه (قرار المالك). البطل: أول مسرح في النمط
    const stage = page.querySelector('.mw-stage, .mw-ban, .mw-resume, .detail-head');
    unbindMangaDepth = mountDepth('manga', unified ? 'unified' : look, { hero: stage ?? page, scope: unified ? '.v35 #detail[data-look][data-unified]' : `.v35 #detail[data-look='${look}']`, styleId: 'mw-motion', prefix: 'mw', hostOf: (h) => h?.closest('#detail'), spanOf: () => stage?.offsetHeight ?? 0, active: () => currentPage() === 'detail' });
    if (TABBED_LOOKS.includes(look)) bindDetailTabs();
    bindChapterSearch();
    paintDetailTools();
  }
  const lookIs = (look) => state.detailLook === look;
  function bindChapterSearch() {
    const input = q('chapterSearch');
    if (!input) return;
    let timer = null;
    input.oninput = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        state.chapterQuery = input.value;
        if (state.current?._chapters) renderChapters(state.current);
      }, 120);
    };
  }
  /** «★ 8.4 · 201 فصلًا · 2018» (أو ثلاثة أرقام كبيرة في «الملف»). التقييم من AniList حين يُعرف. */
  function paintStats(w) {
    const host = q('detailStats');
    if (!host) return;
    const n = w._chapters ? countMainChapters(w._chapters) : Number(w.chapters) || 0;
    // «كلاسيكي»: عدد الفصول الصحيحة كبيرًا كرقم صفحة (Stable)
    const folio = q('detailFolio');
    if (folio) folio.replaceChildren(el('b', null, n ? String(n) : '—'), ...(n ? [el('span', null, n === 1 ? 'فصل' : n === 2 ? 'فصلان' : n <= 10 ? 'فصول' : 'فصلًا')] : []));
    const year = w.startDate?.year ?? null;
    const ref = String(w.id);
    // حقائق من عدة مصادر (lib/manga-facts.js): الحالة بالتصويت، والتقييم من AniList أو MAL؛ وما لا تقييم له
    // يأخذ تقييم السيرفر من 5 (متوسط مستخدمي VANTARA، يبدأ 0) — لا شرطة أبدًا (قرار المالك، 9 نوفمبر)
    const facts = state.detailFacts?.ref === ref ? state.detailFacts : null;
    if (!facts) {
      state.detailFacts = { ref, status: null, score: null, server: null };
      const title = w._work?.title || w.title?.english || w.title?.romaji || titleOf(w);
      void Promise.all([
        import('../lib/manga-facts.js').then((m) => m.mangaFacts({ ref, title, alStatus: w.status, alScore: w.averageScore })).catch(() => null),
        sync.ratingsAvg?.(refsOf(ref)) ?? null,
      ]).then(([f, srv]) => {
        if (state.detailFacts?.ref !== ref) return;
        Object.assign(state.detailFacts, { status: f?.status ?? null, score: f?.score ?? null, server: srv ? Number(srv.score) || 0 : 0 });
        if (state.current && String(state.current.id) === ref) { paintStats(state.current); renderInfo(state.current); }
      });
    }
    const status = facts?.status ?? w.status;
    const fromSources = Number(w.averageScore) > 0 ? Number(w.averageScore) / 10 : state.detailScore?.ref === ref ? state.detailScore.score : null;
    const known = fromSources ?? facts?.score ?? null;
    const server = known == null && facts?.server != null ? facts.server : null;
    // التقييم يُسأل عنه مرة: «جارٍ» يحجز مكانه فلا يدفع ما بجانبه حين يصل
    const pending = !(Number(w.averageScore) > 0) && !(state.detailScore?.ref === ref && state.detailScore.done);
    const chaptersWord = n === 1 ? 'فصل' : n === 2 ? 'فصلان' : n <= 10 ? 'فصول' : 'فصلًا';
    const reserve = (node) => {
      node.classList.add('mw-hold');
      return node;
    };
    if (lookIs('profile')) {
      // ثلاث خانات ثابتة دائمًا: ما لم يُعرف بعد شرطة في مكانه
      const cell = (value, label, star = false) => {
        const d = el('div');
        const b = el('b');
        if (star && value !== '—') b.innerHTML = '<span class="mw-star">★</span> ';
        b.append(String(value));
        d.append(b, el('small', null, label));
        return d;
      };
      host.replaceChildren(
        cell(known ? known.toFixed(1) : (server ?? 0).toFixed(1), known ? 'التقييم' : 'تقييم VANTARA من 5', true),
        cell(n || '—', n ? chaptersWord : 'فصلًا'),
        cell(STATUS_AR[status] ?? '—', year ? String(year) : 'الحالة'),
      );
    } else {
      const parts = [];
      {
        const s = el('span');
        s.innerHTML = '<span class="mw-star">★</span> ';
        s.append(el('b', null, known ? known.toFixed(1) : (server ?? 0).toFixed(1)));
        if (!known && server != null) s.append(' من 5');
        parts.push(known || server != null || !pending ? s : reserve(s));
      }
      const c = el('span');
      c.append(el('b', null, n ? String(n) : '000'), ` ${n ? chaptersWord : 'فصلًا'}`);
      parts.push(n ? c : reserve(c));
      if (year) parts.push(el('span', null, String(year)));
      host.replaceChildren(...parts);
    }
    if (!(Number(w.averageScore) > 0) && state.detailScore?.ref !== ref) {
      state.detailScore = { ref, score: null, done: false };
      void ratingFor(w._work?.title || w.title?.english || titleOf(w)).then((rated) => {
        if (state.detailScore?.ref !== ref) return;
        state.detailScore.done = true;
        if (rated?.score && !rated.adult) state.detailScore.score = rated.score;
        if (state.current && String(state.current.id) === ref) paintStats(state.current);
      });
    }
  }
  /** «مانهوا · مكتمل»: نوع العمل إن عُرف بلده، وحالته؛ وإلا تصنيفه الأول. */
  /** الحالة بعد تصويت المصادر (manga-facts) متى وصلت، وإلا ما قاله AniList. */
  const statusOf = (w) => (state.detailFacts?.ref === String(w?.id) && state.detailFacts.status) || w?.status;
  function kickerOf(w) {
    const kind = { KR: 'مانهوا', JP: 'مانجا', CN: 'مانها' }[w.countryOfOrigin] ?? null;
    const parts = [kind, STATUS_AR[statusOf(w)]].filter(Boolean);
    return parts.length ? parts.join(' · ') : (w.genres || []).slice(0, 1).map(genreAr).join('');
  }
  /** القصة: هيكل ثلاثة أسطر حتى تصل النبذة، ثم النص في المساحة نفسها (لا إزاحة). */
  function paintStory(w) {
    const text = clean(w.description);
    const d = q('description');
    const more = q('moreToggle');
    if (w.description === undefined && !text) {
      d.innerHTML = '<span class="mw-skel-lines" aria-hidden="true"><i></i><i></i><i></i></span>';
      d.classList.add('clamped');
      more.hidden = false;
      more.classList.add('mw-hold');
      return;
    }
    d.textContent = text || 'لا توجد نبذة من المصدر.';
    d.classList.add('clamped');
    more.textContent = 'المزيد';
    more.hidden = false;
    // «المزيد» يحجز سطره دائمًا: يختفي بالشفافية لا من التخطيط
    more.classList.add('mw-hold');
    requestAnimationFrame(() => more.classList.toggle('mw-hold', d.scrollHeight <= d.clientHeight + 2));
  }
  /** العدد والتصنيف والنبذة تتحدّث مكانها، بلا إعادة الغلاف ولا قفزة. */
  function refreshDetailMeta(w) {
    paintStats(w);
    const kick = q('detailKicker');
    if (kick) kick.textContent = kickerOf(w);
    paintStory(w);
    renderInfo(w);
  }
  function renderDetail(w) {
    const title = titleOf(w);
    q('detailTitle').textContent = title;
    q('detailTopTitle').textContent = title;
    const kick = q('detailKicker');
    if (kick) kick.textContent = kickerOf(w);
    const who = q('detailWho');
    if (who) who.textContent = unique((w.staff?.edges || []).map((e) => e.node?.name?.full).filter(Boolean)).join(' · ');
    paintStats(w);
    q('detailGenres').replaceChildren(...(w.genres || []).slice(0, 4).map((x) => el('span', 'mw-chip', genreAr(x))));

    const cover = q('detailCover');
    if (cover.dataset.for !== String(w.id)) {
      cover.dataset.for = String(w.id);
      const glow = q('detailGlow');
      glow?.classList.remove('ready');
      glow?.removeAttribute('src');
      // الغلاف والبنر يُحسمان في الخفاء ثم يظهران مرة واحدة (lib/manga-art.js): AniList أولًا، والمصدر فقط إن
      // كان أعلى جودة فعلًا. ما حُسم يُحفظ للعمل فلا يتبدل في الفتحة التالية. الهيكل حتى ذلك.
      const banner = q('detailBanner');
      const bannerBox = banner?.closest('.mw-ban');
      banner?.classList.remove('ready');
      bannerBox?.classList.remove('mw-ban--art', 'mw-ban--cover');
      const ref = String(w.id);
      const live = () => cover.isConnected && cover.dataset.for === ref && String(state.current?.id) === ref;
      const paintArt = (art) => {
        if (!live()) return;
        // النسبة الحقيقية للغلاف المحسوم: مكانه بمقاسه بلا فراغ فوقه أو تحته ولا قص. تُحسم قبل أن تُرى الصفحة فقط:
        // بعدها يبقى مقاسه كما ظهر (كان يتغير 12px حين يصل الغلاف متأخرًا فيتحرك كل ما تحته)، ويُعرض الغلاف كاملًا داخله
        const ratio = artRatio(art);
        const shown = workShown() && currentPage() === 'detail';
        const fit = Boolean(ratio) && shown && cover.style.getPropertyValue('--art-ratio') !== ratio;
        if (ratio && !shown) cover.style.setProperty('--art-ratio', ratio);
        const img = new Image();
        img.alt = '';
        img.decoding = 'async';
        img.classList.add('img-fade');
        if (fit) img.classList.add('mw-fit');
        img.onerror = () => { if (live()) void mountImage(cover, w, { final: true }); workReady(); };
        // الغلاف المحسوم جاهز للعرض = أساس الصفحة جاهز: يبدأ الانتقال
        img.onload = () => { if (live()) workReady(); };
        img.src = cachedCover(art.cover) ?? art.cover;
        cover.replaceChildren(img);
        for (const g of document.querySelectorAll('#detail [id="detailGlow"]')) {
          g.onload = () => g.classList.add('ready');
          g.src = art.cover;
        }
        if (banner) {
          bannerBox?.classList.toggle('mw-ban--art', art.wide);
          bannerBox?.classList.toggle('mw-ban--cover', !art.wide);
          banner.onload = () => { if (live()) banner.classList.add('ready'); };
          banner.onerror = () => { if (live() && banner.getAttribute('src') !== art.cover) { bannerBox?.classList.replace('mw-ban--art', 'mw-ban--cover'); banner.src = art.cover; } };
          banner.src = art.banner || art.cover;
        }
      };
      // القرار نفسه الذي رسمته البطاقة (lib/art.js): محسوم غالبًا قبل الفتح، فيظهر فورًا بنسبته
      const known = art.get(ref);
      if (known) paintArt(known);
      else {
        cover.replaceChildren(imageLoadingNode());
        void decideArt(w).then((d) => {
          if (!live()) return;
          if (!d?.cover) { workReady(); return void mountImage(cover, w, { final: true }); }
          rememberCover(ref, d.cover);
          paintArt(d);
        });
      }
    }
    paintStory(w);
    refreshLibraryDetail();
    paintSimilarTab(w);
    renderInfo(w);
    const insightHost = q('detailInsights');
    if (insightHost.dataset.ref !== String(w.id)) {
      insightHost.dataset.ref = String(w.id);
      insightHost.replaceChildren();
      void paintWorkInsights(insightHost, { sync, ref: String(w.id), openProfile });
    }
  }
  function toggleSummary() {
    const d = q('description');
    const clamped = d.classList.toggle('clamped');
    q('moreToggle').textContent = clamped ? 'المزيد' : 'أقل';
  }
  /**
   * «الترجمة العربية» في قائمة «المزيد»: تظهر فقط لعملٍ فيه فصول إنجليزية والترجمة مفعّلة في الإعدادات.
   * مفعّلة = كل فصل إنجليزي تدخله يجهّز 30% منه بالعربي أولًا.
   */
  function translateAvailable(w) {
    return Boolean(w?._chapters?.some((c) => c.lang === 'en')) && readTranslateSettings().enabled && supports('translation');
  }
  function renderTranslateToggle(w) {
    if (state.current === w && currentPage() === 'detail') paintDetailMenu();
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
    if (!diagnosticsUi.visible()) return;
    let benchmarks = [];
    let engines = null;
    let cleaning = null;
    const sec = (ms) => (ms === null || ms === undefined ? '—' : `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} ث`);
    const build = (body) => {
      body.dataset.diagnosticSheet = '';
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
      if (s.errors || s.repairs) {
        const failures = Object.entries(s.errorCodes ?? {}).map(([k, v]) => `${k}×${v}`).join(' · ');
        body.append(el('p', null, `محاولات منفصلة عن السرعة: فشل ${s.errors} · إصلاح ${s.repairs}${failures ? ` · ${failures}` : ''}`));
      }
      if (cleaning?.perf) {
        const k = cleaning.perf.counts ?? {};
        const mask = k.eraseMaskPixels ?? 0;
        const changed = k.eraseChangedPixels ?? 0;
        const pct = mask ? Math.round((changed / mask) * 100) : 0;
        body.append(el('p', null, `اختبار التبييض المحلي: ${cleaning.cleanedRegions ?? 0} منطقة · القناع ${mask} بكسل · تغيّر فعلًا ${changed} (${pct}%) · تعبئة ${k.fillChangedPixels ?? 0} · LaMa ${k.inpaintChangedPixels ?? 0}`));
        body.append(el('p', null, 'ملفات النماذج اجتازت SHA-256 قبل تشغيل هذا الفحص؛ نجاح الزر يعني أننا لا نختبر ملف وزن ناقصًا أو متبدّلًا.'));
        if ((k.inpaint ?? 0) > 0 && (k.inpaintChangedPixels ?? 0) === 0) body.append(el('p', null, '⚠️ LaMa استُدعي ولم يغيّر أي بكسل — هذه إشارة مباشرة لمشكلة في الترميم/النموذج.'));
        if ((k.fill ?? 0) > 0 && (k.fillChangedPixels ?? 0) === 0) body.append(el('p', null, '⚠️ مسار التعبئة اشتغل لكن لم يغيّر أي بكسل.'));
        if (cleaning.path) {
          const img = document.createElement('img');
          const convert = globalThis.Capacitor?.convertFileSrc;
          img.src = convert ? convert(cleaning.path) : cleaning.path;
          img.alt = 'ناتج التبييض قبل رسم العربية';
          img.style.cssText = 'display:block;width:100%;max-height:52vh;object-fit:contain;border-radius:12px;margin:10px 0;background:#111';
          body.append(img, el('p', null, '↑ هذه الصفحة بعد التبييض فقط وقبل رسم العربي. إذا بقي الإنجليزي هنا فالعلة محلية في الكشف/القناع/Cleaner/LaMa، وليست Luna.'));
          if (cleaning.width !== cleaning.fullWidth || cleaning.height !== cleaning.fullHeight) body.append(el('p', null, `ملاحظة: التشخيص على دقة التحليل ${cleaning.width}×${cleaning.height}، والأصل ${cleaning.fullWidth}×${cleaning.fullHeight}.`));
        }
      }
      for (const b of benchmarks) {
        body.append(el('p', null, `القديم ${sec(totalOf(b.legacy))} ← الجديد ${sec(totalOf(b.current))} · ${b.identical ? 'الناتج متطابق بكسلًا بكسلًا' : 'الناتج مختلف!'}`));
      }
      const cleanProbe = el('button', 'btn btn-secondary btn-block', 'اختبر التبييض فعليًا');
      cleanProbe.type = 'button';
      cleanProbe.onclick = async () => {
        const candidates = readPerf().filter((e) => e.path && e.hash && e.translated > 0).slice(-30);
        const page = [...candidates].reverse().find((e) => (e.native?.render?.counts?.inpaint ?? 0) > 0) ?? candidates.at(-1);
        if (!page) return toast('ترجم صفحة فيها حوار أولًا');
        const saved = await cachedPage(page.hash, page.cacheKey);
        const regions = (saved?.regions ?? []).filter((r) => typeof r.arabic === 'string' && r.arabic.trim()).map((r) => ({ id: r.id, arabic: r.arabic.trim() }));
        if (!regions.length) return toast('ما لقيت عربي محفوظ لهالصفحة');
        const leave = (saved?.regions ?? []).filter((r) => ['sfx', 'credit', 'sign'].includes(r.kind)).map((r) => r.id);
        cleanProbe.disabled = true;
        cleanProbe.textContent = 'نفحص النماذج والتبييض…';
        cleaning = await diagnoseCleaning({ path: page.path, regions, leave, chapterKey: page.chapterKey, pageIndex: page.pageIndex }).catch(() => null);
        if (!cleaning) toast('فشل تشخيص التبييض — انسخ التقرير بعد تجربة صفحة ثانية');
        refresh();
      };
      body.append(cleanProbe);
      body.append(el('p', null, 'الفحص أعلاه يعيد تشغيل نماذج أندرويد المحلية ويوقف الصورة بعد المسح وقبل العربي؛ هذا هو الاختبار المباشر للتبييض.'));
      const bench = el('button', 'btn btn-secondary btn-block', 'قِس المسار القديم مقابل الجديد');
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
          const saved = await cachedPage(e.hash, e.cacheKey);
          const regions = (saved?.regions ?? []).filter((r) => typeof r.arabic === 'string' && r.arabic).map((r) => ({ id: r.id, arabic: r.arabic }));
          const res = await benchmarkPage({ path: e.path, regions }).catch(() => null);
          if (res) benchmarks.push({ page: `${e.chapterKey?.split('#').pop() ?? ''}#${e.pageIndex}`, ...res });
        }
        if (!benchmarks.length) toast('القياس يحتاج تحديث التطبيق، أو ملفات الصفحات انمسحت');
        refresh();
      };
      body.append(bench);
      for (const line of engineLines(engines)) body.append(el('p', null, line));
      const tune = el('button', 'btn btn-secondary btn-block', 'قِس CTD والفقاعات');
      tune.type = 'button';
      tune.onclick = async () => {
        // أطول صفحة فيها حوار ترجمتها (فيها أكثر مربعات، والفرق يظهر أوضح)
        const page = readPerf()
          .filter((e) => e.path && e.translated > 0)
          .slice(-20)
          .sort((a, b) => (b.native?.analyze?.counts?.glyphTiles ?? 0) - (a.native?.analyze?.counts?.glyphTiles ?? 0))[0];
        if (!page) return toast('ترجم صفحة فيها حوار أولًا');
        tune.disabled = true;
        tune.textContent = 'نقيس CTD والفقاعات… (دقيقتان تقريبًا)';
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
          await navigator.clipboard.writeText(formatReport(readPerf(), benchmarks, engines, cleaning));
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
        engines = null;
        cleaning = null;
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
  function openTranslateAhead(w, preset = null) {
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
        // رفيق حدّد النطاق (بعد آخر فصل عربي إلى آخر إنجليزي): يبدأ منه، وتقدر تعدّله
        if (preset && preset.to >= r.min && preset.from <= r.max) {
          from.input.value = String(Math.max(r.min, preset.from));
          to.input.value = String(Math.min(r.max, preset.to));
          preset = null;
        }
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
      ['الحالة', STATUS_AR[statusOf(w)]],
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
    grid.hidden = pairs.length === 0;
  }
  function chapterMessage(text) {
    q('chapterPanel').replaceChildren(el('div', 'no-data', text));
  }
  function renderChaptersLoading() {
    const count = q('chapterCount');
    if (count) count.textContent = ' ';
    // كل ما سيظهر مع الفصول يحجز مكانه الآن بهيكل بشكله (لا شيء يدفع غيره حين تصل)
    const src = q('sourcesBlock');
    src.hidden = false;
    q('sourceRow').replaceChildren(...[96, 84, 92].map((wpx) => {
      const chip = el('span', 'source-chip skeleton');
      chip.style.width = `${wpx}px`;
      return chip;
    }));
    const progress = q('detailProgress');
    if (progress) {
      progress.hidden = false;
      q('progressFill').style.width = '0%';
      q('progressText').textContent = ' ';
      q('progressNote').textContent = '';
    }
    const ranges = q('chapterRanges');
    if (ranges) {
      ranges.hidden = false;
      ranges.replaceChildren(...[0, 1, 2, 3].map(() => el('span', 'mw-range-skel skeleton')));
    }
    // الهيكل بعدد ما سيأتي: نطاق كامل (50) في الشبكة إن عُرف أن الفصول أكثر، وإلا عددها
    const grid = lookIs('resume');
    const known = Number(state.current?.chapters) || 0;
    const cells = known ? Math.min(50, known) : 30;
    const list = el('div', grid ? 'mw-grid' : 'mw-chs');
    list.setAttribute('aria-busy', 'true');
    for (let i = 0; i < (grid ? cells : 8); i++) {
      if (grid) list.append(el('span', 'mw-cell skeleton'));
      else {
        const row = el('div', 'mw-ch mw-ch--skel');
        row.innerHTML = '<span class="mw-ch-open"><span class="n"></span><span class="t"><span class="skeleton-line" style="width:40%;margin:0"></span><span class="skeleton-line" style="width:24%"></span></span></span>';
        list.append(row);
      }
    }
    q('chapterPanel').replaceChildren(list);
    setReadCta(undefined);
  }

  const chapterNumberText = (r) => (Number.isFinite(r?.number) && r.number >= 0 ? String(Math.round(r.number * 10) / 10) : '—');
  /** اسمٌ لا يزيد على الرقم («الفصل 48»، «Chapter 48») لا يُكرَّر: يُكتب «الفصل 48» بالعربي. */
  const plainChapterName = (name) => !name || /^\s*(?:الفصل|فصل|chapter|ch\.?|ep\.?)?\s*#?\s*[\d.]+\s*$/i.test(name);

  /**
   * زرّ القراءة: «ابدأ» لمن لم يقرأ، «تابع» لمن قرأ، ومعه الفصل الذي سيُفتح ومصدره («الفصل 143 · Team X»).
   * `undefined` = الفصول تُجمع، `null` = لا فصول. «من حيث وقفت» يكتب رقم الفصل كبيرًا فوقه.
   */
  function setReadCta(next, { started = false } = {}) {
    const btn = q('readCta');
    const label = q('readCtaLabel');
    const sub = q('readCtaSub');
    if (!btn) return;
    btn.disabled = !next;
    // سطر الفصل يحجز مكانه دائمًا: الاسم لا يقفز للأعلى حين يصل
    sub.textContent = '\u00a0';
    const resume = lookIs('resume');
    if (next === undefined) label.textContent = 'جارٍ جمع الفصول';
    else if (next === null) {
      label.textContent = 'لا فصول متاحة';
      if (q('sourceRow')?.querySelector('.skeleton')) q('sourcesBlock').hidden = true;
      if (q('chapterRanges')?.querySelector('.skeleton')) q('chapterRanges').hidden = true;
    }
    else {
      label.textContent = resume ? (started ? 'تابع الآن' : 'ابدأ الآن') : started ? 'تابع القراءة' : 'ابدأ القراءة';
      const name = next.chapter?.name || '';
      const from = next.chapter?.scanlator || (state.current?._sources ?? []).find((x) => x.sourceId === next.sourceId)?.label || '';
      sub.textContent = [plainChapterName(name) ? `الفصل ${chapterNumberText(next)}` : name, from].filter(Boolean).join(' · ') || '\u00a0';
    }
    if (resume) {
      q('resumeNum').textContent = next ? chapterNumberText(next) : '—';
      q('resumeKick').textContent = next && !started ? 'ابدأ من أول فصل' : 'تابع من حيث وقفت';
      q('resumeLabel').textContent = next && !started ? 'الفصل الأول' : 'الفصل التالي';
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
        b.append(el('span', null, displayName(f.label, f.sourceId)));
        const c = el('span', null, f.reason ?? 'لم يرد في الوقت');
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
    const refs = refsOf(ref);
    const rows = sync.rows('progress', (r) => r.user_id === userId && refs.includes(r.series_ref));
    if (!rows.length || !base.length) return null;
    // الترتيب من الأقدم للأحدث؛ مفتاح الفصل بمرجع صفّه نفسه (القديم إن كان منه)
    const ordered = [...base].sort((a, b) => (Number(a.number) || 0) - (Number(b.number) || 0));
    return continueChapter(rows, ordered, (row, chapter) => sameChapterKey(row.chapter_key, chapterKeyOf(row.series_ref, chapter)));
  }

  /** آخر مرة قرأت فيها هذا العمل (آخر تقدم محفوظ). */
  function lastReadAt(ref) {
    const userId = sync.user?.userId;
    const refs = refsOf(ref);
    return sync.rows('progress', (r) => r.user_id === userId && refs.includes(r.series_ref)).reduce((t, r) => Math.max(t, Number(r.updated_at) || 0), 0);
  }
  /** شريط التقدّم وسطره بصياغة النمط: «قرأت 142 من 201» ومعه آخر قراءة، أو ما بقي. */
  function paintProgress(w, readCount, total) {
    const box = q('detailProgress');
    if (!box) return;
    box.hidden = false;
    q('progressFill').style.width = `${Math.round((readCount / total) * 100)}%`;
    const left = total - readCount;
    const did = readCount ? `قرأت ${readCount} من ${total}` : 'لم تبدأ بعد';
    let note = '';
    let text = did;
    if (TABBED_LOOKS.includes(state.detailLook)) text = readCount && left ? `${did} · باقي ${countLabel(left, 'chapter')}` : did;
    else if (lookIs('resume')) note = left ? `باقي ${countLabel(left, 'chapter')}` : 'قرأته كله';
    else {
      const at = readCount ? lastReadAt(String(w.id)) : 0;
      note = at ? `آخر قراءة ${agoAr(at)}` : '';
    }
    q('progressText').textContent = text;
    q('progressNote').textContent = note;
  }
  /** نطاقات كل 50 («الملف» و«من حيث وقفت»): الأحدث أولًا مع ترتيب الفصول، ويُفتح على المختار أو الافتراضي. */
  function paintRanges(w, rows, next) {
    const host = q('chapterRanges');
    if (!host) return { groups: [], at: 0 };
    const groups = chapterGroups(rows.map((r) => Number(r.number)));
    host.hidden = groups.length < 2;
    if (groups.length < 2) {
      host.replaceChildren();
      return { groups: [], at: 0 };
    }
    // «من حيث وقفت» يفتح على نطاق فصلك؛ «الملف» على أول نطاق في الترتيب (الأحدث)
    const fallback = lookIs('resume') && next ? groupIndexOf(groups, Number(next.number)) : state.chapterNewestFirst ? groups.length - 1 : 0;
    const at = state.chapterRange !== null && state.chapterRange < groups.length ? state.chapterRange : fallback;
    const order = groups.map((_g, i) => i);
    if (state.chapterNewestFirst) order.reverse();
    host.replaceChildren(
      ...order.map((i) => {
        const [a, b] = groups[i];
        const btn = el('button', i === at ? 'on' : '');
        btn.type = 'button';
        btn.setAttribute('role', 'tab');
        btn.setAttribute('aria-selected', String(i === at));
        const label = el('bdi', null, `${a}–${b}`);
        label.dir = 'ltr';
        btn.append(label);
        btn.onclick = () => {
          state.chapterRange = i;
          renderChapters(w);
        };
        return btn;
      }),
    );
    return { groups, at };
  }

  function renderChapters(w) {
    const all = w._chapters ?? [];
    if (!all.length) {
      const count = q('chapterCount');
      if (count) count.textContent = '';
      chapterMessage('المصادر لم تُرجع فصولًا لهذا العمل.');
      setReadCta(null);
      return;
    }
    const ref = String(w.id);
    const read = (r) => isChapterRead(sync, ref, chapterKeyOf(ref, r));
    // «قرأت X من Y» بنفس عدّ الرأس (#323 U-23): الفصول الصحيحة فقط (الجانبية 128.1 والصفوف بلا رقم
    // تُعرض ولا تُعدّ)، وإلا ظهر «386 فصلًا» في الرأس و«قرأت 50 من 453» تحته. عمل بلا أرقام يُعدّ بصفوفه.
    const counted = mainChapters(all);
    const readCount = counted.filter(read).length;
    const base = state.chapterSource ? editionRows(w, state.chapterSource) : all;
    // «تابع» = آخر فصل كنت فيه فعلًا (آخر تقدم محفوظ)، ولو لم تُعلَّم الفصول قبله
    // مقروءة؛ أنهيته؟ فالذي بعده. ولا تقدم؟ فأول فصل غير مقروء من الأقدم.
    const next = continueRow(ref, base) ?? startChapter(base, read) ?? all[0];
    state.nextRow = next;
    setReadCta(next, { started: readCount > 0 });
    // الفصل الذي سيفتحه «ابدأ/تابع» يُجهَّز الآن، لا بعد الضغطة
    const warmKey = next ? `${next.sourceId}|${next.chapter?.url}|${next.chapter?.memo ?? ''}` : null;
    if (warmKey && warmKey !== state.warmKey && available()) {
      state.warmKey = warmKey;
      clearTimeout(state.warmTimer);
      state.warmTimer = setTimeout(() => warmChapter(engine, next), 600);
    }
    paintProgress(w, readCount, counted.length);
    paintStats(w);

    const rows = visibleRows(w);
    // العدد فصولٌ صحيحة فقط؛ الجانبية (128.1) تُعرض في القائمة ولا تُعدّ
    const main = countMainChapters(rows);
    q('chapterCount').textContent = main < rows.length ? `${countLabel(main, 'chapter')} · +${rows.length - main} جانبي` : countLabel(main, 'chapter');
    const sort = q('chapterSort')?.querySelector('span');
    if (sort) sort.textContent = state.chapterNewestFirst ? 'الأحدث أولًا' : 'الأقدم أولًا';
    const nextKey = chapterKeyOf(ref, next);
    const parts = [];
    for(const source of w._lockedSources??[]){
      const note=el('p','chapter-locked-note');
      note.innerHTML=glyph('lock');
      note.append(el('span',null,`في ${source.label} فصول مقفلة حتى الفصل ${source.lockedMax}`));
      parts.push(note);
    }
    const ranged = lookIs('profile') || lookIs('resume');
    const { groups, at } = ranged ? paintRanges(w, rows, next) : { groups: [], at: 0 };
    // البحث يشمل كل الصفوف لا الدفعة المعروضة: الفصل 300 من 2000 يظهر فورًا
    const pool = state.chapterQuery ? matchChapters(rows, state.chapterQuery) : rows;
    if (state.chapterQuery && !pool.length) parts.push(el('p', 'mw-find-empty', 'لا فصل بهذا الرقم أو الاسم'));
    const shown = ranged ? rowsInGroup(rows, groups, at) : pool.slice(0, state.chapterShown);
    if (lookIs('webtoon')) paintReleaseBeat(w, rows);
    const fragment = document.createDocumentFragment();
    if (lookIs('resume')) {
      const grid = el('div', 'mw-grid');
      for (const r of shown) fragment.append(chapterCell(w, r, read(r), chapterKeyOf(ref, r) === nextKey));
      grid.append(fragment);
      parts.push(grid);
    } else {
      const list = el('div', 'mw-chs');
      // «ويبتوني»: الفصول خط زمني، والشهر محطة عليه بعدد فصوله المعروضة
      const timeline = lookIs('webtoon');
      let month = null, head = null, inMonth = 0;
      const closeMonth = () => { if (head) head.append(el('small', null, countLabel(inMonth, 'chapter'))); };
      for (const r of shown) {
        if (timeline) {
          const m = monthOf(r.chapter?.dateUpload);
          if (m && m !== month) { closeMonth(); head = el('div', 'wt-month', m); fragment.append(head); month = m; inMonth = 0; }
          inMonth++;
        }
        const row = chapterRow(w, r, read(r), chapterKeyOf(ref, r) === nextKey);
        if (timeline && Date.now() - Number(r.chapter?.dateUpload) < 14 * 86_400_000) {
          row.classList.add('wt-new');
          row.querySelector('.t > b')?.append(el('span', 'wt-tag', 'جديد'));
        }
        fragment.append(row);
      }
      if (timeline) closeMonth();
      list.append(fragment);
      parts.push(list);
    }
    const rest = ranged ? 0 : pool.length - state.chapterShown;
    if (rest > 0) {
      const more = el('button', 'btn btn-secondary chapter-more', `اعرض ${countLabel(rest, 'chapter')} أخرى`);
      more.type = 'button';
      more.onclick = () => {
        state.chapterShown += 400;
        renderChapters(w);
      };
      parts.push(more);
    }
    const panel = q('chapterPanel');
    // أول فصول تحل محل الهيكل والصفحة ظاهرة: تظهر في مكانه بتلاشٍ واحد، لا دفعة
    const fromSkeleton = Boolean(panel.querySelector(':scope > [aria-busy="true"]'));
    panel.replaceChildren(...parts);
    if (fromSkeleton && currentPage() === 'detail') settleIn(panel);
  }
  // ── «علّم فصول»: وضع تحديد فوق القائمة أو الشبكة في الأنماط الأربعة ──
  // لمسة الفصل تحدّده بدل أن تفتحه؛ والشريط السفلي: مقروء، غير مقروء، كل ما قبله، ما بينهما.
  // الحفظ بالآلية نفسها (chapter.markMany في الطابور، والطبقة المتفائلة تعرضه فورًا).

  function enterMarkMode() {
    const w = state.current;
    if (!w?._chapters?.length) return toast('انتظر لين تجهز الفصول');
    state.marking = { picked: new Map() };
    const page = q('detail');
    page.classList.add('mw-marking');
    // «المعرض»: الفصول في تبويبها
    const tab = q('detailTabs')?.querySelector('[data-tab="chapters"]');
    if (tab && tab.getAttribute('aria-selected') !== 'true') tab.click();
    let bar = q('markBar');
    if (!bar) {
      bar = el('div', 'mw-selbar');
      bar.dataset.motionFixed = '';
      bar.id = 'markBar';
      bar.setAttribute('role', 'toolbar');
      bar.setAttribute('aria-label', 'علّم فصول');
      page.append(bar);
    }
    paintMarkBar();
    renderChapters(w);
    q('chapterPanel')?.scrollIntoView({ block: 'start', behavior: 'instant' });
    window.scrollBy({ top: -76, behavior: 'instant' });
  }
  function exitMarkMode() {
    if (!state.marking) return;
    state.marking = null;
    q('detail')?.classList.remove('mw-marking');
    q('markBar')?.remove();
    if (state.current?._chapters && currentPage() === 'detail') renderChapters(state.current);
  }
  function toggleMarkPick(w, r) {
    const key = chapterKeyOf(String(w.id), r);
    const picked = state.marking.picked;
    if (picked.has(key)) picked.delete(key);
    else picked.set(key, r);
    paintMarkBar();
    renderChapters(w);
  }
  function paintMarkBar() {
    const bar = q('markBar');
    const m = state.marking;
    if (!bar || !m) return;
    const w = state.current;
    const picked = [...m.picked.values()];
    const n = picked.length;
    const btn = (label, run, { primary = false, enabled = true } = {}) => {
      const b = el('button', `mw-selbtn${primary ? ' is-primary' : ''}`, label);
      b.type = 'button';
      b.disabled = !enabled;
      b.onclick = run;
      return b;
    };
    const head = el('div', 'mw-selhead');
    head.append(el('span', null, n ? `حدّدت ${countLabel(n, 'chapter')}` : 'المس الفصول لتحديدها'));
    const close = el('button', 'mw-selclose');
    close.type = 'button';
    close.innerHTML = glyph('close', { size: 20 });
    close.setAttribute('aria-label', 'أنهِ التحديد');
    close.onclick = exitMarkMode;
    head.append(close);
    const all = w?._chapters ?? [];
    const apply = (rows, read, done) => {
      if (!rows.length) return;
      const changed = markRows(w, rows, read, read ? latestChapter(rows) : null);
      exitMarkMode();
      toast(changed ? done(changed) : read ? 'كلها مقروءة من قبل' : 'ما فيها فصل معلّم');
    };
    const acts = el('div', 'mw-selacts');
    acts.append(
      btn('مقروء', () => apply(rowsForMark(all, picked), true, (c) => `علّمت ${countLabel(c, 'chapter')} مقروءة`), { primary: true, enabled: n > 0 }),
      btn('غير مقروء', () => apply(rowsForMark(all, picked), false, (c) => `ألغيت تعليم ${countLabel(c, 'chapter')}`), { enabled: n > 0 }),
      btn('كل ما قبله', () => apply(rowsForMark(all, picked, 'upTo'), true, (c) => `علّمت ${countLabel(c, 'chapter')} حتى الفصل ${chapterNumberText(picked[0])}`), { enabled: n === 1 }),
      btn('ما بينهما', () => {
        // يحدّد كل ما بين الفصلين، ثم تختار مقروء أو غير مقروء
        for (const r of rowsForMark(all, picked, 'between')) m.picked.set(chapterKeyOf(String(w.id), r), r);
        paintMarkBar();
        renderChapters(w);
      }, { enabled: n === 2 }),
    );
    bar.replaceChildren(head, acts);
  }
  /** علامة الفصل في نهاية صفّه: زرّ يعلّمه مقروءًا أو يلغيه، وشكله حالة الفصل. */
  function markButton(w, r, { isNext, onPaint }) {
    const ref = String(w.id);
    const eye = el('button', 'st');
    eye.type = 'button';
    const paint = (on) => {
      eye.classList.toggle('st--read', on);
      eye.setAttribute('aria-pressed', String(on));
      eye.innerHTML = on
        ? glyph('check', { size: 18 })
        : isNext
          ? '<span class="mw-here">وصلت هنا</span>'
          : isNewChapter(r, on)
            ? '<span class="mw-new">جديد</span>'
            : glyph('eye', { size: 18 });
      const label = on ? 'مقروء — المس لإلغاء التعليم' : 'علّمه مقروءًا';
      eye.setAttribute('aria-label', label);
      eye.title = label;
      onPaint(on);
    };
    eye.onclick = (e) => {
      e.stopPropagation();
      const on = !isChapterRead(sync, ref, chapterKeyOf(ref, r));
      markChapter(sync, ref, r, on);
      if (on) recordChapterView(w, r);
      paint(on);
      // العلامة والتقدّم وزرّ «تابع» والشبكة تتبعها في الحال، في كل نمط
      refreshChaptersSoon(w);
    };
    return { eye, paint };
  }
  /** صف فصل كما في النموذج: الرقم كبيرًا، ثم «الفصل N» (أو عنوانه) وتاريخه، ثم حالته. */
  /** «ويبتوني»: «يصدر أسبوعيًا · القادم 8 أبريل» من تواريخ الفصول الصحيحة، للعمل المستمر وحده. */
  function paintReleaseBeat(w, rows) {
    const host = q('releaseBeat');
    if (!host) return;
    const done = [state.detailFacts?.status, w.status].some((x) => /FINISHED|CANCELLED|COMPLETED|ENDED|HIATUS|مكتمل|منته|متوقف/i.test(String(x ?? '')));
    const beat = done ? null : releaseBeat(mainChapters(rows).map((r) => Number(r.chapter?.dateUpload)));
    // المكان محجوز في كل حال (manga.css): الإخفاء بالظهور لا بالإزالة، فلا يتحرك ما تحته
    host.toggleAttribute('data-off', !beat);
    host.setAttribute('aria-hidden', beat ? 'false' : 'true');
    if (!beat) return host.replaceChildren();
    const when = beat.next ? new Date(beat.next).toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', { day: 'numeric', month: 'long' }) : null;
    const every = beat.weekly ? 'أسبوعيًا' : `كل ${countLabel(beat.days, 'day')} تقريبًا`;
    host.replaceChildren(el('i'), el('span', null, `يصدر ${every}${when ? ` · القادم ${when}` : ''}`));
  }
  function chapterRow(w, r, isRead, isNext) {
    const row = el('div', `mw-ch${isNext ? ' here' : ''}`);
    const open = el('button', 'mw-ch-open');
    open.type = 'button';
    const num = el('span', 'n', chapterNumberText(r));
    num.dir = 'ltr';
    const name = r.chapter.name || '';
    const when = dateLabel(r.chapter.dateUpload);
    const t = el('span', 't');
    const b = el('b', null, plainChapterName(name) ? `الفصل ${chapterNumberText(r)}` : name);
    b.dir = 'auto';
    t.append(b, el('span', null, [when, r.chapter.scanlator].filter(Boolean).join(' · ')));
    open.append(num, t);
    const picked = Boolean(state.marking?.picked.has(chapterKeyOf(String(w.id), r)));
    if (state.marking) {
      row.classList.toggle('picked', picked);
      open.setAttribute('aria-pressed', String(picked));
    }
    open.onclick = () => (state.marking ? toggleMarkPick(w, r) : openChapter(w, r));
    const { eye, paint } = markButton(w, r, { isNext, onPaint: (on) => row.classList.toggle('read', on) });
    paint(isRead);
    row.append(open, eye);
    return row;
  }
  /**
   * بلوك فصل في «من حيث وقفت» (قرار المالك، 10 نوفمبر): الرقم أعلى، وتحته وقت النشر، ودائرة ○ تعلّمه مقروءًا.
   * لمسة البلوك تفتح الفصل فقط؛ الدائرة وحدها تبدّل التعليم. أُزيلت الضغطة المطوّلة: كانت تعيد رسم الشبكة
   * والإصبع ما زال على الشاشة، فيقع رفعه على عنصر جديد ويبدو التعليم وكأنه أُلغي فورًا.
   */
  function chapterCell(w, r, isRead, isNext) {
    const ref = String(w.id);
    const cell = el('div', 'mw-cell');
    const picked = Boolean(state.marking?.picked.has(chapterKeyOf(ref, r)));
    const open = el('button', 'mw-cell-open');
    open.type = 'button';
    const num = el('b', 'mw-cell-n', chapterNumberText(r));
    num.dir = 'ltr';
    open.append(num, el('small', 'mw-cell-t', dateLabel(r.chapter?.dateUpload) || ' '));
    const mark = el('button', 'mw-cell-mark');
    mark.type = 'button';
    let on = isRead;
    const paint = () => {
      cell.className = `mw-cell${isNext && !on ? ' here' : on ? ' read' : isNewChapter(r, on) ? ' new' : ''}${picked ? ' picked' : ''}`;
      mark.innerHTML = on ? glyph('check', { size: 14 }) : '<i></i>';
      mark.setAttribute('aria-pressed', String(on));
      mark.setAttribute('aria-label', on ? `ألغِ تعليم الفصل ${chapterNumberText(r)}` : `علّم الفصل ${chapterNumberText(r)} مقروءًا`);
      open.setAttribute('aria-label', `افتح الفصل ${chapterNumberText(r)}${on ? '، مقروء' : isNext ? '، وصلت هنا' : ''}`);
    };
    paint();
    open.onclick = () => (state.marking ? toggleMarkPick(w, r) : openChapter(w, r));
    mark.onclick = (e) => {
      e.stopPropagation();
      on = !on;
      markChapter(sync, ref, r, on);
      if (on) recordChapterView(w, r);
      paint();
      refreshChaptersSoon(w);
    };
    cell.append(open, mark);
    return cell;
  }
  function dateLabel(ms) {
    if (!ms) return '';
    const days = Math.floor((Date.now() - ms) / 86_400_000);
    if (days < 1) {
      // وقت النشر بالساعات في اليوم نفسه («قبل 10 ساعات»)
      const h = Math.floor((Date.now() - ms) / 3_600_000);
      if (h < 1) return 'قبل دقائق';
      return h === 1 ? 'قبل ساعة' : h === 2 ? 'قبل ساعتين' : h <= 10 ? `قبل ${h} ساعات` : `قبل ${h} ساعة`;
    }
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
  function openChapter(w, row, { inviteTogether = false } = {}) {
    // المصدر المختار يقرأ فصوله هو؛ الذكي يمرّ على الأفضل لكل فصل
    const rows = state.chapterSource ? editionRows(w, state.chapterSource) : w._chapters;
    // آخر نسخة من العمل نفسه: المصادر تصل والقارئ مفتوح (#323 U-27)
    const getWork = () => (state.current && String(state.current.id) === String(w.id) ? state.current : w);
    deps.openReader({ seriesRef: String(w.id), title: titleOf(w), work: w, getWork, rows, row, sourceLocked: Boolean(state.chapterSource), inviteTogether });
  }

  /**
   * «اقرأ مع أصدقائك» من صفحة العمل: اختر الفصل (تابع / الأول / الأحدث / أي رقم)،
   * فيفتح القارئ عليه وتظهر ورقة الدعوة مباشرة (من تدعو، متزامنة أو منفصلة).
   * في المنفصلة كل واحد يقرأ بمصدره وفصله؛ في المتزامنة الكل على صفحة المضيف.
   */
  function readTogetherCurrent() {
    const w = state.current;
    if (!w) return;
    const rows = (state.chapterSource ? editionRows(w, state.chapterSource) : w._chapters) ?? [];
    if (!rows.length) return toast('الفصول ما وصلت بعد، لحظة');
    if (together.session) return toast('أنت في غرفة الآن؛ اطلع منها أولًا');
    const byNumber = [...rows].filter((r) => Number.isFinite(Number(r.number))).sort((a, b) => Number(a.number) - Number(b.number));
    const go = (row) => { closeSheet(); openChapter(w, row, { inviteTogether: true }); };
    openSheet((body) => {
      body.classList.add('rt-sheet');
      const head = el('div', 'rt-head');
      head.append(el('h3', null, 'اقرأ مع أصدقائك'), el('p', null, 'اختر الفصل، ثم من تدعو وطريقة القراءة'));
      body.append(head);
      const quick = el('div', 'rt-quick');
      const pick = (label, sub, row, primary = false) => {
        if (!row) return;
        const b = el('button', `rt-pick${primary ? ' is-primary' : ''}`);
        b.type = 'button';
        b.append(el('b', null, label), el('span', null, sub));
        b.onclick = () => go(row);
        quick.append(b);
      };
      const next = state.nextRow;
      pick('تابع', next ? `الفصل ${next.number}` : '', next, true);
      if (byNumber[0] && byNumber[0] !== next) pick('من البداية', `الفصل ${byNumber[0].number}`, byNumber[0]);
      const latest = byNumber.at(-1);
      if (latest && latest !== next) pick('الأحدث', `الفصل ${latest.number}`, latest);
      body.append(quick);
      // أي فصل: رقم مباشر، أو من الشبكة
      const form = el('form', 'rt-number');
      const input = el('input', 'search-input');
      input.type = 'number';
      input.inputMode = 'decimal';
      input.placeholder = 'رقم الفصل';
      input.setAttribute('aria-label', 'رقم الفصل');
      const goBtn = el('button', 'btn btn-primary', 'افتح');
      goBtn.type = 'submit';
      form.append(input, goBtn);
      form.onsubmit = (e) => {
        e.preventDefault();
        const n = Number(input.value);
        const row = byNumber.find((r) => Number(r.number) === n);
        if (!row) return toast(`ما لقينا الفصل ${input.value}`);
        go(row);
      };
      body.append(form);
      const grid = el('div', 'rt-grid');
      for (const row of byNumber.slice().reverse()) {
        const b = el('button', `rt-ch${row === next ? ' is-next' : ''}`, String(row.number));
        b.type = 'button';
        b.onclick = () => go(row);
        grid.append(b);
      }
      body.append(grid);
    });
  }

  // ── الأنمي من المجلس والملف ──
  // مرجع الأنمي `anime:<AniList id>`: يفتح صفحة الأنمي في قسمه، واللحظة
  // المرسلة («الحلقة 12 · 12:10–12:20») تفتح ورقة سيرفراتها من ثانيتها.

  function openAnimeRef(ref, { title = null, cover = null, chapter = null, play = false } = {}) {
    const rawId = ref.slice('anime:'.length);
    const id = rawId.startsWith('addon-') ? rawId : Number(rawId);
    if (!rawId.startsWith('addon-') && (!Number.isFinite(id) || id <= 0)) { resumeRejectedUnifiedOrigin(); return toast('ما قدرنا نفتح هذا الأنمي'); }
    closeSheet();
    if (root.dataset.section !== 'anime') {
      writeSection('anime');
      applySection('anime');
      showHome('anime');
    }
    const episode = chapter && Number.isFinite(chapter.number) ? chapter.number : null;
    const position = chapter ? momentStart(chapter.label) : null;
    // لحظة من المجلس: «شاهد اللقطة» يشغّل مداها وحده
    const clip = chapter ? momentRange(chapter.label) : null;
    void anime.openAnime({ id, title: title ?? 'أنمي', poster: cover, posterSmall: cover }, { episode, position, clip, play });
  }

  // مرجع السينما `cinema:<IMDb>` (فيلم) أو `cinema:<IMDb>:<موسم>` (مسلسل)
  function openCinemaRef(ref, { title = null, cover = null, playAt = null, type = null } = {}) {
    const [, id, season] = ref.split(':');
    if (!/^tt\d+$/.test(id ?? '') && !id?.startsWith('addon-')) { resumeRejectedUnifiedOrigin(); return toast('ما قدرنا نفتح هذا العمل'); }
    closeSheet();
    if (root.dataset.section !== 'cinema') {
      writeSection('cinema');
      applySection('cinema');
      showHome('cinema');
    }
    // النوع: الممرَّر، أو الموسم في المرجع، وإلا يبقى مجهولًا فيحسمه prefetch في السينما (مسلسل أولًا ثم فيلم،
    // مع ما عرفه الجهاز). كان كل مرجع بلا موسم يُفتح «فيلمًا» فيُعطي Cinemeta مسلسلًا ناقصًا بلا حلقات
    // وبزر «شاهد الفيلم» (من الرئيسية الموحدة والإحصائيات والترشيحات)
    const known = id.startsWith('addon-') ? null : type ?? (season ? 'series' : null);
    void cinema.openWork({ id, type: known, title: title ?? '', poster: cover }, { playAt });
  }

  // ── ورقة المعاينة ──
  // من المجلس والملف: لمسة على عملٍ تعرض غلافه ونبذته أولًا، ثم «افتح».
  // لمسةٌ بالغلط وأنت تمرّر لا تنقلك من مكانك.

  /** ورقة «افتح العمل» للأنمي والسينما: نفس ورقة المانجا بلون قسمها، فلا يُفتح عمل بلمسة خاطئة. */
  function previewVideo(work, section, { chapter = null } = {}) {
    let alive = true;
    const id = String(work.id);
    const openIt = () => (section === 'anime'
      ? openAnimeRef(id, { title: titleOf(work), cover: work.coverImage?.large ?? null, chapter })
      : openCinemaRef(id, { title: titleOf(work), cover: work.coverImage?.large ?? null }));
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
      const actions = el('div', 'sheet-actions pv-actions');
      const open = el('button', 'btn btn-primary btn-block');
      open.type = 'button';
      open.innerHTML = glyph('play', { filled: true });
      open.append(el('span', null, section === 'anime' ? 'افتح الأنمي' : 'افتح العمل'));
      open.onclick = () => { closeSheet(); openIt(); };
      actions.append(open);
      body.append(box, actions);
      const done = (bits, text) => {
        if (!alive) return;
        meta.textContent = bits.filter(Boolean).join(' · ');
        desc.textContent = text || 'لا توجد نبذة.';
        desc.dir = 'auto';
      };
      const fail = () => { if (alive) desc.textContent = 'ما قدرنا نجيب النبذة الحين.'; };
      if (section === 'anime') {
        const aid = Number(id.split(':')[1]);
        if (Number.isFinite(aid)) void fetchAnimeDetail(aid).then((d) => done(['أنمي', (d?.genres ?? []).slice(0, 3).map(genreAr).join(' · '), d?.episodes ? `${d.episodes} حلقة` : ''], d?.description)).catch(fail);
        else fail();
      } else {
        const [, imdb] = id.split(':');
        void import('../lib/cinema-meta.js').then(async ({ detail }) => {
          for (const type of ['series', 'movie']) {
            const d = await detail(type, imdb).catch(() => null);
            if (d) return done([type === 'series' ? 'مسلسل' : 'فيلم', d.year, (d.genres ?? []).slice(0, 3).map(genreAr).join(' · ')], d.description);
          }
          fail();
        }).catch(fail);
      }
      return () => (alive = false);
    }, { tone: section });
  }
  function previewWork(work, { chapter = null } = {}) {
    if (isAnimeRef(work?.id)) return previewVideo(work, 'anime', { chapter });
    if (String(work?.id ?? '').startsWith('cinema:')) return previewVideo(work, 'cinema');
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
    }, { tone: 'manga' });
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
  /** Pick a work directly for a profile place, using locally known works. */
  function chooseProfileTop(position) {
    openSheet((body) => {
      body.classList.add('pf-top-picker');
      body.append(el('h3', null, `اختر عملًا للمركز ${position}`));
      const input = el('input', 'pf-top-search');
      input.type = 'search';
      input.placeholder = 'ابحث في أعمالك';
      input.setAttribute('aria-label', 'ابحث عن عمل لأفضل 5');
      const list = el('div', 'pf-top-choices');
      const byRef = new Map();
      for (const row of sync.rows('works')) byRef.set(row.series_ref, workFromRef(row.series_ref, row.title, row.cover_url));
      for (const w of [...libraryWorks('all'), ...historyWorks()]) byRef.set(String(w.id), w);
      const paint = () => {
        list.replaceChildren();
        const term = input.value.trim().toLocaleLowerCase();
        const works = [...byRef.values()].filter((w) => titleOf(w).toLocaleLowerCase().includes(term)).slice(0, 60);
        for (const work of works) {
          const button = el('button', 'pf-top-choice');
          button.type = 'button';
          const cover = el('span', 'pf-top-choice-cover');
          void mountImage(cover, work);
          button.append(cover, el('bdi', null, titleOf(work)));
          button.onclick = () => {
            closeSheet();
            placeInTop(descriptorOf(work), position);
            toast(`صار رقم ${position} في أفضل 5`);
            void profile.show(me());
          };
          list.append(button);
        }
        if (!works.length) list.append(el('p', null, 'ما لقينا عملًا. افتح صفحة العمل وأضفه إلى أفضل 5.'));
      };
      input.oninput = paint;
      body.append(input, list);
      paint();
      return () => { input.oninput = null; };
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
    // صف الأفعال تحت «اقرأ» (أو الدائرتان بجانبه): الحالة في الرمز الممتلئ ولون الزر
    const paint = (id, icon, on, label, onLabel, offHint) => {
      const btn = q(id);
      if (!btn) return;
      btn.setAttribute('aria-pressed', String(on));
      const square = btn.classList.contains('mw-square');
      btn.innerHTML = square ? glyph(icon, { filled: on }) : `${glyph(icon, { filled: on, size: 18 })}<span>${on ? onLabel : label}</span>`;
      btn.title = on ? `${onLabel} — المس للإزالة` : offHint;
      btn.setAttribute('aria-label', btn.title);
    };
    paint('libraryBtn', 'library', !!e?.row, 'أتابعها', 'في مكتبتي', 'أضف إلى «أتابعها»');
    paint('laterBtn', 'clock', !!e?.later, 'لاحقًا', 'لاحقًا', 'أقرأ لاحقًا');
    paintDetailTools();
  }

  // ── شريط صفحة العمل: نفس شريط صفحة الأنمي (رجوع وحده، وكبسولة: المفضلة، رشّح، المزيد) ──

  /** المفضلة ورشّح رمزان بلا كلام، و«المزيد» نقاط ثلاث تفتح دوائر بأسمائها تحتها. */
  function paintDetailTools() {
    const tools = q('detailTools');
    if (!tools) return;
    const fav = state.current ? Boolean(libraryEntry(String(state.current.id))?.favorite) : false;
    const tool = (icon, label, act, { pressed, filled = false } = {}) => {
      const b = el('button', 'aw-tool');
      b.type = 'button';
      b.innerHTML = glyph(icon, { size: 21, filled });
      b.setAttribute('aria-label', label);
      b.title = label;
      if (act) b.dataset.act = act;
      if (pressed !== undefined) b.setAttribute('aria-pressed', String(Boolean(pressed)));
      return b;
    };
    const heart = tool('heart', fav ? 'في المفضلة' : 'المفضلة', 'toggleFavoriteCurrent', { pressed: fav, filled: fav });
    heart.id = 'favBtn';
    const more = tool('more', 'المزيد');
    more.setAttribute('aria-haspopup', 'menu');
    more.setAttribute('aria-expanded', String(q('detailMenu')?.classList.contains('open') ?? false));
    more.onclick = () => toggleDetailMenu();
    // المانجا وحدها فيها الأصدقاء في الشريط: القراءة الجماعية تبدأ من صفحة العمل (الأنمي من داخل الحلقة)
    tools.replaceChildren(heart, tool('send', 'رشّح', 'shareCurrent'), tool('users', 'اقرأ مع أصدقائك', 'readTogetherCurrent'), more);
    paintDetailMenu();
  }
  /**
   * «المزيد»: قراءتي السابقة، والترجمة العربية (لعمل فيه فصول إنجليزية)، والتقييم، وخيارات العمل
   * (أفضل 5، أكملته، بلّغ، حذف)؛ ومعها ما لا يتسع له صف أزرار النمط (لاحقًا، مع أصدقائك).
   */
  function paintDetailMenu() {
    const menu = q('detailMenu');
    const w = state.current;
    if (!menu || !w) return;
    const entry = (icon, label, run, { pressed = false } = {}) => {
      const b = el('button', 'aw-menu-item');
      b.type = 'button';
      b.setAttribute('role', 'menuitem');
      b.innerHTML = `<span class="aw-menu-dot">${glyph(icon, { size: 20, filled: pressed && icon !== 'check' })}</span><span class="aw-menu-label">${label}</span>`;
      if (pressed) b.setAttribute('aria-pressed', 'true');
      b.onclick = () => {
        closeDetailMenu();
        run();
      };
      return b;
    };
    const e = libraryEntry(String(w.id));
    const ref = String(w.id);
    // الترتيب والأسماء من work-menu.js (واحدة للأقسام الثلاثة)
    const readCount = (w._chapters ?? []).filter((r) => isChapterRead(sync, ref, chapterKeyOf(ref, r))).length;
    const run = {
      library: toggleLibraryCurrent,
      later: toggleLaterCurrent,
      mark: () => enterMarkMode(),
      previous: markPreviousReading,
      top: () => toggleTopCurrent(),
      translate: openTranslateMenu,
      options: openWorkMenu,
    };
    const spec = workMenuEntries('manga', {
      library: Boolean(e?.row),
      later: Boolean(e?.later),
      top: inCollection('top', ref),
      previous: readCount > 0,
      translate: translateAvailable(w) ? { available: true, on: translationOn(ref) } : null,
    });
    const rows = spec.map((x) => entry(x.icon, x.label, run[x.id], { pressed: x.pressed }));
    rows.forEach((r, i) => r.style.setProperty('--i', String(i)));
    menu.replaceChildren(...rows);
  }
  function toggleDetailMenu(force) {
    const menu = q('detailMenu');
    if (!menu) return;
    const open = force ?? !menu.classList.contains('open');
    if (!open) return closeDetailMenu();
    menu.classList.add('open');
    q('detailScrim')?.classList.add('open');
    q('detailTools')?.querySelector('[aria-haspopup]')?.setAttribute('aria-expanded', 'true');
    // لمسة خارج القائمة أو Esc تغلقها
    const away = (e) => {
      if (e.type === 'keydown' && e.key !== 'Escape') return;
      if (e.type === 'pointerdown' && (menu.contains(e.target) || q('detailTools')?.contains(e.target))) return;
      // Esc يغلق القائمة وحدها، لا يرجع من الصفحة أيضًا
      if (e.type === 'keydown') e.stopPropagation();
      closeDetailMenu();
    };
    detailMenuAway = away;
    document.addEventListener('pointerdown', away, true);
    document.addEventListener('keydown', away, true);
  }
  let detailMenuAway = null;
  function closeDetailMenu() {
    q('detailMenu')?.classList.remove('open');
    q('detailScrim')?.classList.remove('open');
    q('detailTools')?.querySelector('[aria-haspopup]')?.setAttribute('aria-expanded', 'false');
    if (detailMenuAway) {
      document.removeEventListener('pointerdown', detailMenuAway, true);
      document.removeEventListener('keydown', detailMenuAway, true);
      detailMenuAway = null;
    }
  }

  // ── «المعرض»: تبويبات الفصول وعن العمل ومشابهة ──

  function bindDetailTabs() {
    const bar = q('detailTabs');
    if (!bar) return;
    bar.addEventListener('click', (e) => {
      const tab = e.target.closest('[role="tab"]');
      if (!tab) return;
      for (const t of bar.querySelectorAll('[role="tab"]')) t.setAttribute('aria-selected', String(t === tab));
      for (const p of q('detail').querySelectorAll('.mw-tab')) p.hidden = p.dataset.panel !== tab.dataset.tab;
      if (tab.dataset.tab === 'similar') paintSimilar();
    });
  }
  /** أعمال تشاركه تصنيفًا مما في الرئيسية والاستكشاف (بلا طلب جديد)، الأكثر تقاطعًا أولًا. */
  /**
   * «أعمال مشابهة» للمانجا من توصيات AniList (تقييم القرّاء: قرابة حقيقية) كما «قد يعجبك» في الأنمي. كانت مطابقة
   * أنواع داخل مخزون صغير محلي (الرائج والشائع): نتائج بلا قرابة، وأعمال لا يظهر لها التبويب أصلًا. المطابقة
   * بالأنواع تبقى بديلًا حتى تصل التوصيات أو إن تعذّرت.
   */
  const similarCache = new Map();
  function similarRecs(w) {
    const key = String(w.id);
    if (!similarCache.has(key)) {
      const alId = /^al:(\d+)$/.exec(key)?.[1];
      const title = typeof w.title === 'string' ? w.title : w.title?.english || w.title?.romaji || w.title?.native || '';
      const job = (async () => {
        if (!alId && !title) return [];
        const res = await fetch('https://graphql.anilist.co', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({
            query: `query ($id: Int, $q: String) { Media(${alId ? 'id: $id' : 'search: $q'}, type: MANGA) { recommendations(perPage: 14, sort: RATING_DESC) { nodes { rating mediaRecommendation { id type isAdult title { english romaji } coverImage { large color } bannerImage genres status averageScore chapters } } } } }`,
            variables: alId ? { id: Number(alId) } : { q: title },
          }),
        });
        const nodes = (await res.json())?.data?.Media?.recommendations?.nodes ?? [];
        return nodes.map((n) => n.mediaRecommendation).filter((m) => m && m.type === 'MANGA' && !m.isAdult && m.coverImage?.large)
          .map((m) => ({ id: `al:${m.id}`, title: m.title, coverImage: m.coverImage, bannerImage: m.bannerImage ?? null, genres: m.genres ?? [], status: m.status, averageScore: m.averageScore, chapters: m.chapters }));
      })().catch(() => []);
      similarCache.set(key, { list: null, job });
      void job.then((list) => {
        similarCache.get(key).list = list;
        if (String(state.current?.id) !== key) return;
        const grid = q('similarGrid');
        if (grid && list.length) { grid.dataset.for = ''; paintSimilar(); }
        paintSimilarTab(w);
      });
    }
    return similarCache.get(key).list;
  }
  function similarWorks(w) {
    const recs = similarRecs(w);
    if (recs?.length) return recs.slice(0, 12);
    const genres = new Set(w.genres || []);
    if (!genres.size) return [];
    const pool = uniqueById([...state.home.trending, ...state.home.popular, ...state.home.featured, ...state.home.recent, ...state.catalog].filter(Boolean));
    return pool
      .filter((x) => String(x.id) !== String(w.id) && !isAnimeRef(String(x.id)))
      .map((x) => ({ x, n: (x.genres || []).filter((g) => genres.has(g)).length }))
      .filter((s) => s.n > 0)
      .sort((a, b) => b.n - a.n)
      .slice(0, 12)
      .map((s) => s.x);
  }
  function paintSimilar() {
    const grid = q('similarGrid');
    const w = state.current;
    if (!grid || !w || grid.dataset.for === String(w.id)) return;
    grid.dataset.for = String(w.id);
    grid.replaceChildren(...similarWorks(w).map((x) => card(x)));
  }
  function paintSimilarTab(w) {
    const tab = q('similarTab');
    if (tab) tab.hidden = !similarWorks(w).length;
  }

  // ── التقييم الشخصي وأكملته: للأقسام الثلاثة (الجدولان واحدان، `series_ref` يميّز النوع) ──
  function userRating(ref) {
    const refs = refsOf(String(ref));
    const row = sync.rows('ratings', (r) => r.user_id === me() && refs.includes(r.series_ref))
      .sort((x, y) => (y.updated_at ?? 0) - (x.updated_at ?? 0))[0];
    return row?.score ? Math.round(row.score / 2) : 0;
  }
  let pendingRating = null;
  const ratingOf = (ref) => (pendingRating?.ref === String(ref) ? pendingRating.stars : userRating(ref));
  const userRatingNow = () => (state.current ? ratingOf(String(state.current.id)) : 0);
  /** وصف عمل للكتابة: من صفحة المانجا الحالية، أو من مرجع أنمي/سينما بعنوانه وغلافه. */
  const describeRef = ({ ref, title, cover }) => ({ seriesRef: ref, seriesTitle: title ?? null, coverUrl: cover ?? null, sourceId: null });
  /** التقييم نجوم خمس: لمسة واحدة تحفظ (الخادم يحفظ من 10). `target` اختياري لغير المانجا. */
  function renderRating(box, target = null) {
    const d = target ? describeRef(target) : state.current ? descriptorOf(state.current) : null;
    if (!d) return;
    const current = ratingOf(d.seriesRef);
    box.replaceChildren(
      ...[1, 2, 3, 4, 5].map((i) => {
        const b = el('button', i <= current ? 'on' : '');
        b.type = 'button';
        b.setAttribute('role', 'radio');
        b.setAttribute('aria-checked', String(i === current));
        b.setAttribute('aria-label', `تقييمك ${i} من 5`);
        b.innerHTML = glyph('star', { filled: i <= current, size: 28 });
        b.onclick = () => {
          sync.enqueue('rating.set', { ...d, score: i * 2 });
          pendingRating = { ref: d.seriesRef, stars: i };
          toast(`قيّمته ${i} من 5`);
          renderRating(box, target);
          paintDetailMenu();
        };
        return b;
      }),
    );
    box.dataset.ref = d.seriesRef;
    if (target) box._target = target;
  }
  function openRatingSheet(target = null) {
    const title = target ? target.title : state.current ? titleOf(state.current) : null;
    if (!target && !state.current) return;
    openSheet((body) => {
      const h = el('h3', null, title ?? '');
      h.dir = 'auto';
      body.append(h, el('p', null, 'تقييمك لهذا العمل'));
      const box = el('div', 'rate mw-rate');
      box.setAttribute('role', 'radiogroup');
      box.setAttribute('aria-label', 'تقييمك');
      renderRating(box, target);
      body.append(box);
    });
  }

  /**
   * «خيارات أخرى» واحدة للأقسام الثلاثة (work-menu.js): التقييم، أكملته، الإبلاغ، والحذف للمانجا.
   * @param {{ ref: string, title: string, cover?: string|null }|null} target بلا هدف: عمل المانجا الحالي
   */
  function openWorkOptions(target = null) {
    const w = target ? workFromRef(target.ref, target.title, target.cover) : state.current;
    if (!w) return;
    const ref = target ? target.ref : String(w.id);
    const d = target ? describeRef(target) : descriptorOf(w);
    openSheet((body) => {
      const title = el('h3', null, target ? target.title : titleOf(w));
      title.dir = 'auto';
      title.style.marginBottom = '8px';
      body.append(title);
      const run = {
        rate: () => { closeSheet(); setTimeout(() => openRatingSheet(target), 0); },
        completed: () => {
          closeSheet();
          const member = !inCollection('completed', ref);
          sync.enqueue('completed.set', { ...d, member });
          toast(member ? 'في «المكتمل»' : 'أزيل من «المكتمل»');
          target?.onChange?.();
        },
        report: () => { closeSheet(); openReport(w); },
        delete: () => { closeSheet(); deleteWork(w); goBack(); },
      };
      for (const x of workOptionEntries({ rating: ratingOf(ref), completed: inCollection('completed', ref), canReport: Boolean(deps.report), canDelete: !target })) {
        body.append(sheetItem(x.icon, x.label, run[x.id], { pressed: x.pressed, danger: x.danger }));
      }
    });
  }
  const openWorkMenu = () => openWorkOptions(null);
  // أفضل 5 للأنمي والسينما: نفس الخانات الخمس، بمرجع القسم
  function openMediaWorkMenu({ ref, title, cover }) {
    openTopPicker(workFromRef(ref, title, cover));
  }
  /** حالة العمل في الجداول المشتركة: لقوائم ⋮ في الأنمي والسينما. */
  const mediaState = (ref) => ({ top: inCollection('top', ref), completed: inCollection('completed', ref), rating: ratingOf(ref) });
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
  /** بعد أي تعليم: الصفحة كلها تتحدث في الحال (القائمة أو الشبكة، التقدّم، زرّ «تابع»). */
  function refreshChaptersSoon(w) {
    clearTimeout(state.eyeTimer);
    if (state.current?.id === w.id && state.current._chapters && currentPage() === 'detail') renderChapters(state.current);
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
  let historyInsights = null;
  let historyInsightsAt = 0;
  let historyInsightsOwner = null;
  function viewedLabel(at) {
    const days = Math.floor((Date.now() - at) / 86_400_000);
    if (days < 7) return timeAgo(at).replace(/^الآن$/, 'منذ أقل من دقيقة');
    return new Date(at).toLocaleDateString('ar', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', numberingSystem: 'latn' }).replace('، ', ' - ');
  }
  function chapterRatio(userId, ref, number) {
    if (number == null) return null;
    const key = chapterKeyOf(ref, { chapter: { chapterNumber: number, name: '' }, sourceId: '' });
    const row = sync.rows('progress', (r) => r.user_id === userId && sameChapterKey(r.chapter_key, key)).sort((x, y) => (Number(y.ratio) || 0) - (Number(x.ratio) || 0))[0];
    return row ? Math.max(0, Math.min(1, Number(row.ratio) || 0)) : null;
  }
  /**
   * @param {HTMLElement} target
   * @param {{ userId?: string, own?: boolean, limit?: number, profile?: boolean }} [opts]
   */
  function renderHistoryList(target, { userId = me(), own = userId === me(), limit = Infinity, profile = false } = {}) {
    if (historyInsightsOwner !== me()) { historyInsights = null; historyInsightsOwner = me(); }
    const rows = viewRows(userId);
    if (!rows.length) {
      emptyState(target, {
        icon: 'history',
        title: own ? 'ما قريت شي بعد' : 'ما فيه مشاهدات',
        text: own ? 'يظهر العمل هنا بعد قراءة 20% من فصل أو تعليم فصل كمقروء.' : 'لما يقرأ فصلًا يظهر هنا.',
      });
      return;
    }
    const startOfDay = new Date().setHours(0, 0, 0, 0);
    const dayOf = (at) => (at >= startOfDay ? 'اليوم' : at >= startOfDay - 86_400_000 ? 'أمس' : viewedLabel(at));
    const list = el('div', 'rv-list');
    for (const v of rows.slice(0, limit)) {
      const at = v.viewed_at ?? Date.now();
      const d = dayOf(at);
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
        ch.innerHTML = glyph('book', { size: 17 });
        ch.append(el('bdi', null, v.chapter_label || `الفصل ${v.chapter_number}`));
        meta.append(ch);
      }
      if (own) {
        const spent = el('span', 'rv-duration');
        spent.dataset.ref = v.series_ref;
        meta.append(spent);
      }
      const when = el('time', 'rv-time', d);
      when.innerHTML = glyph('calendar', { size: 16 });
      when.append(document.createTextNode(d));
      meta.append(when);
      if (profile) {
        when.replaceChildren(document.createTextNode(d));
        meta.removeChild(when);
        copy.append(meta, when);
      } else {
        // سطران: الفصل بارزًا، ثم المدة وآخر مرة بهدوء
        const ch = meta.querySelector('.rv-chapter');
        if (ch) copy.append(ch);
        copy.append(meta);
      }
      open.append(cover, copy);
      open.onclick = () => void openWork(work);
      item.append(open);
      if (own) {
        const del = el('button', 'rv-del');
        del.type = 'button';
        del.innerHTML = glyph('trash', { size: 22 });
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
    if (own) {
      const paintTime = (data) => {
        if (!list.isConnected || !data?.content) return;
        const byRef = new Map(data.content.map((x) => [x.seriesRef, x.activeMs]));
        for (const span of list.querySelectorAll('.rv-duration')) {
          const ms = byRef.get(span.dataset.ref);
          if (ms > 0) {
            span.innerHTML = glyph('hourglass', { size: 16 });
            span.append(document.createTextNode(insightDuration(ms)));
          }
        }
      };
      if (historyInsights && Date.now() - historyInsightsAt < 60000) paintTime(historyInsights);
      else void sync.insights(userId).then((data) => {
        if (me() !== userId) return;
        historyInsights = data;
        historyInsightsAt = Date.now();
        paintTime(data);
      });
    }
  }

  // المكتبة الموحدة (التصميم الرابع): الجداول المشتركة نفسها، فلا ترحيل ولا نسخ
  const unifiedLibrary = createUnifiedLibrary({
    el, glyph,
    shelves: () => libraryShelves(sync, me(), { qualifiesView: (v) => isMediaRef(v.series_ref) || qualifiesOwnView(v) }),
    open: (item) => openUnified(item),
    discover: () => navTo('discover'),
    coverInto: (node, item) => { void mountImage(node, workFromRef(String(item.ref), item.title, item.cover)); return true; },
    itemMenu: (item) => openRecentMenu({ ...item, ref: item.view?.series_ref ?? item.ref }),
  });
  function renderUnifiedLibrary() {
    unifiedLibrary.render(q('unifiedLibrary'));
  }
  const unifiedCard = (it, group) => group === 'manga'
      ? { title: titleOf(it), cover: it.coverImage?.large ?? null, sub: (it.genres ?? []).slice(0, 2).map((g) => AR_GENRE[g] ?? g).join('، ') }
      : group === 'anime'
        ? { title: it.title, cover: it.posterSmall ?? it.poster ?? null, sub: [it.year, it.score ? it.score.toFixed(1) : null].filter(Boolean).join(' · ') }
        : { title: it.title, cover: it.poster ?? null, sub: [it.type === 'series' ? 'مسلسل' : 'فيلم', it.year].filter(Boolean).join(' · ') };
  function mixedTrending(filter = 'all') {
    const pools = [
      ['anime', unifiedData.anime?.trending ?? []],
      ['manga', uniqueById([...(state.home.trending ?? []), ...(state.home.popular ?? [])])],
      ['cinema', unifiedData.cinema?.series ?? []],
      ['cinema', unifiedData.cinema?.movie ?? []],
    ].filter(([g]) => filter === 'all' || g === filter);
    const out = [];
    for (let i = 0; i < 12; i++) for (const [group, list] of pools) if (list[i]) out.push({ item: list[i], group });
    return out;
  }
  let unifiedReturn = null;
  const unifiedSurfaces = () => ({ discover: unifiedDiscover, view: unifiedView, search: unifiedSearch });
  function resumeRejectedUnifiedOrigin() {
    if (!unifiedReturn) return;
    unifiedSurfaces()[unifiedReturn.kind]?.resume?.();
    unifiedReturn = null;
  }
  /** Keep subpage DOM + its scroll when entering a work, instead of revealing Home beneath it. */
  function suspendUnifiedOrigin() {
    if (root.dataset.content !== 'unified' || unifiedReturn) return false;
    const page = currentPage();
    for (const kind of ['discover', 'view', 'search']) {
      if (!unifiedSurfaces()[kind]?.suspend?.()) continue;
      unifiedReturn = { kind, page };
      return true;
    }
    return false;
  }
  function openUnifiedResult(it, group) {
    suspendUnifiedOrigin();
    if (group === 'anime') return openAnimeRef(`anime:${it.id}`, { title: it.title, cover: it.posterSmall ?? it.poster });
    if (group === 'cinema') return openCinemaRef(`cinema:${it.id}`, { title: it.title, cover: it.poster, type: it.type ?? null });
    if (root.dataset.section !== 'manga') { writeSection('manga'); applySection('manga'); }
    void openWork(it);
  }
  // «اكتشف» الموحد: تصنيفات كل نوع بفلتره الحقيقي، والرائج المنوّع (unified-discover.js)
  const ANIME_GENRES = ['Action', 'Adventure', 'Comedy', 'Drama', 'Fantasy', 'Romance', 'Mystery', 'Horror', 'Psychological', 'Sci-Fi', 'Supernatural', 'Thriller', 'Sports', 'Slice of Life', 'Mecha', 'Music'];
  const CINEMA_GENRES = ['Action', 'Drama', 'Thriller', 'Comedy', 'Crime', 'Sci-Fi', 'Horror', 'Romance', 'Adventure', 'Mystery', 'Fantasy', 'Animation', 'War', 'History', 'Documentary', 'Family'];
  const genreLabel = (en) => AR_GENRE[en] ?? CINEMA_GENRES_AR[en] ?? GENRES.find((g) => g.en === en)?.ar ?? en;
  const genreHue = (en) => GENRES.find((g) => g.en === en)?.hue ?? (([...en].reduce((n, c) => n + c.charCodeAt(0), 0) * 37) % 360);
  /** صورة كل تصنيف من عمل فيه، ولا تتكرر صورة في بلاطتين (عمل مشهور يحمل تصنيفات كثيرة). */
  function genreCover(type, en, used = new Set()) {
    const pools = type === 'anime' ? [unifiedData.anime?.trending, unifiedData.anime?.season, unifiedData.anime?.popular]
      : type === 'cinema' ? [unifiedData.cinema?.movie, unifiedData.cinema?.series]
        : [state.home.trending, state.home.popular];
    for (const list of pools) for (const x of list ?? []) {
      if (!(x.genres ?? []).includes(en)) continue;
      const src = type === 'manga' ? (x.wideBanner ?? null) : (x.background ?? x.backdrop ?? x.banner ?? null);
      if (src && !used.has(src) && !genreArtUsed.has(src)) { used.add(src); genreArtUsed.add(src); return src; }
    }
    return null;
  }
  // صورة عريضة لكل تصنيف من نوعه (كما في «حسب النوع» بالسينما)، مرة لكل تصنيف، وبلا تكرار صورة بين بلاطتين
  const genreArtCache = new Map();
  /**
   * صورة التصنيف تُثبَّت أول مرة تُعرف، وتُحفظ على الجهاز، ولا تتغيّر بعدها (خلل «تتبدّل وتجي»: كان كل رسم
   * يستبعد ما اختاره الرسم السابق عبر genreArtUsed فتأخذ البلاطة صورة أخرى أو لا شيء). تصنيف بلا صورة تُجلب له مرة.
   */
  const GENRE_PIN_KEY = 'vantara.unified.genre-art.v1';
  const genrePins = (() => { try { return new Map(Object.entries(JSON.parse(localStorage.getItem(GENRE_PIN_KEY) ?? '{}') ?? {})); } catch { return new Map(); } })();
  const genreArtUsed = new Set(genrePins.values());
  const pinGenre = (key, src) => {
    if (genrePins.has(key)) return genrePins.get(key);
    if (!src) return null;
    genrePins.set(key, src);
    genreArtUsed.add(src);
    try { localStorage.setItem(GENRE_PIN_KEY, JSON.stringify(Object.fromEntries(genrePins))); } catch { /* تفضيل قابل للتوليد */ }
    return src;
  };
  function genreArt(type, en) {
    const key = `${type}:${en}`;
    if (genrePins.has(key)) return Promise.resolve(genrePins.get(key));
    const cached = genreArtCache.get(key);
    if (cached?.promise) return cached.promise;
    if (cached?.retryAt > Date.now()) return Promise.resolve(null);
    {
      const pick = (list, field) => {
        for (const x of list ?? []) { const src = x?.[field]; if (src && !genreArtUsed.has(src)) { genreArtUsed.add(src); return src; } }
        return null;
      };
      const entry = {};
      entry.promise = (async () => {
        if (type === 'anime') {
          const { searchAnime } = await import('../lib/anime-meta.js');
          return pick((await searchAnime({ genre: en }))?.items, 'banner');
        }
        if (type === 'cinema') {
          const { catalog } = await import('../lib/cinema-meta.js');
          return pick(await catalog('movie', 'top', { genre: en }), 'background');
        }
        // المانجا: أشهر مانجا التصنيف في AniList ببنرها العريض (وإلا غلافها). ما ليس تصنيفًا عندهم وسمٌ
        const ANILIST_GENRES = ['Action', 'Adventure', 'Comedy', 'Drama', 'Ecchi', 'Fantasy', 'Horror', 'Mahou Shoujo', 'Mecha', 'Music', 'Mystery', 'Psychological', 'Romance', 'Sci-Fi', 'Slice of Life', 'Sports', 'Supernatural', 'Thriller'];
        const TAGS = { Isekai: 'Isekai', 'Martial Arts': 'Martial Arts', Historical: 'Historical', 'School Life': 'School' };
        const byGenre = ANILIST_GENRES.includes(en);
        const res = await fetch('https://graphql.anilist.co', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({
            query: `query ($v: String) { Page(perPage: 12) { media(type: MANGA, isAdult: false, sort: POPULARITY_DESC, ${byGenre ? 'genre: $v' : 'tag: $v'}) { bannerImage coverImage { large } } } }`,
            variables: { v: byGenre ? en : (TAGS[en] ?? en) },
          }),
        });
        const media = (await res.json())?.data?.Page?.media ?? [];
        return pick(media.map((m) => ({ src: m.bannerImage })), 'src') ?? pick(media.map((m) => ({ src: m.coverImage?.large })), 'src');
      })().then((src) => pinGenre(key, src), () => null).then((src) => {
        if (genreArtCache.get(key) === entry) {
          if (src) genreArtCache.delete(key);
          else { entry.promise = null; entry.retryAt = Date.now() + 30_000; }
        }
        return src;
      });
      genreArtCache.set(key, entry);
      return entry.promise;
    }
  }
  let cinemaPager = null;
  const unifiedDiscover = createUnifiedDiscover({
    el, glyph,
    genreArt,
    mount: (node) => root.append(node),
    genres: (type) => (type === 'anime' ? ANIME_GENRES : type === 'cinema' ? CINEMA_GENRES : GENRES.map((g) => g.en))
      .map(((used) => (en) => ({ id: en, label: genreLabel(en), hue: genreHue(en), cover: genrePins.get(`${type}:${en}`) ?? pinGenre(`${type}:${en}`, genreCover(type, en, used)) }))(new Set())),
    results: async (type, genre, page = 1) => {
      if (type === 'anime') {
        const { searchAnime } = await import('../lib/anime-meta.js');
        return searchAnime({ ...(genre ? { genre } : {}), page });
      }
      if (type === 'manga') {
        const result = await (genre ? fetchMangaGenre(genre, { page }) : fetchMangaPopular({ page }));
        return { items: result.items, hasNext: result.hasNextPage };
      }
      // صفحات تالية للسينما أيضًا (#311 D-026): كانت الدفعة الأولى وحدها
      const { catalog } = await import('../lib/cinema-meta.js');
      cinemaPager ??= createCinemaPager(catalog);
      return cinemaPager(genre ?? '', page);
    },
    card: (it, type) => unifiedCard(it, type),
    open: (it, type) => openUnifiedResult(it, type),
    openMangaGenre: (en) => {
      if (root.dataset.section !== 'manga') { writeSection('manga'); applySection('manga'); }
      if (!en) return void openCollection('catalogue');
      const g = GENRES.find((x) => x.en === en);
      if (g) void openGenre(g);
    },
    openSearch: () => unifiedSearch.open(),
    trending: () => mixedTrending('all'),
  });
  const unifiedSearch = createUnifiedSearch({
    el, glyph,
    recent: recentStore('vantara.unified.recent.v1'),
    // التصنيفات: تفتح اكتشاف القسم بالتصنيف (الكل ← الأنمي، أوسعها تصنيفًا)
    genres: (filter) => ['Action', 'Adventure', 'Comedy', 'Drama', 'Fantasy', 'Romance', 'Mystery', 'Horror', 'Sci-Fi', 'Psychological'].map((g) => ({
      label: AR_GENRE[g] ?? g,
      open: () => {
        unifiedSearch.close();
        const section = filter === 'all' ? 'anime' : filter;
        if (section === 'anime') return void anime.openDiscover({ genre: g });
        browseSection(section);
      },
    })),
    // الرائج الآن منوّع: أنمي، مانجا، مسلسل، فيلم بالتناوب، ويتبع الفلتر
    trending: (filter) => mixedTrending(filter),
    mount: (node) => root.append(node),
    engines: {
      anime: (term) => import('../lib/anime-meta.js').then(({ searchAnime }) => searchAnime({ search: term })).then((r) => r?.items ?? []),
      manga: (term) => (available() ? browseLive({ query: term }, () => {}).then((r) => r?.items ?? []) : Promise.resolve([])),
      cinema: (term) => import('../lib/cinema-meta.js').then(({ search }) => search(term)),
    },
    card: (it, group) => unifiedCard(it, group),
    open: (it, group) => openUnifiedResult(it, group),
  });
  let libraryRepaint = 0;
  /** «مكتبتي» الظاهرة: الموحدة في توحيد المحتوى، وإلا مكتبة القسم بتصميمه. */
  function renderActiveLibrary() {
    if (root.dataset.content === 'unified') return renderUnifiedLibrary();
    const section = root.dataset.section;
    if (section === 'anime') anime.renderLibrary();
    else if (section === 'cinema') cinema.renderLibrary();
    else renderLibrary();
  }
  function renderLibrary() {
    // الأسماء والترتيب من library-model.js (واحدة للأقسام الثلاثة)؛ المفاتيح القديمة للمانجا باقية
    const KEY = { all: 'all', following: 'reading', recent: 'history', later: 'later', favorite: 'favorite', completed: 'completed' };
    const tabs = LIBRARY_TABS.map((t) => [KEY[t.id], t.label]);
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
      const copy = EMPTY_COPY[{ reading: 'following' }[state.libraryFilter] ?? state.libraryFilter] ?? EMPTY_COPY.all;
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
    trending: { title: 'الأكثر شهرة عالميًا', kind: 'globalPopular' },
    // «آخر التحديثات» صار ذاكرة VANTARA (openUpdates)، و«في المصادر الآن» قائمة المصادر اللحظية
    sourcesNow: { title: 'في المصادر الآن', kind: 'latestListing' },
    catalogue: { title: 'كل الأعمال', kind: 'catalogue' },
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
    if (kind === 'recent') return openUpdates('manga');
    q('collectionGrid').classList.remove('up-feed');
    const c = COLLECTIONS[kind] || COLLECTIONS.trending;
    const initial = kind === 'sourcesNow'
      ? recentFromLatest(latestPartial?.items ?? [], state.home.recent)
      : kind === 'trending' ? state.home.trending : [];
    state.collection = { kind: c.kind, page: 0, hasNext: true, items: [...initial], genre: null };
    q('collectionTitle').textContent = c.title;
    if (initial.length) renderGrid(q('collectionGrid'), initial);
    else q('collectionGrid').replaceChildren(...skeletonCards(9));
    q('collectionMore').hidden = true;
    showPage('collection');
    if (c.kind === 'latestListing') void latestFirstPage();
    await loadMoreCollection();
  }
  // ───────────────────────── آخر التحديثات (Update Engine) ─────────────────────────
  // خط زمني ثابت من ذاكرة VANTARA لكل قسم: نفس الشاشة ونفس السلوك، بلون القسم.

  const UPDATE_TITLES = { manga: 'آخر التحديثات', anime: 'حلقات جديدة', cinema: 'آخر التحديثات' };
  function openUpdates(section) {
    state.collection = { kind: 'updates', page: 0, hasNext: false, items: [], genre: null };
    q('collectionTitle').textContent = UPDATE_TITLES[section] ?? 'آخر التحديثات';
    q('collectionMore').hidden = true;
    showPage('collection');
    if (section === 'manga') void sweepLatest({ minGap: 3 * 60_000 });
    mountTimeline(q('collectionGrid'), timelineOptions(section, () => currentPage() === 'collection' && state.collection?.kind === 'updates' && root.dataset.section === section));
  }
  /**
   * إعدادات الخط الزمني لقسم: صفحة التحديثات في كل قسم، وألسنة الأقسام في «آخر التحديثات» الموحد (#323 O-2:
   * الأقدم بالتحميل من الخادم، لا أول دفعة فقط). خط واحد وسلوك واحد.
   */
  function timelineOptions(section, visible, include = undefined) {
    return {
      section,
      el,
      include,
      canonical: section === 'manga' ? canonicalEventWorks : null,
      mountCover: (art, g) => void mountImage(art, g.section === 'manga' ? workOfEvent(g) : workFromRef(g.work, g.title, g.cover)),
      visible,
      image: (src) => {
        const img = new Image();
        img.alt = '';
        img.loading = 'lazy';
        img.decoding = 'async';
        img.className = 'up-img';
        img.onload = () => img.classList.add('loaded');
        img.src = src;
        return img;
      },
      open: (g) => openUpdate(g),
      empty: () => {
        const box = el('div');
        emptyState(box, {
          icon: 'clock',
          title: 'VANTARA يراقب المصادر',
          text: 'أول ما يظهر جديد في أي مصدر — من قائمته أو صفحة العمل أو البحث — يُسجَّل هنا بوقته الحقيقي ويبقى.',
          action: section === 'manga' ? { label: 'في المصادر الآن', icon: 'flame', run: () => void openCollection('sourcesNow') } : null,
        });
        return box;
      },
    };
  }
  /** عمل مانجا من حدث: من الحساب إن عُرف، وإلا من مصادر الحدث نفسها. */
  function workOfEvent(g) {
    const base = withUpdateSources(workFromRef(g.work,g.title,g.cover),g);
    // غلاف الحدث مرشّحٌ دائمًا بعد غلاف العمل: غلافٌ محفوظ قديم لا يُسقط البطاقة إلى حرف
    if (g.cover && base.bannerImage !== g.cover && !coverCandidates(base).some((c) => c.url === g.cover)) base.bannerImage = g.cover;
    return { ...base, _latestChapter: { chapterNumber: g.high }, _updateAt: g.at, _updatePublishedAt: g.publishedAt, _newCount: g.events?.length ?? 1 };
  }
  function openUpdate(g) {
    if (g.section === 'anime') return openAnimeRef(g.work, { title: g.title, cover: g.cover });
    if (g.section === 'cinema') return openCinemaRef(g.kind === 'movie' ? g.work : `${g.work}:${g.season ?? 1}`, { title: g.title, cover: g.cover });
    // Keep the familiar work screen; a cached row must never auto-open before
    // its current provider has responded. The target only forces fresh discovery.
    void openWork(workOfEvent(g),{expectedChapter:Number.isFinite(g.high)?g.high:null,readLanguage:'ar'});
  }
  /** شريط الرئيسية: آخر التحديثات من الذاكرة (يُسأل كل دقيقتين ما دامت الرئيسية ظاهرة). */
  let updatesAskedAt = 0;
  async function refreshHomeUpdates() {
    if (Date.now() - updatesAskedAt < 120_000) return;
    updatesAskedAt = Date.now();
    const groups = await latestGroups('manga', 14, canonicalEventWorks).catch(() => null);
    if (!groups?.length) return;
    state.home.updates = groups.map(workOfEvent);
    if (currentPage() === 'home' && root.dataset.content === 'unified') unifiedView.refreshUpdates();
    else if (currentPage() === 'home' && root.dataset.section === 'manga') renderHome();
  }

  async function loadMoreCollection() {
    if (!state.collection.hasNext) return;
    const requested = state.collection;
    const btn = q('collectionMore');
    btn.disabled = true;
    btn.textContent = 'جارٍ التحميل…';
    try {
      const page = state.collection.page + 1;
      const r = state.collection.genre
        ? await browse({ genre: state.collection.genre.names, page })
        : state.collection.kind === 'globalPopular' ? await globalPopular(page)
        : state.collection.kind === 'latestListing' && page === 1
          ? await latestFirstPage()
          : await browse({ kind: state.collection.kind, page });
      if (requested !== state.collection) return;
      state.collection.page = r.page;
      state.collection.hasNext = r.hasNextPage;
      state.collection.items = root.dataset.section === 'manga' && requested.kind !== 'globalPopular'
        ? mergeWorkPages([...requested.items, ...r.items])
        : uniqueById([...requested.items, ...r.items]);
      if (!state.collection.items.length) {
        emptyState(q('collectionGrid'), {
          icon: 'search',
          title: 'ما فيه نتائج',
          text: state.collection.genre ? `ما لقينا مصدرًا فيه تصنيف «${state.collection.genre.ar}».` : 'المصادر ما رجّعت أعمالًا هنا.',
        });
      } else {
        renderGrid(q('collectionGrid'), state.collection.items);
        if (page === 1) stripIn([...q('collectionGrid').children].slice(0, 9));
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
      state.catalog = mergeWorkPages([...state.catalog, ...r.items]);
      if (!state.discoverQuery) renderGrid(q('discoverGrid'), state.catalog);
      btn.hidden = !state.catalogHasNext || !!state.discoverQuery;
    } catch {
      if (!state.catalog.length && await showAddMangaSource(q('discoverGrid'))) return;
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
    grid.parentNode?.querySelector('.search-refresh')?.remove();
    const snapshot = createFeedSnapshot({ key: (item) => canonicalRefOf(String(item.id)) });
    // حارس أخير في البحث: عمل بلا نسخة عربية واحدة، أو للكبار، لا يظهر مهما كان مساره
    const arabicOnly = (items) => items.filter((w) => !w._work || ((w._work.editions ?? []).some((e) => !isFiller(e.sourceId) && (!String(e.sourceId).includes('#') || /\.ar\./.test(String(e.sourceId)))) && !isAdult(w._work)));
    const paintSnapshot = (items) => {
      renderGrid(grid, snapshot.accept(arabicOnly(items)));
      let refresh = grid.parentNode?.querySelector('.search-refresh');
      if (snapshot.pending && !refresh) {
        refresh = el('button', 'feed-refresh search-refresh');
        refresh.type = 'button';
        refresh.onclick = () => { if (stillWanted() !== term) return; renderGrid(grid, snapshot.refresh()); refresh.remove(); };
        grid.after(refresh);
      }
      if (refresh) refresh.textContent = `${snapshot.pending} نتائج جديدة`;
    };
    try {
      const { items } = await browseLive({ query: term }, ({ items: partial }) => {
        if (stillWanted() === term && partial.length) paintSnapshot(partial);
      });
      if (stillWanted() !== term) return 0;
      if (items.length) paintSnapshot(items);
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
  // يُحفظ البحث النهائي وحده: «بحث» من لوحة المفاتيح، أو عملٌ فُتح من نتائجه — لا كل
  // ما توقّفت عنده الكتابة («Kar»، «Karil»، «Kariel»)
  const SEARCHES_KEY = 'vantara.v35.searches';
  const searches = recentStore(SEARCHES_KEY);
  const recentSearches = () => searches.list();
  function rememberSearch(term) {
    searches.remember(term);
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
    // توحيد المحتوى: بحث واحد في الأنواع الثلاثة (unified-search.js)
    if (root.dataset.content === 'unified') return unifiedSearch.open();
    if (root.dataset.section === 'anime' || root.dataset.section === 'cinema') {
      const host = root.dataset.section === 'anime' ? 'animeDiscover' : 'cinemaDiscover';
      showPage('discover');
      setTimeout(() => q(host)?.querySelector('input')?.focus(), 60);
      return;
    }
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
  const KIND_ICON = { FRAME: 'camera', RECOMMENDATION: 'spark', COMMENT_REPLY: 'edit', REACTION: 'heart', FRIEND_ACTIVITY: 'activity', SYSTEM: 'info', TOGETHER: 'users' };

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
      case 'TOGETHER': {
        const code = /#together=([A-Z0-9]{6})/.exec(row.link ?? '')?.[1] ?? null;
        const invite = code ? sync.rows('together_invites', (x) => x.code === code)[0] : null;
        // الدعوة قد تصل قبل صفها بالمزامنة: نوعها من مرجع العمل (الأنمي والسينما لهما بادئة)
        const reading = invite ? invite.kind === 'manga' : !/^(anime|cinema):/.test(row.series_ref ?? '');
        return {
          text: `يدعوك ${reading ? 'تقرأ' : 'تشاهد'} معه`,
          title: row.body ?? null,
          cover: work?.cover_url ?? null,
          open: () => code && together.joinByCode(code, invite),
        };
      }
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
    // «رفيق» لمن فُتح له وحده: غيره لا يرى له أثرًا
    const groups = rafiq.enabled && supports('rafiq') ? [[drawerGroups[0][0], [...drawerGroups[0][1], ['رفيق', 'rafiq', 'spark']]], ...drawerGroups.slice(1)] : drawerGroups;
    // الأقسام الثلاثة في رأس القائمة: التبديل من حيث تتنقّل، لا من الشعار وحده
    const sections = el('div', 'drawer-sections');
    sections.setAttribute('role', 'radiogroup');
    sections.setAttribute('aria-label', 'أقسام VANTARA');
    for (const id of ['manga', 'anime', 'cinema']) {
      const b = el('button', `drawer-section drawer-section--${id}`);
      b.type = 'button';
      b.dataset.arg = id;
      b.dataset.short = id[0].toUpperCase();
      b.title = { manga: 'مانجا', anime: 'أنمي', cinema: 'سينما' }[id];
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(root.dataset.section === id));
      const word = el('b', null, SECTIONS[id]?.word ?? id.toUpperCase());
      word.dir = 'ltr';
      b.append(word, el('small', null, { manga: 'مانجا', anime: 'أنمي', cinema: 'سينما' }[id]));
      b.onclick = () => {
        closeDrawer();
        selectSection(b.dataset.arg);
      };
      sections.append(b);
    }
    const laterLabel = (root.dataset.section ?? 'manga') === 'manga' ? 'أقرأ لاحقًا' : 'شاهد لاحقًا';
    q('drawerContent').replaceChildren(
      sections,
      ...groups.map(([label, items]) => {
        const g = el('div', 'drawer-group');
        if (label) g.append(el('div', 'drawer-label', label));
        for (const [text, key, ic] of items) {
          const b = el('button', 'drawer-item');
          b.type = 'button';
          if (key === 'majlisFeed') {
            // المجلس باسمه وصورته كما سمّيتموه، كخوادم ديسكورد، لا «المجلس» ونبضًا ثابتين
            const meta = sync.rows('majlis_meta', (m) => m.id === 'main')[0];
            const roomName = meta?.name || text;
            const pic = el('span', 'drawer-room-pic');
            if (meta?.avatar_key) {
              const img = new Image();
              img.alt = '';
              img.src = mediaUrl(meta.avatar_key);
              pic.append(img);
            } else pic.textContent = roomInitial(roomName);
            b.append(pic, el('span', null, roomName));
          } else {
            b.innerHTML = glyph(ic);
            b.append(el('span', null, key === 'later' ? laterLabel : text));
          }
          b.title = b.textContent;
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
    // رفيق ما تأكد بعد: نسأل الآن ونعيد بناء القائمة إن ظهر
    if (rafiq.enabled !== true && supports('rafiq')) void rafiq.check().then((on) => on && q('drawerBackdrop').classList.contains('open') && buildDrawer());
    buildDrawer();
    q('drawerBackdrop').classList.add('open');
  }
  // الشاشة العريضة (كمبيوتر، آيباد بالعرض): القائمة نفسها شريط ثابت بجانب
  // المحتوى بدل الشريط السفلي، فتُرسم مع كل تنقّل ليبقى «أنت هنا» صحيحًا
  function paintRail() {
    if (railReady && wideScreen?.matches) buildDrawer();
  }
  // مطويّ: أيقونات وشعار فقط. يُحفظ على الجهاز كاختيار شخصي
  const RAIL_KEY = 'vantara.rail.collapsed';
  root.classList.toggle('rail-collapsed', (() => {
    try {
      return localStorage.getItem(RAIL_KEY) === '1';
    } catch {
      return false;
    }
  })());
  function toggleRail() {
    const collapsed = !root.classList.contains('rail-collapsed');
    // انتقال عرض واحد: الشريط يضيق والمحتوى (والفصول بعمودين) يتمدد معه بنعومة
    const swap = () => root.classList.toggle('rail-collapsed', collapsed);
    const reduce = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (document.startViewTransition && !reduce) {
      root.classList.add('rail-moving');
      document.startViewTransition(swap).finished.finally(() => root.classList.remove('rail-moving'));
    } else swap();
    try {
      localStorage.setItem(RAIL_KEY, collapsed ? '1' : '0');
    } catch {
      // تفضيل عرض فقط
    }
  }
  /** الشعار: في الشريط المطويّ يفتحه، وفي المفتوح يرجع للرئيسية. */
  function railLogo() {
    if (root.classList.contains('rail-collapsed')) return toggleRail();
    navTo('home');
  }
  wideScreen?.addEventListener?.('change', () => {
    closeDrawer();
    paintRail();
  });
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
    if (key === 'rafiq') return supports('rafiq') ? showPage('rafiq') : undefined;
    if (key === 'insights') return showPage('insights');
    if (key === 'addons') return void openAddons();
    if (key === 'switchAccount') return confirmSwitchAccount();
    if (key === 'notifications') return openSocial('notifications');
    if (key === 'majlisFeed') return openRoom();
    if (key === 'profile') return openProfile(me());
    // التوصيات والنشاط صارا في المجلس نفسه: لا شاشة قديمة موازية
    if (key === 'recommendations') return openSocial('recs');
    if (key === 'friends') return openSocial('friends');
    if (key === 'activity') return openSocial('friends');
  }
  let sourceView = null, addonHubView = null, sourceSnapshot = null, addonViewGeneration = 0;
  let addonHubState = null, addonHubContext = null, addonSourcePending = false;
  const addonNavigation = createAddonNavigation();
  function closeAddonSource() {
    addonNavigation.cancel();
    if(addonHubView?.snapshot)addonHubState={context:addonHubContext,value:addonHubView.snapshot()};
    addonHubView?.close?.(); addonHubView=null;
    sourceView?.close?.(); sourceView=null;
    sourceSnapshot?.release(); sourceSnapshot=null;
  }
  function addonSourceError(error, retry) {
    const message = error?.code?.endsWith('TIMEOUT') ? 'انتهت مهلة فتح المصدر. أعد المحاولة.' : error?.message ?? 'تعذّر فتح المصدر';
    const button = el('button', 'addon-button', 'أعد المحاولة');
    button.onclick = () => { void retry(); };
    q('utilityBody').replaceChildren(el('p', 'work-meta', message), button);
  }
  async function openAddons() {
    closeAddonSource();
    addonSourcePending=false;
    addonHubContext=`${sync.user?.userId??"local"}|${root.dataset.section??"all"}`;
    const run=++addonViewGeneration;
    const profile=sync.user?.userId??'local';
    q('utilityTitle').textContent = 'الإضافات';
    showPage('utility');
    q('utilityBody').replaceChildren(el('p', 'work-meta', 'جارٍ قراءة الإضافات…'));
    try {
      const addons = await getAddonRuntime(); await addons.ready; await addons.registry.setProfile(sync.user?.userId ?? "local"); await addons.reloadSources?.();
      if(run!==addonViewGeneration || currentPage()!=='utility')return;
      // معاينة كل مصدر: آخر أعماله من لقطة «آخر التحديثات» المشتركة (بلا طلب جديد على المصدر)
      const shots = sync.latestSnapshots().then((d) => new Map((d?.sources ?? []).map((r) => [r.sourceId, r.value]))).catch(() => new Map());
      const latestOf = async (addon) => {
        if (!addon.bundled || !addon.sourceId) return [];
        // لقطة مشتركة أولًا؛ مصدر بلا لقطة (إضافة ثبّتها المستخدم للتو) يُسأل مباشرة
        const value = (await shots).get(addon.sourceId) ?? await addons.sourceLatest?.(addon.sourceId).catch(() => null);
        const list = value?.mangas ?? value?.items ?? (Array.isArray(value) ? value : []);
        const out = [];
        for (const item of list) {
          if (out.length >= 5) break;
          try { out.push({ work: sourceWorkModel(item, { addon, episodes: [] }) }); } catch { /* عمل بلا نوع مؤكد */ }
        }
        return out;
      };
      addonHubView = renderAddons({ initialState: addonHubState?.context===addonHubContext ? addonHubState.value : {}, registry: addons.registry, verification: sourceVerification, repositories: engine.repositories?.() ?? null, readySources: engine.readySources?.() ?? null, animeRepositories: animeRepositories(), cloudstreamRepositories: await addons.cloudstreamRepositories?.(), sites: engine.sites?.() ?? null, onSourcesChanged: async ({preserveAddonsView=false}={}) => { if(run!==addonViewGeneration || currentPage()!=='utility' || (sync.user?.userId??'local')!==profile)return; resetSources(); await withPhaseDeadline(Promise.resolve().then(()=>addons.reloadSources?.()),15_000,'ADDON_RELOAD_TIMEOUT').catch(()=>{}); if(run===addonViewGeneration && currentPage()==='utility' && (sync.user?.userId??'local')===profile && !preserveAddonsView)void openAddons(); }, filter: ['manga', 'anime', 'cinema'].includes(root.dataset.section) ? root.dataset.section : 'all', pulse: addons.pulse, latestOf, mountCover: (box, work) => mountImage(box, work), onProbe: (addon, options) => addons.diagnose(addon.key, options), onOpenSource: openAddonSource, onOpenNativeSource: openNativeAddonSource, onBack: goBack, onCheck: (addon, options) => diagnoseManagedAddon(addon, {runtime:addons,...options}), playbackHealth: (section) => sync.translation('/v1/diag/sources?days=7').then((r) => (r.status === 200 ? playbackHealth(r.body?.rows ?? [], { section }) : null)) });
      q('utilityBody').replaceChildren(addonHubView);
    } catch { if(run===addonViewGeneration && currentPage()==='utility')q('utilityBody').replaceChildren(el('p', 'work-meta', 'تعذّر قراءة الإضافات. المصادر الأصلية مستمرة.')); }
  }
  async function openNativeAddonSource(record, sourceId) {
    closeAddonSource();
    const generation=++addonViewGeneration, lookup=addonNavigation.begin();
    const profile=sync.user?.userId??'local';
    const active=()=>generation===addonViewGeneration && currentPage()==='utility' && (sync.user?.userId??'local')===profile;
    addonSourcePending=true;showPage('utility');
    q('utilityTitle').textContent=record.name??'المصدر';
    q('utilityBody').replaceChildren(el('p','work-meta','جارٍ فتح المصدر…'));
    try{
      const result=await lookup.wait(signal=>createNativeCatalog(record,{sourceId,signal}),'SOURCE_DISCOVERY_TIMEOUT');
      if(!active())return;
      if(result.status==='select-source'){
        const list=el('div','addon-source-choices');
        for(const source of result.sources){const b=el('button','addon-button',source.name);b.disabled=source.enabled===false;b.onclick=()=>{void openNativeAddonSource(record,source.sourceId);};list.append(b);}
        q('utilityBody').replaceChildren(list);return;
      }
      if(result.status!=='ready')throw new Error(result.reason??'محرك المصدر غير متاح على هذه المنصة');
      const addons=await lookup.wait(()=>getAddonRuntime(),'ADDON_RUNTIME_TIMEOUT');
      await lookup.wait(()=>addons.ready,'ADDON_READY_TIMEOUT');
      if(!active())return;
      await lookup.wait(()=>addons.registry.setProfile(profile),'ADDON_PROFILE_TIMEOUT');
      await lookup.wait(signal=>addons.reloadSources?.({signal}),'ADDON_RELOAD_TIMEOUT');
      if(!active())return;
      const canonical=addons.registry.list().find(addon=>addon.sourceId===result.sourceId);
      if(!canonical)throw new Error('المصدر مثبت، لكن المحرك لم يربطه بكتالوج صالح بعد. أعد فتح الإضافات.');
      await openAddonSource({...canonical,iconUrl:result.addon.iconUrl??canonical.iconUrl},undefined,{adapter:result.adapter,lookup,generation});
    }catch(error){if(active() && error?.name!=='AbortError')addonSourceError(error,()=>openNativeAddonSource(record,sourceId));}
    finally{lookup.finish();}
  }
  async function openAddonSource(addon, sourceState = {}, {adapter: nativeAdapter,lookup: continuedLookup,generation} = {}) {
    if(!continuedLookup)closeAddonSource();
    const run=continuedLookup?generation:++addonViewGeneration;
    const lookup=continuedLookup??addonNavigation.begin();
    const profile=sync.user?.userId??'local';
    const active=()=>run===addonViewGeneration && currentPage()==='utility' && (sync.user?.userId??'local')===profile;
    addonSourcePending=true;
    // شريط الصفحة: VANTARA وحدها (طلب المالك)، واسم المصدر في رأس الصفحة وحده (لا تكرار)
    q('utilityTitle').textContent='VANTARA';
    showPage('utility');
    q('utilityBody').replaceChildren(el('p','work-meta','جارٍ فتح المصدر…'));
    try{
    const addons=await lookup.wait(()=>getAddonRuntime(),'ADDON_RUNTIME_TIMEOUT');
    await lookup.wait(()=>addons.ready,'ADDON_READY_TIMEOUT');
    if(!active())return;
    await lookup.wait(()=>addons.registry.setProfile(profile),'ADDON_PROFILE_TIMEOUT');
    if(!active())return;
    sourceSnapshot=addons.registry.snapshot();
    addonSourcePending=false;
    const adapter = nativeAdapter ?? addons.adapter(addon.key);
    const openSelectedWork = async function openSelectedWork(item) {
      if(!active())return;
      const workLookup=addonNavigation.begin();
      try {
        const sourceId = addon.sourceId ?? `addon|${addon.key}`;
        const source = addons.sources.source(sourceId);
        if (!source || (item.type && !addon.contentTypes.includes(item.type))) throw new Error('يمكن تصفح هذا النوع من المحتوى، لكن فتحه غير مدعوم في هذا الإصدار.');
        let copy = { ...item, url: item.url ?? item.id, type: item.type };
        if(sourceId.startsWith('addon|cs3|') && !copy._nativeDetailsLoaded && nativeAdapter?.series){
          const details=await workLookup.wait(signal=>nativeAdapter.series(copy,{signal}),'SOURCE_DETAILS_TIMEOUT');if(!active())return;
          copy={...copy,...details.work,_nativeDetailsLoaded:true};
        }
        if (promptSourceWorkType(copy, addon, { el, openSheet, closeSheet, sheetItem, active: () => active() && !workLookup.signal.aborted, onChoose: openSelectedWork })) return;
        if(sourceId.startsWith('addon|cs3|') && copy.hasSeasons && copy.requestedSeason==null){
          if(!nativeAdapter?.seasons)throw new Error('اختيار مواسم هذا المصدر غير متاح في نسخة التطبيق الحالية.');
          const seasons=await workLookup.wait(signal=>nativeAdapter.seasons(copy,{signal}),'SOURCE_SEASONS_TIMEOUT');if(!active())return;
          if(!seasons.length)throw new Error('لم يُرجع المصدر مواسم قابلة للفتح.');
          openSheet(body=>{
            body.append(el('h3',null,'اختر الموسم'));
            for(const season of seasons)body.append(sheetItem('layers',season.title,()=>{
              closeSheet();if(active())void openSelectedWork({...copy,...season,_nativeDetailsLoaded:true});
            }));
          });return;
        }
        const episodes = addon.contentTypes.includes('manga') ? [] : await workLookup.wait(signal=>source.episodes(copy,{signal}),'SOURCE_EPISODES_TIMEOUT');
        if(!active())return;
        // بطاقة العمل الأصلية (هوية AniList/IMDb المحسومة غالبًا من رسم الشبكة) وسيرفرات هذا المصدر وحده
        const identity = addon.contentTypes.includes('manga') && !addon.contentTypes.some(t => t !== 'manga') ? null
          : await Promise.race([resolveSourceIdentity(copy, addon), new Promise(r => setTimeout(() => r(null), 1500))]);
        if(!active())return;
        const work = withOfficialIdentity(sourceWorkModel(sourceId.startsWith('addon|cs3|')?copy:item, { addon, episodes }), identity);
        // كل عمل يُفتح ببطاقة نوعه هو، لا بنوع الإضافة: مصدر متنوع قد يحمل مانجا داخل واجهة أنمي
        const itemType = String(item.type ?? '').toLowerCase();
        if (work._work || itemType === 'manga') { applySection('manga'); buildDrawer(); await workLookup.wait(()=>openWork(work),'SOURCE_WORK_TIMEOUT'); }
        else if (itemType === 'anime' || (!['movie', 'series', 'tv'].includes(itemType) && addon.contentTypes.includes('anime'))) { applySection('anime'); buildDrawer(); await workLookup.wait(()=>anime.openAnime(work),'SOURCE_WORK_TIMEOUT'); }
        else { applySection('cinema'); buildDrawer(); await workLookup.wait(()=>cinema.openWork(work),'SOURCE_WORK_TIMEOUT'); }
      } catch (error) {
        if(!active() || error?.name==='AbortError')return;
        toast(error.message);
        openSheet(body=>{body.append(el('p','work-meta',error.message??'تعذّر فتح العمل'),sheetItem('refresh','أعد المحاولة',()=>{closeSheet();void openSelectedWork(item);}));});
      } finally { workLookup.finish(); }
    };
    // صفحة المصدر واحدة (source-mode.js): بحث وأعمال المصدر، والرجوع إلى الإضافات من شريط الصفحة
    sourceView?.close?.();
    // مصدر أنمي/سينما أصلي (Aniyomi) يطلب تحقق Cloudflare: صفحة التحقق داخل التطبيق ثم إعادة الجلب
    const verifiable = Boolean(nativeAdapter) && addon.sourceId && !String(addon.sourceId).startsWith('addon|cs3|') && !addon.contentTypes.includes('manga');
    sourceView = renderSourceMode({ addon, adapter, pulse: addons.pulse, state: sourceState ?? {}, onBack: openAddons, onOpenWork: openSelectedWork, onVerify: verifiable ? () => verifyAnimeSource(addon.sourceId) : null });
    q('utilityBody').replaceChildren(sourceView);
    }catch(error){if(active() && error?.name!=='AbortError')addonSourceError(error,()=>openAddonSource(addon,sourceState,{adapter:nativeAdapter}));}
    finally{lookup.finish();}
  }
  // ───────────────────────── PIN وحذف الحساب ─────────────────────────

  /** ردّ الخادم بلغة لوحة PIN. */
  const padResult = (out) => {
    if (out.ok) return { ok: true };
    const error = out.data?.error ?? 'other';
    const message = error === 'bad_pin' ? 'الرمز أرقام فقط: 4 أو 6' : error === 'pin_wrong' ? 'رمز غير صحيح' : error === 'pin_locked' ? undefined : 'تعذّر الحفظ. حاول مرة ثانية';
    return { error, retryAt: out.data?.retryAt ?? null, message };
  };
  const pinFace = () => {
    const profile = sync.rows('profiles', (p) => p.user_id === me())[0];
    const name = profile?.display_name || sync.user?.displayName || '';
    return { avatar: profile?.avatar_key ?? null, initial: [...name][0] || '؟' };
  };

  function createPin() {
    pinPad({
      mode: 'create',
      title: 'رمز PIN لحسابك',
      ...pinFace(),
      submit: async (pin) => padResult(await sync.setPin(pin)),
      onDone: () => {
        toast('حسابك صار محمي برمز');
        renderSettings();
      },
    });
  }

  /** الرمز الحالي أولًا (يُحسب من محاولات القفل كأي إدخال)، ثم الجديد. */
  function askCurrentPin(title, then) {
    pinPad({
      mode: 'enter',
      digits: sync.user?.pinDigits,
      title,
      subtitle: 'اكتب رمزك الحالي',
      ...pinFace(),
      submit: async (pin) => {
        try {
          await sync.unlock(pin);
          setTimeout(() => then(pin), 200);
          return { ok: true };
        } catch (error) {
          if (error?.code === 'pin_wrong' || error?.code === 'pin_locked') return { error: error.code, retryAt: error.retryAt };
          return { error: error?.status ? 'other' : 'network', message: 'تعذّر التحقق. حاول مرة ثانية' };
        }
      },
    });
  }

  function managePin() {
    openSheet((body) => {
      body.append(el('h3', null, 'رمز PIN'));
      body.append(el('p', null, `حسابك محمي برمز من ${sync.user?.pinDigits} أرقام. يُطلب كل ما فُتح التطبيق على حسابك.`));
      const actions = el('div', 'sheet-actions');
      const remove = el('button', 'btn btn-secondary', 'إزالة الرمز');
      remove.type = 'button';
      remove.onclick = () => {
        closeSheet();
        pinPad({
          mode: 'enter',
          digits: sync.user?.pinDigits,
          title: 'إزالة الرمز',
          subtitle: 'اكتب رمزك الحالي',
          ...pinFace(),
          submit: async (pin) => padResult(await sync.removePin(pin)),
          onDone: () => {
            toast('أُزيل الرمز');
            renderSettings();
          },
        });
      };
      const change = el('button', 'btn btn-primary', 'تغيير الرمز');
      change.type = 'button';
      change.onclick = () => {
        closeSheet();
        askCurrentPin('تغيير الرمز', (current) =>
          pinPad({
            mode: 'create',
            title: 'الرمز الجديد',
            ...pinFace(),
            submit: async (pin) => padResult(await sync.setPin(pin, current)),
            onDone: () => {
              toast('تغيّر الرمز');
              renderSettings();
            },
          }),
        );
      };
      actions.append(remove, change);
      body.append(actions);
    });
  }

  function confirmDeleteAccount() {
    openSheet((body) => {
      body.append(el('h3', null, 'حذف الحساب؟'));
      body.append(el('p', null, 'يُحذف حسابك من السيرفر بكل ما فيه: مكتبتك، تقدّمك، تقييماتك، رسائلك وصورك. بعد الحذف ما يرجع.'));
      const actions = el('div', 'sheet-actions');
      const cancel = el('button', 'btn btn-secondary', 'إلغاء');
      cancel.type = 'button';
      cancel.onclick = () => closeSheet();
      const ok = el('button', 'btn btn-danger', 'نعم أوافق');
      ok.type = 'button';
      let graceMs = 10_000;
      ok.onclick = async () => {
        closeSheet();
        if (sync.user?.pinDigits) {
          pinPad({
            mode: 'enter',
            digits: sync.user.pinDigits,
            title: 'تأكيد الحذف',
            subtitle: 'اكتب رمزك لحذف الحساب',
            ...pinFace(),
            submit: async (pin) => {
              const out = await sync.deleteAccount(pin);
              if (out.ok) graceMs = Number(out.data?.graceMs) || 10_000;
              return padResult(out);
            },
            onDone: () => showDeleting(graceMs),
          });
          return;
        }
        const out = await sync.deleteAccount().catch(() => ({ ok: false }));
        if (out.ok) showDeleting(Number(out.data?.graceMs) || 10_000);
        else toast('تعذّر الحذف. تأكد من النت وحاول مرة ثانية');
      };
      actions.append(cancel, ok);
      body.append(actions);
    });
  }

  /**
   * «جارٍ حذف الحساب من السيرفر»: الحساب على الخادم PENDING_DELETE — لا شيء
   * مُسح بعد ولا اسمه تحرر. عشر ثوانٍ وزر تراجع يعيده ACTIVE فورًا؛ بعدها فقط
   * يبدأ المسح النهائي. ولو أُغلق التطبيق في المنتصف يكمله الخادم وحده.
   */
  function showDeleting(graceMs = 10_000) {
    const SECONDS = Math.max(1, Math.round(graceMs / 1000));
    const wrap = el('div', 'vdel');
    wrap.setAttribute('role', 'alertdialog');
    wrap.setAttribute('aria-modal', 'true');
    const box = el('div');
    const ring = el('div', 'vdel__ring');
    const count = el('div', 'vdel__count', String(SECONDS));
    const title = el('h2', 'vdel__title', 'جارٍ حذف الحساب من السيرفر');
    const text = el('p', 'vdel__text', 'تقدر تتراجع قبل ما يخلص العدّ.');
    const undo = el('button', 'vdel__undo', 'تراجع');
    undo.type = 'button';
    box.append(ring, count, title, text, undo);
    wrap.append(box);
    document.body.append(wrap);
    const start = performance.now();
    let raf = 0;
    let done = false;
    const tick = () => {
      const left = Math.max(0, SECONDS * 1000 - (performance.now() - start));
      ring.style.setProperty('--p', String(left / (SECONDS * 1000)));
      count.textContent = String(Math.ceil(left / 1000));
      if (left <= 0) return void finish();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    async function finish() {
      if (done) return;
      done = true;
      cancelAnimationFrame(raf);
      undo.hidden = true;
      title.textContent = 'نحذف حسابك…';
      text.textContent = '';
      await sync.commitDeletion().catch(() => {});
      wrap.remove();
      deps.switchAccount();
    }
    undo.onclick = async () => {
      if (done) return;
      cancelAnimationFrame(raf);
      undo.disabled = true;
      undo.textContent = 'نرجّع حسابك…';
      const out = await sync.restoreAccount().catch(() => ({ ok: false }));
      if (out.ok && out.data?.restored) {
        done = true;
        wrap.remove();
        toast('رجع حسابك كما كان');
        return;
      }
      text.textContent = 'ما قدرنا نتراجع: فات الوقت أو انقطع النت.';
      void finish();
    };
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
  // موضع التمرير لكل صفحة غادرها المستخدم إلى أخرى: الرجوع يعيده حيث كان (الصفحة نفسها باقية
  // في الذاكرة بعناصرها المحمّلة وفلاترها؛ كان showPage يصعد للأعلى دائمًا فيضيع المكان)
  const scrollOf = new Map();
  let scrollRestore = 0;
  let scrollRestoreCleanup = null;
  function restoreScroll(top) {
    scrollRestoreCleanup?.();
    const run = ++scrollRestore;
    window.scrollTo({ top, behavior: 'instant' });
    // صفحة تُرسم بعد الإظهار (المكتبة، الرئيسية): نعيد المحاولة حين يكتمل طولها، ما لم يلمس المستخدم
    let touched = false;
    const timers = [];
    const cleanup = () => {
      removeEventListener('touchstart', stop);
      removeEventListener('wheel', stop);
      for (const timer of timers) clearTimeout(timer);
      if (scrollRestoreCleanup === cleanup) scrollRestoreCleanup = null;
    };
    const stop = () => { touched = true; cleanup(); };
    scrollRestoreCleanup = cleanup;
    addEventListener('touchstart', stop, { once: true, passive: true });
    addEventListener('wheel', stop, { once: true, passive: true });
    for (const wait of [0, 120, 400]) timers.push(setTimeout(() => {
      if (run === scrollRestore && !touched && Math.abs(window.scrollY - top) >= 2) window.scrollTo({ top, behavior: 'instant' });
      if (wait === 400) cleanup();
    }, wait));
  }
  let pageMotionRequest = 0;
  /** القسم يعلن أن أساس صفحة العمل جاهز (البيانات والغلاف المحسوم): يبدأ الانتقال الآن لا عند المهلة. */
  function workReady() {
    state.workGate?.ready();
  }
  /** الانتقال بدأ قبل أن يكتمل أساس الصفحة (المهلة): ما يصل الآن يظهر بتلاشٍ في مكانه (settleIn). */
  const workShown = () => !state.workGate || state.workGate.opened;
  const WORK_PAGES = new Set(['detail', 'anime', 'cinema']);
  function showPage(id, { push = true, sectionSwitch = false, sourceScroll = null } = {}) {
    // الإشعارات صارت قسمًا في «الاجتماع»
    if (id === 'notifications') {
      state.socialTab = 'notifications';
      id = 'majlis';
    }
    const from = currentPage();
    // An overlay owns the visual transition; do not animate Home beneath the old subpage.
    const unifiedHandoff = Boolean(unifiedReturn && WORK_PAGES.has(id) && from !== id);
    const unifiedRestore = Boolean(unifiedReturn && !push && id === unifiedReturn.page && WORK_PAGES.has(from));
    if (unifiedReturn && push && MAIN_PAGES.includes(id) && id !== from) {
      unifiedSurfaces()[unifiedReturn.kind]?.discardSuspended?.();
      unifiedReturn = null;
    }
    const visual = pageMotionState(q(from));
    // الوجهة قد تكون في منتصف حركتها (رجوع يقاطع فتحًا): تكمل من حيث هي ظاهرة الآن
    const destVisual = from !== id ? pageMotionState(q(id)) : null;
    sourceScroll ??= visual?.scrollTop ?? window.scrollY;
    if (from !== id) scrollOf.set(from, sourceScroll);
    if(from === "utility" && id !== "utility"){sourceView?.pause?.();addonNavigation.cancel();}
    if(MAIN_PAGES.includes(id)){addonViewGeneration++;closeAddonSource();}
    // خرجت من صفحة العمل: ينتهي تفعيل «عند الطلب» له (الفصل ليس صفحة هنا؛ الرجوع منه يبقيك فيها)
    if (from === 'detail' && id !== 'detail' && state.current) endWorkSession(String(state.current.id));
    if (MAIN_PAGES.includes(id)) state.stack = [];
    else if (push && from !== id) state.stack.push(from);
    // تلاشٍ مع حركة: الخارجة للخارج والداخلة للداخل، والرجوع عكسه. تبديل القسم الرئيسي له حركته، فيُنهي الجاري
    const request = ++pageMotionRequest;
    // المؤشر يُقاس ويتحرك قبل أي كتابة في الصفحات: القياس بعدها كان يفرض تخطيطًا ثانيًا للصفحة كلها
    // (56ms على جوال متوسط في المقياس) قبل أن تبدأ حركة الشريط، فيتقطّع الشريط مع كل انتقال
    const dockFirst = from !== id && MAIN_PAGES.includes(from) && MAIN_PAGES.includes(id) && !q('bottomNav').hidden;
    if (dockFirst) dockCtl?.activate(id);
    const outgoing = from !== id && !sectionSwitch && !unifiedHandoff ? q(from) : null;
    finishPageMotion();
    // دخول صفحة عمل: الانتقال كله (خروج السابقة ودخولها) ينتظر جاهزية أساسها أو المهلة، فلا تُرى نصف مبنية
    state.workGate?.ready();
    const gate = WORK_PAGES.has(id) && from !== id && push && !sectionSwitch && !unifiedRestore ? readyGate() : null;
    state.workGate = gate;
    // رجوع إلى طبقة الموحد: العمل يغادر بالعقد نفسه (لا يُمسَك معتمًا)، والرئيسية تحت الطبقة محجوبة حتى تكتمل
    if (outgoing) pageOut(outgoing, { depth: WORK_PAGES.has(from), visual, scrollTop: sourceScroll, gate: gate?.promise });
    if (unifiedRestore) veil(q(id));
    root.querySelectorAll('.page').forEach((p) => p.classList.toggle('active', p.id === id));
    const nav = q('bottomNav');
    if (MAIN_PAGES.includes(id)) {
      const entering = nav.hidden && from !== id;
      nav.hidden = false;
      if (entering) dockIn(nav);
    } else if (!nav.hidden && !nav.inert) {
      dockOut(nav, { onComplete: () => { if (!MAIN_PAGES.includes(currentPage())) nav.hidden = true; } });
    }
    playDockMotion();
    if (!MAIN_PAGES.includes(id)) dockCtl?.close({ focus: false, instant: true });
    if (id !== 'home') layers?.finish();
    dockCtl?.repaint();
    root.querySelectorAll('.nav').forEach((n) => {
      const on = n.dataset.page === id;
      n.classList.toggle('active', on);
      if (on) n.setAttribute('aria-current', 'page');
      else n.removeAttribute('aria-current');
    });
    if (!dockFirst) dockCtl?.activate(id); // الدائرة تنتقل للوجهة الجديدة
    q('detailTop').classList.remove('collapsed');
    if (id !== 'detail') {
      closeDetailMenu();
      exitMarkMode();
    }
    if (from === 'anime' && id !== 'anime') anime.leaveDetail();
    const inAnime = root.dataset.section === 'anime';
    const inCinema = root.dataset.section === 'cinema';
    // خلل «إعادة رسم الشريط السفلي» (8 نوفمبر): رسم الصفحة الثقيلة (40–110ms على جوال متوسط) كان يجري في
    // الإطار نفسه الذي تبدأ فيه حركة مؤشر الشريط، فتضيع إطاراتها الأولى ويبدو الشريط كأنه يُعاد رسمه.
    // بين وجهات الشريط: المؤشر يُسلَّم للمؤلِّف أولًا، والرسم بعد أول إطار (والصفحة الداخلة في أول تلاشيها).
    const dockHop = from !== id && MAIN_PAGES.includes(from) && MAIN_PAGES.includes(id) && typeof requestAnimationFrame === 'function';
    const afterDock = (fn) => {
      if (!dockHop) return fn();
      requestAnimationFrame(() => setTimeout(() => { if (request === pageMotionRequest && currentPage() === id) fn(); }, 0));
    };
    if (id === 'library') afterDock(renderActiveLibrary);
    if (id === 'discover') afterDock(() => {
      if (root.dataset.content === 'unified') return unifiedDiscover.render(q('unifiedDiscover'));
      if (inAnime) anime.showDiscover();
      // رجوع إلى قائمة السينما: تبقى كما تُركت (كان showList يعيد بناء الشبكة من الصفر فتضيع العناصر والموضع)
      else if (inCinema) { if (push || !q('cinemaDiscover')?.childElementCount) cinema.showDiscover(); }
      else if (!state.catalog.length) void loadMoreDiscover();
    });
    if (id === 'rafiq' && supports('rafiq')) void rafiq.show();
    // الرئيسية الموحدة لا تُبنى من جديد عند الرجوع إلا إن تغيّرت بياناتها (كانت تُبنى كل مرة: تضيع مواضع
    // الشرائط وتُفكّ الصور من جديد، فيبدو التطبيق كأنه يعيد التحميل)
    if (id === 'home' && from !== 'home' && root.dataset.content === 'unified') afterDock(() => renderAllHome({ ifChanged: true }));
    if (id === 'home' && root.dataset.section === 'manga' && !sectionSwitch && root.dataset.content !== 'unified') {
      afterDock(() => {
        if (from !== 'home') { for (const snapshot of homeSnapshots.values()) snapshot.refresh(); refreshFriendsHero(); renderHome(); }
        void refreshHomeUpdates();
      });
    }
    // رفيق بلا شريط سفلي: لا مساحة محجوزة له تحت خانة الكتابة
    root.querySelector('.app')?.classList.toggle('app--chat', id === 'rafiq');
    if (id === 'settings' || id === 'settingsPane') {
      usageAsked = false; // الصرف يُقرأ من جديد كل مرة تفتح الإعدادات
      renderSettings();
    }
    if (id === 'insights') void insights.show();

    if (id !== 'majlis' || state.socialTab !== 'notifications') state.notifFresh = null;
    if (id === 'majlis') {
      try {
        renderSocial();
      } catch (error) {
        console.error('تعذّر رسم الاجتماع', error);
        q('friendsBody').hidden = false;
        q('majlisBody').hidden = true;
        q('socialNotifs').hidden = true;
        emptyState(q('friendsBody'), { icon: 'offline', error: true, title: 'تعذّر عرض الاجتماع', text: 'أعد فتح القسم للمحاولة.', action: { label: 'أعد المحاولة', icon: 'refresh', run: () => renderSocial() } });
      }
      // وصلتَ للمجلس = رأيت التفاعلات على رسائلك فيه
      for (const n of sync.rows('notifications', (x) => x.user_id === me() && !x.read && x.kind === 'REACTION' && String(x.link ?? '').startsWith('vantara://majlis/'))) {
        sync.enqueue('notification.read', { id: n.id });
      }
    } else {
      majlis.hide();
      friends.hide();
      // صفحة أخرى فُتحت (إشعار، رابط): المحادثة لا تبقى معلّقة فوقها
      room.close();
    }
    if (id !== 'profile') profile?.hide();
    paintRail();
    // رجوع: إلى حيث كان. انتقال جديد: من الأعلى
    if (!push && from !== id && scrollOf.has(id)) restoreScroll(scrollOf.get(id));
    else { scrollRestore++; scrollRestoreCleanup?.(); window.scrollTo({ top: 0, behavior: 'instant' }); }
    if(id === 'utility')sourceView?.resume?.();
    // Renderers build the work synchronously after showPage; measure its real cover once afterwards.
    if (!sectionSwitch && !unifiedRestore && (from !== id || (push && !MAIN_PAGES.includes(id)))) {
      const enter = () => {
        if (request === pageMotionRequest && currentPage() === id) pageMotionIn(q(id), { depth: WORK_PAGES.has(id), gate: gate?.promise, from: destVisual });
      };
      if (WORK_PAGES.has(id)) queueMicrotask(enter);
      else enter();
    }
    if (unifiedHandoff) {
      const handoff = unifiedReturn;
      // The work page is already active underneath an opaque origin modal.
      // Fade the EXISTING origin instead of removing it on the next frame.
      queueMicrotask(() => {
        if (unifiedReturn !== handoff || currentPage() !== id) return;
        const surface = unifiedSurfaces()[handoff.kind];
        handoffSurface(surface?.motionNode?.(), {
          gate: gate?.promise,
          onComplete: () => {
            if (unifiedReturn === handoff) surface?.hideSuspended?.();
          },
        });
      });
    }
  }
  function navTo(id) {
    if (id === 'notifications') return openSocial('notifications');
    if (id === 'friends') return openSocial('friends');
    showPage(id);
  }
  function openMajlis(only) {
    if (only === 'recs') return openSocial('recs');
    openRoom();
  }
  /** المجلس محادثة فوق صفحة الأصدقاء: الرجوع منه يرجعك لبابه. */
  function openRoom(focus) {
    if (currentPage() !== 'majlis' || state.socialTab !== 'friends') openSocial('friends');
    room.open(focus);
  }

  // ───────────────────────── الاجتماع ─────────────────────────
  // ثلاثة أقسام تحت سقف واحد: الأصدقاء (ومنهم باب المجلس وآخر ما صار)، ثم
  // الإشعارات، ثم التوصيات. المجلس نفسه ليس تبويبًا: يُدخل من بابه.

  const SOCIAL_TABS = [
    ['friends', 'الأصدقاء'],
    ['notifications', 'الإشعارات'],
    ['recs', 'التوصيات'],
  ];
  function openSocial(tab = state.socialTab ?? 'friends') {
    state.socialTab = tab;
    if (currentPage() !== 'majlis') showPage('majlis');
    else renderSocial();
  }
  function renderSocial() {
    try {
      renderSocialContent();
    } catch (error) {
      console.error('تعذّر رسم الاجتماع', error);
      q('friendsBody').hidden = false;
      q('majlisBody').hidden = true;
      q('socialNotifs').hidden = true;
      emptyState(q('friendsBody'), { icon: 'offline', error: true, title: 'تعذّر عرض الاجتماع', text: 'حدث خلل في المحتوى.', action: { label: 'أعد المحاولة', icon: 'refresh', run: renderSocial } });
    }
  }
  function renderSocialContent() {
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
    q('majlisBody').hidden = tab !== 'recs';
    q('socialNotifs').hidden = tab !== 'notifications';
    if (tab === 'friends') {
      majlis.hide();
      friends.show();
      if (!q('friendsBody').childElementCount) throw new Error('Friends screen rendered empty');
    } else if (tab === 'notifications') {
      majlis.hide();
      friends.hide();
      renderNotifications();
    } else {
      friends.hide();
      majlis.show('recs');
    }
  }

  /** رجوع داخل الواجهة. يرجع `false` إن لم يبقَ شيء يُرجَع إليه. */
  function goBack() {
    // داخل الإضافات: الرجوع خطوة واحدة (صفحة إضافة ← المتجر، مصدر ← المتجر) قبل مغادرة الإضافات كلها
    if (currentPage() === 'utility') {
      if (addonHubView?.back?.()) return true;
      if (sourceView || addonSourcePending) { void openAddons(); return true; }
    }
    const prev = state.stack.pop();
    if (prev) {
      showPage(prev, { push: false });
      if (unifiedReturn && prev === unifiedReturn.page && root.dataset.content === 'unified') {
        const surface = unifiedSurfaces()[unifiedReturn.kind];
        // showPage holds the outgoing work opaque while this origin fades in.
        surface?.resume?.();
        handoffSurface(surface?.motionNode?.(), {enter:true});
        unifiedReturn = null;
      }
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
  diagnosticsUi.subscribe(() => {
    if (onSettings()) renderSettings();
    if (!diagnosticsUi.visible() && root.querySelector('[data-diagnostic-sheet]')) closeSheet();
  });
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
    if (translationLocked()) {
      const locked = el('div', 'setting');
      locked.innerHTML = glyph('lock');
      const t = el('div');
      t.append(el('strong', null, 'الترجمة العربية'));
      t.append(el('small', null, 'قيد التطوير — تنفتح لك قريبًا'));
      locked.append(t);
      return group('الترجمة', [locked]);
    }
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
            if (onSettings()) renderSettings();
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
      if (diagnosticsUi.visible()) rows.push(
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
        if (onSettings()) renderSettings();
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
        const sub = q(currentPage() === 'settingsPane' ? 'settingsPaneBody' : 'settingsBody')?.querySelector('.setting small');
        if (sub && onSettings()) renderSettings();
      });
      toast('ملفات الترجمة جاهزة');
    } catch {
      toast('ما اكتمل التحميل — جرّب مرة ثانية');
    } finally {
      modelsBusy = null;
      modelsInfo = null;
      if (onSettings()) renderSettings();
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
  /** إعداداتك المتزامنة (`settings.data`): الخصوصية ومصفاة «آخر ما صار». */
  function mySettings() {
    try {
      return JSON.parse(sync.row('settings', me())?.data ?? '{}') ?? {};
    } catch {
      return {};
    }
  }
  function setMySettings(fields) {
    sync.enqueue('settings.patch', { fields });
  }

  /** سجل التحديثات: المشترك + ما يخص هذه المنصة (lib/release.js). */
  function openWhatsNew() {
    const KIND = { new: 'جديد', fix: 'إصلاح', improve: 'تحسين' };
    openSheet((body) => {
      body.append(el('h3', null, 'ما الجديد'));
      const platform = currentPlatform();
      body.append(el('p', 'an-note', `الإصدار المثبت: ${platform === 'pwa' ? 'PWA' : 'APK'} · ${deps.version || RELEASE.version}`));
      if (platform === 'pwa') body.append(el('p', 'an-note', 'تحديث PWA مستقل عن رقم APK. يصلك على الجوال والكمبيوتر؛ زر «تحديث التطبيق» يفحص نسخة الويب، وتطبيق التحديث يعيد تحميلها.'));
      for (const release of releaseNotesFor(currentPlatform())) {
        body.append(el('div', 'settings-group-label settings-sublabel', `${RELEASE.product} ${release.version} · ${release.date}`));
        const list = el('ul', 'whats-new');
        for (const item of release.items) {
          const li = el('li');
          li.append(el('span', `whats-new__kind whats-new__kind--${item.kind}`, KIND[item.kind] ?? ''), el('span', null, item.text));
          list.append(li);
        }
        body.append(list);
      }
    });
  }

  function openHiddenArchive() {
    openSheet((body) => {
      const paint = () => {
        body.replaceChildren(el('h3', null, 'أرشيف الأعمال المحذوفة'));
        const list = hiddenWorks();
        if (!list.length) { body.append(el('p', 'settings-note', 'ما حذفت أي عمل.')); return; }
        for (const h of list) {
          const line = el('div', 'hidden-work');
          line.style.cssText = 'display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--line)';
          if (h.cover) { const img = el('img'); img.src = h.cover; img.alt = ''; img.style.cssText = 'width:44px;height:62px;border-radius:8px;object-fit:cover;flex:none'; line.append(img); }
          const t = el('strong', null, h.title || 'عمل'); t.dir = 'auto'; t.style.flex = '1';
          const back = el('button', 'btn btn-secondary', 'إعادة العمل'); back.type = 'button';
          back.onclick = () => { restoreWork(h.id); toast('رجع العمل'); paint(); renderSettings(); };
          line.append(t, back);
          body.append(line);
        }
      };
      paint();
    }, { tone: 'manga' });
  }
  /** فئة الإعدادات المفتوحة: صفحتها بنظام الصفحات نفسه (تلاشٍ ورجوع)، والرئيسية قائمة الفئات. */
  function openSettingsPane(id) {
    if (id === 'addons') return void openAddons();
    state.settingsPane = id;
    showPage('settingsPane');
  }
  const onSettings = () => ['settings', 'settingsPane'].includes(currentPage());
  function renderSettings() {
    const pane = currentPage() === 'settingsPane' ? categoryOf(state.settingsPane)?.id ?? null : null;
    const body = q(pane ? 'settingsPaneBody' : 'settingsBody');
    if (!body) return;
    body.replaceChildren();
    if (pane) q('settingsPaneTitle').textContent = categoryOf(pane).title;
    const on = (id) => pane === id;
    const api = deps.settings;
    // عنوان المجموعة: كلمة لاتينية صغيرة فوق العنوان العربي، كأقسام الرئيسية
    const EYEBROWS = { 'المظهر': 'APPEARANCE', 'الحساب': 'ACCOUNT', 'الخصوصية': 'PRIVACY', 'التنبيهات': 'ALERTS', 'الترجمة': 'TRANSLATION', 'ملفات الترجمة على الجوال': 'MODELS', 'المساعدة': 'HELP', 'عن التطبيق': 'ABOUT', 'منطقة الخطر': 'DANGER' };
    const group = (label, rows, { note, cls } = {}) => {
      if (label) {
        const head = el('div', `settings-group-label${cls ? ` ${cls}-label` : ''}${EYEBROWS[label] ? '' : ' settings-sublabel'}`);
        if (EYEBROWS[label]) {
          const eb = el('span', 'settings-eyebrow', EYEBROWS[label]);
          eb.dir = 'ltr';
          head.append(eb);
        }
        head.append(el('span', 'settings-title', label));
        body.append(head);
      }
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

    // رأس الصفحة: أنت. الصورة والاسم يفتحان ملفّك (كان صفًّا بين الصفوف)
    if (!pane) {
    const profile = sync.rows('profiles', (p) => p.user_id === me())[0];
    const name = profile?.display_name || sync.user?.displayName || sync.user?.username || 'حسابي';
    const meCard = el('button', 'settings-me');
    meCard.type = 'button';
    const who = el('span', 'settings-me-text');
    who.append(el('strong', null, name));
    if (sync.user?.username) {
      const handle = el('small', null, `@${sync.user.username}`);
      handle.dir = 'ltr';
      who.append(handle);
    }
    meCard.append(avatarNode({ avatarKey: profile?.avatar_key, displayName: name }, 56), who, el('span', 'settings-me-cta', 'ملفّك'));
    meCard.insertAdjacentHTML('beforeend', glyph('chevron', { cls: 'icon chev' }));
    meCard.onclick = () => openProfile(me());
    body.append(meCard);

    // الفئات: كل واحدة تفتح صفحة خياراتها وحدها
    const health = api?.health?.();
    body.append(appearanceFeature({ el, glyph }, () => openSettingsPane('appearance')));
    group('', CATEGORIES.filter((c) => c.id !== 'appearance').map((c) => row(c.icon, c.title, c.sub, {
      value: c.id === 'sync' && health ? health.message : null,
      tone: c.id === 'sync' && health ? (health.state !== 'ok' && health.state !== 'syncing' ? 'warn' : undefined) : undefined,
      run: () => openSettingsPane(c.id),
    })), { cls: 'settings-cats' });
    }

    // المظهر والتخصيص: البطاقات والألوان والخلفية وبنية العرض (settings-center.js)
    if (on('appearance')) {
      renderAppearancePane(body, {
        el, glyph, openSheet, closeSheet, toast, patchAppearance,
        // المظهر يغيّر الألوان فقط؛ البنية وحدها تعيد التجربة (الشريط والرئيسية). فصلهما يجعل
        // اختيار نمط أو لون لمسة خفيفة بدل إعادة بناء الرئيسية الموحدة كل مرة
        apply: (kind) => (kind === 'structure' ? applyExperience() : applySection(root.dataset.section)),
        rerender: () => renderSettings(),
      });
      return;
    }

    if (on('accounts')) group('الحساب', [
      row('switchUser', 'تبديل الحساب', null, { run: confirmSwitchAccount }),
      sync.deleteAccount ? row('trash', 'حذف الحساب', null, { danger: true, run: confirmDeleteAccount }) : null,
      sync.approveDevice
        ? row('shield', 'اعتماد جوال جديد', 'برمز الجوال الجديد', {
            value: pendingPhones ? `${pendingPhones} ينتظر` : null,
            tone: pendingPhones ? 'warn' : undefined,
            run: openApprovePhone,
          })
        : null,
    ]);
    if (on('accounts')) group('', [el('p', 'settings-note', 'الخوادم ومساحات الأصدقاء قادمة؛ الخيارات الحالية كما هي.')]);
    // الخصوصية: قفل الحساب أولًا، ثم اتجاهان لا يختلطان — ما يراه غيري عني، وما أراه أنا
    if (on('privacy') && sync.setPin) {
      const digits = sync.user?.pinDigits;
      group('الخصوصية', [
        row('lock', 'رمز PIN', digits ? `${digits} أرقام — يُطلب كل ما فُتح حسابك` : 'رمز من أرقام يُطلب كل ما فُتح حسابك', {
          value: digits ? 'مفعّل' : 'مغلق',
          tone: digits ? 'ok' : undefined,
          run: digits ? managePin : createPin,
        }),
      ]);
    }
    const privacy = mySettings();
    if (on('privacy')) group(
      'ما يراه أصدقاؤك',
      [
        toggle('activity', 'إحصائيات المتابعة', 'مدتك وتقدّمك في صفحة العمل', privacy.shareInsights === true, (on) => {
          setMySettings({ shareInsights: on });
          renderSettings();
        }),
        ...(privacy.shareInsights === true ? [
          toggle('clock', 'إظهار مدة المتابعة', null, privacy.shareInsightTime !== false, (on) => {
            setMySettings({ shareInsightTime: on }); renderSettings();
          }),
          toggle('check', 'إظهار التقدم', 'الفصول والحلقات المكتملة', privacy.shareInsightProgress !== false, (on) => {
            setMySettings({ shareInsightProgress: on }); renderSettings();
          }),
        ] : []),
        toggle(
          'eye',
          'عرض ماذا أشاهد الآن',
          privacy.shareCurrent === false
            ? `يشوفون «يقرأ» أو «يشاهد» بدون العمل${privacy.showRecentViews === false ? '' : '، وآخر مشاهداتك توصلهم بعد ساعة'}`
            : 'العمل اللي تقرأه أو تشاهده الحين',
          privacy.shareCurrent !== false,
          (on) => {
            setMySettings({ shareCurrent: on });
            renderSettings();
          },
        ),
        toggle(
          'clock',
          'إظهار آخر المشاهدات في ملفي',
          privacy.showRecentViews === false
            ? 'سجلّك لك وحدك؛ يُسحب من أجهزة الأصدقاء بعد مزامنتها'
            : 'تظهر في ملفّك عند أصدقائك',
          privacy.showRecentViews !== false,
          async (on) => {
            try {
              if (!(await sync.privacyCapability()).recentViewsRevocable) throw new Error('privacy_not_ready');
              setMySettings({ showRecentViews: on });
              renderSettings();
            } catch {
              toast('حماية السجل تنتظر تحديث الخادم؛ حاول بعد قليل');
              renderSettings();
            }
          },
        ),
        toggle(
          'check',
          'إظهار إنهاء الفصول والحلقات',
          privacy.shareCompletions === false ? 'ما يوصلهم «خلّص الفصل»، وتقدّمك محفوظ لك' : '«خلّص الفصل 72» و«أنهى الحلقة 8»',
          privacy.shareCompletions !== false,
          (on) => {
            setMySettings({ shareCompletions: on });
            renderSettings();
          },
        ),
      ],
      { note: privacy.showRecentViews === false
        ? 'آخر المشاهدات مخفية عن الأصدقاء؛ العمل الحالي ونشاط الإنهاء لهما خياران مستقلان.'
        : 'لو أخفيت العمل، عندك ساعة تحذفه من «آخر المشاهدات» قبل ما يوصلهم.' },
    );
    if (on('privacy')) group('ما تراه أنت', [
      row('activity', 'نشاط أصدقائك في القراءة', 'في «آخر ما صار». يخصّك وحدك', {
        value: privacy.feedReading === 'hide' ? 'إخفاء لدي' : 'إظهار لدي',
        run: () => {
          setMySettings({ feedReading: privacy.feedReading === 'hide' ? 'show' : 'hide' });
          renderSettings();
        },
      }),
    ]);

    if (sync.pendingDevices && !pendingAsked) {
      pendingAsked = true;
      sync.pendingDevices().then((n) => {
        if (n !== pendingPhones) {
          pendingPhones = n;
          if (onSettings()) renderSettings();
        }
      });
    }

    if (api) {
      const popups = api.popups();
      const kindsOn = Object.keys(api.labels).filter((k) => popups.kinds[k] !== false).length;
      if (on('privacy')) group(
        'التنبيهات',
        [
          toggle('bell', 'التنبيهات المنبثقة', 'لما يوصلك فريم أو ترشيح', popups.enabled, (enabled) => {
            api.setPopups({ ...api.popups(), enabled });
            renderSettings();
          }),
          popups.enabled
            ? row('sliders', 'وش يطلع لك', null, { value: kindsOn === Object.keys(api.labels).length ? 'الكل' : `${kindsOn} من ${Object.keys(api.labels).length}`, run: openPopupKinds })
            : null,
        ],
        { note: 'الإطفاء يوقف التنبيه المنبثق بس. إشعاراتك تبقى في صفحتها.' },
      );
      // الـPWA بلا ترجمة مانجا (قرار المالك): لا إعداد يفعّلها، فلا زرّ في أي مكان
      if (on('playback') && supports('translation')) renderTranslationSettings(group, row, toggle);
      if (on('privacy')) group('المحتوى', [row('trash', 'أرشيف الأعمال المحذوفة', 'ما حذفته بنفسك — أعده متى شئت', { value: hiddenWorks().length ? String(hiddenWorks().length) : null, run: openHiddenArchive })]);
      if (!pane) group('المساعدة', [row('flag', 'بلّغ عن مشكلة', 'قل لنا وش صار', { run: () => openProblemSheet() })]);
    }

    if (on('playback') && !(api && supports('translation'))) {
      body.append(el('p', 'settings-empty', 'لا خيارات للتشغيل أو الترجمة على هذه المنصة بعد. جودة التشغيل والسيرفر تُختار من المشغّل نفسه.'));
    }
    if (on('advanced') && diagnosticsUi.available()) group('أدوات Debug', [
      toggle('activity', 'إظهار التشخيصات', 'أدوات الفحص على هذا الجهاز فقط', diagnosticsUi.visible(), async visible => {
        await diagnosticsUi.setVisible(visible);
        renderSettings();
      }),
    ]);

    // ويندوز: قناة Debug/Stable مستقلة؛ الفحص والتنزيل يدويان بالكامل (desktop/update-check.js)
    const desktopUpdates = globalThis.VantaraDesktopUpdates?.installed ? globalThis.VantaraDesktopUpdates : null;
    if (!pane) group('عن التطبيق', [
      // محرك السينما غير محرك المانجا: صفّه يظهر متى وُجد هو، خارج «النظام» المطويّ
      diagnosticsUi.visible() && globalThis.Capacitor?.Plugins?.AnimeEngine
        ? row('activity', 'أداء مصادر السينما', 'أول تشغيل صالح لكل مصدر وسيرفر', { run: () => cinema.openSourcesDebug() })
        : null,
      // بعد تحديث واجهة يسبق رقمُها رقمَ الـAPK؛ كلاهما يظهر لمن يسأل
      row('info', 'الإصدار', currentPlatform() === 'pwa' ? 'نسخة PWA المثبتة على هذا الجهاز' : apkVersion && apkVersion !== deps.version ? `أندرويد ${apkVersion}` : null, { value: deps.version || RELEASE.version }),
      row('spark', 'ما الجديد', `${RELEASE.product} ${globalThis.VantaraDesktop?.version ?? RELEASE.version}`, { run: openWhatsNew }),
      api?.checkUpdate
        ? row('refresh', desktopUpdates ? 'البحث عن تحديثات' : 'تحديث التطبيق', desktopUpdates ? desktopUpdates.installed() : 'يبحث عن نسخة أحدث', {
            run: async () => {
              toast('نبحث عن تحديث…');
              try {
                const found = await api.checkUpdate();
                if (!found) toast(desktopUpdates ? `عندك آخر نسخة · ${desktopUpdates.installed()}` : 'عندك آخر نسخة');
              } catch {
                toast('تعذّر التحقق من التحديث — أعد المحاولة');
              }
            },
          })
        : null,
    ]);


    if (!api || !pane) return;
    const health = api.health();
    const bad = health.state !== 'ok' && health.state !== 'syncing';
    // This code contains no account details. Make a failed recovery actionable:
    // the previous screen only said "recovery incomplete" for every cause.
    const recoveryCode = health.lastError?.code
      || (health.lastError?.status ? `HTTP ${health.lastError.status}` : 'غير محدد');
    if (on('sync')) group('', [
      row('refresh', 'حالة المزامنة', health.lastSyncAt ? `آخر مرة ${api.ago(health.lastSyncAt)}` : null, { value: health.message, tone: bad ? 'warn' : 'ok' }),
      ...(bad && diagnosticsUi.visible() ? [row('refresh', 'رمز تشخيص المزامنة', 'لا يحتوي معلومات حسابك السرية', { value: recoveryCode, tone: 'warn' })] : []),
      row('send', 'زامن الآن', 'آمن: يرسل ويجيب آخر التغييرات', {
        run: async () => {
          toast('جارٍ المزامنة…');
          await api.syncNow().catch(() => {});
          // Settled writes are not the same as a verified complete local mirror.
          const after = api.health();
          toast(after.state === 'ok' ? 'اكتملت المزامنة' : after.message);
          renderSettings();
        },
      }),
    ]);

    if (on('sync')) body.append(el('p', 'settings-note', 'مكتبتك وتقدّمك يُحفظان في حسابك ويصلان أجهزتك بالمزامنة.'));
    if (!on('advanced')) return;
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

    if (diagnosticsUi.visible() && available()) {
      group('', [row('layers', 'فحص المصادر', 'يجرّب كل مصدر: القائمة، البحث، الفصول، الصفحات، الصور، والأغلفة', { run: openSourceCheck })]);
    }
    // «المصادر» كانت تبويبًا في مكتبة الأنمي وليست مجموعة أعمال: مكانها هنا
    if (anime.sourcesAvailable?.()) group('', [row('activity', 'صحة مصادر الأنمي', 'نجاح كل مصدر وآخر نجاح أو فشل', { run: () => anime.openSourcesHealth() })]);

    // Not a general account setting: hide ALL dangerous actions for friends.
    if (canManageDangerZone(sync)) {
      group(
        'منطقة الخطر',
        [
          row('server', 'عنوان الخادم', 'غلط فيه يفصل التطبيق عن حساباتكم', { value: hostOf(api.endpoints().sync), danger: true, run: () => confirmDanger('serverUrl') }),
          row('layers', 'أعد بناء البيانات المحلية', 'يمسح ما على الجهاز ويجيبه من الخادم من جديد', { danger: true, run: () => confirmDanger('rebuild') }),
          health.quarantined
            ? row('alert', 'عمليات رفضها الخادم', null, { value: String(health.quarantined), danger: true, run: () => confirmDanger('retry') })
            : null,
        ],
        { cls: 'danger-zone', note: 'متاحة لحساب المالك فقط. كل إجراء يسألك قبل ما يسوي شي.' },
      );
    }
  }

  /** فحص المصادر الستة عشر على هذا الجهاز وشبكته، خطوةً خطوة. */
  function openSourceCheck() {
    if (!diagnosticsUi.visible()) return;
    const rows = new Map();
    const report = [];
    openSheet((body) => {
      body.dataset.diagnosticSheet = '';
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
    // Recheck even for stale buttons/sheets after switching accounts.
    if (!canManageDangerZone(sync)) return;
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
    if (!copy) return;
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
        if (!canManageDangerZone(sync)) return;
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
    if (!canManageDangerZone(sync)) return;
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
        if (!canManageDangerZone(sync)) return;
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
        if (!canManageDangerZone(sync)) return;
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
    paintRail();
  }

  // ───────────────────────── الأفعال المفوَّضة ─────────────────────────

  // ───────────────────────── مبدّل الأقسام ─────────────────────────
  // المبدّل في قلب الشريط العائم، والانتقال طبقات (dock.js). يُنشآن عند أول استعمال
  // لأن رئيسيات الأقسام تُبنى بعد القشرة.
  //
  // السلاسة أولًا: الحركة تُسلَّم للمركّب قبل أي عمل ثقيل، والأقسام تُجهَّز (تُبنى وتُخطَّط
  // وهي مخفية) لحظة فتح المبدّل أو لمسه، وتحديث محتوى القسم يجري بعد انتهاء الحركة.
  let dockCtl = null;
  let layers = null;
  const sectionViews = () => ({ manga: q('mangaHome'), anime: q('animeHome'), cinema: q('cinemaHome') });
  const sectionLayers = () =>
    (layers ??= createLayers({
      views: sectionViews(),
      host: q('home'),
      current: root.dataset.section ?? 'manga',
      label: createCrossfade(q('brandSection')),
      wordOf: (id) => SECTIONS[id]?.word ?? id.toUpperCase(),
      onSettle: (shown, from) => {
        // سحب أُلغي: الهوية ترجع للقسم الظاهر
        if (root.dataset.section !== shown) applySection(shown);
        // لا إعادة رسم بعد التبديل: القسم جاهز بمحتواه، وتحديث بياناته يصل من مساراته (المزامنة)
      },
    }));
  // بعد أن يُسلَّم الإطار الأول للمركّب: هنا يجري العمل الثقيل دون أن يؤخر بدء الحركة
  const afterFirstFrame = (fn) => requestAnimationFrame(() => setTimeout(fn, 0));
  const idle = (fn) => (globalThis.requestIdleCallback ? requestIdleCallback(fn, { timeout: 400 }) : setTimeout(fn, 60));
  /** ارسم رئيسية القسم بمحتواها (تحديث «آخر المشاهدات» وما شابه). */
  function renderSection(id) {
    warmed.add(id);
    if (id === 'anime') anime.show();
    else if (id === 'cinema') cinema.show();
    else {
      for (const snapshot of homeSnapshots.values()) snapshot.refresh();
      refreshFriendsHero();
      renderHome();
      restartHero();
    }
  }
  /** أقسام رُسمت مرة: لا تحتاج رسمًا قبل الانتقال إليها، فمحتواها باقٍ في مكانه. */
  const warmed = new Set();
  /** جهّز الأقسام الأخرى: رسم أول مرة لما لم يُرسم، ثم تخطيطها مخفية. */
  function prepareSections() {
    if (currentPage() !== 'home' || root.dataset.content === 'unified') return;
    sectionLayers().prepare();
    for (const id of ['manga', 'anime', 'cinema']) if (!warmed.has(id) && id !== root.dataset.section) renderSection(id);
  }
  /** ادخل قسمًا: الحركة أولًا، ثم الهوية بعد الإطار الأول، والمحتوى إن لم يُرسم قط. */
  function beginSection(id, run) {
    const motion = sectionLayers(); // قبل تغيير القسم: الطبقات تبدأ مما كان ظاهرًا
    const fresh = !warmed.has(id);
    if (fresh) renderSection(id); // أول زيارة: المحتوى يجب أن يدخل مع طبقته
    run(motion);
    // الهوية بعد الإطار الأول، وفقط إن بقيت الحركة متجهة لهذا القسم (سحب أُلغي قبلها لا يلبّسه هويته)
    afterFirstFrame(() => {
      if (root.dataset.section !== id && (motion.moving ? motion.target === id : motion.section === id)) {
        applySection(id, { keepLabel: true });
      }
    });
  }
  /** خارج الرئيسية: لا حركة طبقات، القسم والصفحة مباشرة. */
  function enterSection(id) {
    applySection(id);
    renderSection(id);
  }
  // لوحة المفاتيح تقصّر نافذة WebView فيصعد كل ما هو مثبت بالأسفل. الشريط يبقى في مكانه من الشاشة
  // الكاملة: يُزاح للأسفل بقدر ما قصُرت (فتغطيه اللوحة). الارتفاع الكامل يُحفظ لكل عرض (الدوران يغيّره).
  {
    let full = { w: 0, h: 0 };
    const pin = () => {
      const w = globalThis.innerWidth || 0;
      const h = globalThis.innerHeight || 0;
      if (w !== full.w || h > full.h) full = { w, h };
      // لمس + حقل كتابة مركّز = لوحة مفاتيح؛ تصغير نافذة على الكمبيوتر لا يُخفي الشريط
      const el = document.activeElement;
      const typing = globalThis.matchMedia?.('(pointer: coarse)').matches && el?.matches?.('input, textarea, [contenteditable="true"]');
      const shift = typing && full.h - h > 80 ? full.h - h : 0;
      q('bottomNav')?.style.setProperty('--kb-shift', `${shift}px`);
    };
    globalThis.addEventListener?.('resize', pin, { passive: true });
    root.addEventListener('focusin', pin);
    root.addEventListener('focusout', () => setTimeout(pin, 0));
    pin();
  }
  let standbyTimer = 0;
  const sleepSoon = (ms) => {
    clearTimeout(standbyTimer);
    standbyTimer = setTimeout(() => { if (!dockCtl?.isOpen() && !layers?.moving) layers?.unprepare(); }, ms);
  };
  const dock = () =>
    (dockCtl ??= createDock({
      bar: q('bottomNav'),
      scrim: q('dockScrim'),
      current: root.dataset.section ?? 'manga',
      onPrepare: () => {
        clearTimeout(standbyTimer);
        prepareSections();
      },
      // أُغلق بلا اختيار: الأقسام المجهّزة ترجع لنومها بعد هدوء الحركة
      onClose: () => sleepSoon(600),
      onNavigate: (page) => navTo(page),
      onDragStart: (to) => {
        if (currentPage() !== 'home' || !SECTIONS[to]?.ready) return;
        beginSection(to, (motion) => motion.drag(to, 0));
      },
      onDrag: (to, p) => {
        if (currentPage() === 'home' && layers?.moving) layers.drag(to, p);
      },
      onDragEnd: (to, commit) => {
        // لمسة بلا سحب: تفتح المبدّل غالبًا؛ وإلا تنام الأقسام بعد قليل
        if (!to) return sleepSoon(1500);
        if (currentPage() !== 'home') {
          if (commit) selectSection(to);
          return;
        }
        if (!layers?.moving) return;
        if (commit) writeSection(to);
        layers.release(commit);
      },
    }));
  function setSectionsOpen(open) {
    if (open) dock().open();
    else dock().close();
  }
  const sectionsOpen = () => dockCtl?.isOpen() ?? false;

  /** يلبس التطبيق هوية القسم: المتغيّرات، اسم القسم تحت الشعار، ولون شريط النظام. */
  function applySection(id, { keepLabel = false } = {}) {
    const s = SECTIONS[id] ?? SECTIONS.manga;
    root.dataset.section = s.id;
    dockCtl?.setSection(s.id);
    // تغيير من خارج المبدّل (فتح عمل من إضافة) يُعلم الطبقات؛ دخول القسم بالمبدّل يحرّكها هي
    if (!keepLabel) layers?.sync(s.id);
    // نوافذ خارج جذر التطبيق (التنبيهات، الأوراق المعلّقة على body) ترث لون القسم من <html>
    document.documentElement.dataset.section = s.id;
    // أثناء الانتقال يتبدّل الاسم مع الحركة (createCrossfade)، لا قبلها
    if (!keepLabel || !layers?.moving) q('brandSectionName').textContent = root.dataset.content === 'unified' ? 'ALL' : s.word;
    // لون القسم المختار (أو المصمّم) وصبغة خلفيته على الجذر و<html> معًا
    const black = applyAppearance(root.dataset.content === 'unified' ? 'unified' : s.id, [root, document.documentElement]);
    // وكل صفحة قسم بلونها هي (المصمّم أو ما اختاره المستخدم لها)، لا بلون القسم الحالي
    for (const [section, home] of Object.entries(HOMES)) { const view = q(home); if (view) applyAppearance(section, [view]); }
    // الأوراق والنوافذ بنغمة قسم (data-tone) تلبس اللون المختار أيضًا، لا الأزرق أو الأحمر المصمّم
    let toneTag = document.getElementById('look-tones');
    if (!toneTag) {
      toneTag = document.createElement('style');
      toneTag.id = 'look-tones';
      document.head.append(toneTag);
    }
    toneTag.textContent = toneCss(undefined, { unified: root.dataset.content === 'unified' });
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', black ?? s.theme);
    document.documentElement.style.background = black ?? 'var(--bg)';
    paintRail();
  }
  const pickSection = (_e, t) => selectSection(t.dataset.arg);
  /** اختر قسمًا: الصفحة الظاهرة هي الطبقة الحالية، والوجهة دائمًا رئيسية القسم. */
  function selectSection(id) {
    if (!SECTIONS[id]?.ready) {
      toast(`VANTARA ${SECTIONS[id]?.word ?? ''} قريبًا`);
      return;
    }
    if (!layers?.moving && root.dataset.section === id) return setSectionsOpen(false); // لمس الحالي يُغلق فقط
    writeSection(id);
    if (currentPage() !== 'home') {
      const leave = root.querySelector('.page.active');
      const y = window.scrollY;
      setSectionsOpen(false);
      layers?.finish();
      beginSection(id, motion => motion.go(id, { outgoing: leave, scrollY: y }));
      showHome(id);
      showPage('home', { sectionSwitch: true, sourceScroll: y });
      // Freeze the destination header/hero layout before the first rendered frame.
      // Applying the section identity one frame later moved the manga cover visibly.
      applySection(id, { keepLabel: true });
      haptic();
      return;
    }
    // الطبقات تبدأ أولًا، والشريط يُغلق معها لا قبلها
    beginSection(id, (motion) => motion.go(id));
    setSectionsOpen(false);
    haptic();
  }
  const HOMES = { manga: 'mangaHome', anime: 'animeHome', cinema: 'cinemaHome' };
  /** رئيسية القسم وحدها ظاهرة؛ وفي توحيد المحتوى الرئيسية المشتركة بدلها كلها. */
  function showHome(id) {
    const all = root.dataset.content === 'unified';
    for (const [section, home] of Object.entries(HOMES)) q(home).hidden = all || section !== id;
    const shared = q('allHome');
    if (shared) {
      shared.hidden = !all;
      // خارج الرئيسية (الإعدادات): البناء يؤجَّل لحين الرجوع إليها (showPage يرسمها)، فلا يثقل اللمسة
      if (all && currentPage() === 'home') renderAllHome({ ifChanged: true });
    }
  }

  // ───────────────────────── بنية التجربة (experience.js) ─────────────────────────
  // توحيد المحتوى (`data-content`) يُخفي المبدّل ويُظهر
  // الرئيسية المشتركة. لا شيء هنا يكتب في المكتبة أو التقدم: الرجوع يعيد كل قسم كما تُرك.
  let dockMotion = null;
  let experienceApplied = false;
  /**
   * دمج الكبسولات الثلاث في واحدة (أو فصلها): قياس واحد للحالتين ثم Web Animations على transform وopacity
   * وحدهما، فتبقى الحركة على المؤلِّف بـ120 إطارًا حتى والصفحة مشغولة. لا تحريك لـgap/width/radius.
   */
  function playDockMotion() {
    // خلل «يرتبط ثم يختفي ثم يرجع» (9 نوفمبر): الدمج كان يجعل الكبسولات الحقيقية شفافة وينتظر نسخًا خلفية
    // تُرسم بعد الخمول، فيبقى الشريط بلا سطح لحظات. الآن الشريط بشكله الجديد مرسوم من أول إطار، وحركة
    // واحدة عليه كله (opacity وscale فقط على المؤلِّف): لا لحظة بلا سطح، في الدمج والفصل.
    const nav = q('bottomNav');
    if (!dockMotion || !nav || nav.hidden) return;
    dockMotion = null;
    dockCtl?.activate(currentPage());
    if (document.documentElement.dataset.motion === 'off' || matchMedia?.('(prefers-reduced-motion: reduce)').matches || !nav.animate) return;
    const a = nav.animate([{ opacity: 0.35, scale: '0.94' }, { opacity: 1, scale: '1' }], { duration: 320, easing: 'cubic-bezier(.22,.8,.2,1)' });
    // بعد الحركة: الدائرة تُوضع من جديد على مركز وجهتها بلا حركة (الشريط تغيّر عرضه)
    a?.finished?.then(() => dockCtl?.repaint?.(true)).catch(() => {});
  }
  function applyExperience() {
    const view = experienceView(readStructure());
    delete root.dataset.screens; // «توحيد الشاشات» محذوف (قرار المالك)
    const unified = view.home === 'all';
    const was = root.dataset.content === 'unified';
    if (unified) root.dataset.content = 'unified';
    else delete root.dataset.content;
    if (unified && !was) dockCtl?.close({ focus: false, instant: true });
    if (unified !== was) applyAppearance(unified ? 'unified' : (root.dataset.section ?? 'manga'), [root, document.documentElement]);
    // دمج الكبسولات أو فصلها: يُشغَّل أول ما يظهر الشريط (التبديل يتم من الإعدادات والشريط مخفي هناك)
    // لا عند فتح التطبيق: فقط حين يبدّل المستخدم
    if (unified !== was && experienceApplied) { dockMotion = unified ? 'dock-merge' : 'dock-split'; playDockMotion(); }
    experienceApplied = true;
    q('brandSectionName').textContent = unified ? 'ALL' : (SECTIONS[root.dataset.section] ?? SECTIONS.manga).word;
    // الخروج من الموحد: القسم المحفوظ يعود (فتح عمل من الموحد يغيّر data-section مؤقتًا فقط، #323 U-12)
    if (was && !unified && root.dataset.section !== readSection()) applySection(readSection());
    showHome(root.dataset.section ?? 'manga');
    // الخروج من الموحد: الإقلاع الموحد لا يرسم أي قسم (#323 U-06)، فالقسم الذي ظهر الآن يُرسم هنا وإلا
    // بقيت رئيسية الأنمي أو السينما فارغة (showPage لا يرسمهما عند الرجوع، وprepareSections يتخطى الحالي).
    if (was && !unified && !warmed.has(root.dataset.section ?? 'manga')) renderSection(root.dataset.section ?? 'manga');
    // الشريط تغيّر عرضه (المبدّل ظهر أو اختفى): مؤشر الوجهة يُعاد لموضعها بعد التخطيط
    requestAnimationFrame(() => dockCtl?.activate(currentPage()));
  }

  // الرئيسية المشتركة: كل العناصر تمر من unifiedFeed (منع التكرار عبر الأقسام)، والنوع يحدد صفحة التفاصيل
  let identityAsked = false;
  /**
   * الضغط المطوّل على عمل في «آخر المشاهدات»: افتحه، أضفه لمكتبتك (أو هو فيها)، أو أزله من السجل.
   * الإزالة تخفي صف المشاهدة وحده (view.remove): لا تمسّ المكتبة ولا التقدّم ولا تعليم الفصول.
   */
  function openRecentMenu(item) {
    const ref = String(item.ref ?? '');
    if (!ref) return;
    const inLib = sync.rows('library', (r) => r.user_id === me() && !r.removed && r.series_ref === ref).length > 0;
    const d = { seriesRef: ref, seriesTitle: item.title ?? null, coverUrl: item.cover ?? null, sourceId: null };
    openSheet((body) => {
      const h = el('h3', null, item.title || 'عمل');
      h.dir = 'auto';
      h.style.marginBottom = '8px';
      body.append(h,
        sheetItem(item.section === 'manga' ? 'book' : 'play', item.section === 'manga' ? 'تابع القراءة' : 'تابع المشاهدة', () => { closeSheet(); openUnified(item); }),
        inLib
          ? sheetItem('check', 'في مكتبتي', () => closeSheet(), { pressed: true })
          : sheetItem('plus', 'أضف إلى مكتبتي', () => { closeSheet(); sync.enqueue('library.add', d); toast('أضيف إلى «أتابعها»'); }),
        sheetItem('close', 'أزل من آخر المشاهدات', () => {
          closeSheet();
          sync.enqueue('view.remove', { seriesRef: ref });
          toast('أُزيل من آخر المشاهدات');
          renderAllHome({ ifChanged: true });
        }),
      );
    });
  }
  function openUnified(item) {
    suspendUnifiedOrigin();
    if (item.section === 'anime') return openAnimeRef(item.ref, { title: item.title, cover: item.cover });
    if (item.section === 'cinema') return openCinemaRef(item.ref, { title: item.title, cover: item.cover });
    if (root.dataset.section !== 'manga') {
      writeSection('manga');
      applySection('manga');
    }
    void openWork(workFromRef(item.ref, item.title, item.cover));
  }
  function browseSection(id) {
    writeSection(id);
    applySection(id);
    navTo('discover');
  }
  // الرئيسية الموحدة المعتمدة (unified-view.js): القشرة تملك البيانات والتنقل، والعرض هناك
  const unifiedData = { anime: null, cinema: null, series: [], movieUpdates: [], animeUpdates: [], logos: new Map(), asked: false };
  /** شعارات أنمي البنر من مصدر صفحة العمل نفسه (ani.zip ← metahub)، لأول سبعة رائجة فقط. */
  async function loadHeroLogos(trending) {
    const { loadAnimeArt } = await import('../lib/anime-art.js');
    await Promise.all((trending ?? []).slice(0, 7).map((x) => loadAnimeArt(x.id).then((art) => { if (art?.logo) unifiedData.logos.set(x.id, art.logo); }).catch(() => {})));
  }
  const mangaView = (w) => w && !isAdult(w) ? {
    title: titleOf(w), cover: w.coverImage?.extraLarge || w.coverImage?.large || w._work?.thumbnailUrl || null,
    color: w.coverImage?.color ?? null, genres: w.genres ?? [], score: w.averageScore ? w.averageScore / 10 : null,
    chapters: w.chapters ?? null, _latestChapter: w._latestChapter ?? null, _updateAt: w._updateAt ?? null,
    _updatePublishedAt: w._updatePublishedAt ?? 0, _newCount: w._newCount ?? 1, raw: w,
  } : null;
  const openManga = (w) => {
    suspendUnifiedOrigin();
    if (root.dataset.section !== 'manga') { writeSection('manga'); applySection('manga'); }
    void openWork(w.raw ?? w);
  };
  let artMod = null;
  void import('../lib/anime-art.js').then((m) => { artMod = m; }).catch(() => {});
  const unifiedView = createUnifiedView({
    el, glyph, genreAr: (g) => AR_GENRE[g] ?? g,
    reducedMotion: () => document.documentElement.dataset.motion === 'off' || matchMedia?.('(prefers-reduced-motion: reduce)').matches,
    data: {
      continue: () => unifiedFeed(collectItems((t, pick) => sync.rows(t, pick), { userId: me(), cinemaTypes: readJson('vantara.cinema.types.v2', {}) })),
      animeHome: () => unifiedData.anime,
      cinema: () => unifiedData.cinema,
      seriesUpdates: () => unifiedData.series,
      movieUpdates: () => unifiedData.movieUpdates,
      animeUpdates: () => unifiedData.animeUpdates,
      mangaUpdates: () => (state.home.updates ?? []).map(mangaView).filter(Boolean),
      // ألسنة الأقسام في «آخر التحديثات» الموحد: الخط الزمني نفسه بتحميل الأقدم (#323 O-2)
      timeline: (host, tab) => {
        const [section, include] = tab === 'series' ? ['cinema', (g) => g.kind !== 'movie'] : tab === 'movie' ? ['cinema', (g) => g.kind === 'movie'] : [tab, undefined];
        mountTimeline(host, timelineOptions(section, () => host.isConnected, include));
      },
      animeLogo: (id) => unifiedData.logos.get(id) ?? null,
      // أغلفة المانجا بمحمّل الصور نفسه في قسم المانجا (ترويسات المصدر، البدائل، الغلاف الموحّد)
      cover: (node, x) => {
        const w = x?.raw ?? (x?.ref ? workFromRef(String(x.ref), x.title, x.cover) : x?.coverImage ? x : null);
        if (!w) return false;
        void mountImage(node, w);
        return true;
      },
      // جدول البث: لقطة الحلقة لما لا بنر له (نفس سلسلة صور صفحة العمل)، والكتابة كسولة
      animeArt: (id) => import('../lib/anime-art.js').then(({ loadAnimeArt }) => loadAnimeArt(id)),
      episodeStill: (...a) => artMod?.episodeStill(...a) ?? null,
      mangaRecent: () => (state.home.recent ?? []).map(mangaView).filter(Boolean),
      mangaPopular: () => uniqueById([...(state.home.trending ?? []), ...(state.home.popular ?? [])]).map(mangaView).filter(Boolean),
    },
    open: {
      item: (it) => openUnified(it),
      manga: openManga,
      anime: (x) => { suspendUnifiedOrigin(); return openAnimeRef(`anime:${x.id}`, { title: x.title, cover: x.poster }); },
      cinema: (x) => { suspendUnifiedOrigin(); return openCinemaRef(`cinema:${x.id}`, { title: x.title, cover: x.poster, type: x.type ?? null }); },
      browse: (id) => browseSection(id),
      // «عرض الكل» لآخر المشاهدات: السجل كاملًا في المكتبة الموحدة
      recent: () => { unifiedLibrary.state.tab = 'recent'; navTo('library'); },
      itemMenu: (it) => openRecentMenu(it),
      // التصنيفات وكل الأعمال: صفحة الاكتشاف (للتوحيد اكتشاف قسمه الحالي إلى أن يُبنى الاكتشاف الموحد)
      categories: () => navTo('discover'),
      discover: () => unifiedDiscover.openAll(),
    },
  });
  function loadUnifiedData() {
    if (unifiedData.asked) return;
    unifiedData.asked = true;
    void fetchAnimeHome().then((d) => {
      unifiedData.anime = d;
      // صور جدول البث (خلفية IMDb/fanart) تُطلب مع وصول الجدول لا عند رسم البطاقة، فتكون جاهزة قبل ظهورها
      // الأقرب لـ«الآن» أولًا (اليوم ثم أمس وغدًا): كانت تُطلب بترتيب الأسبوع فتتأخر بطاقات اليوم خلف الأمس
      void import('../lib/anime-art.js').then(({ loadAnimeArt }) => {
        const t = Date.now();
        const near = [...(d?.week ?? [])].filter((e) => Math.abs(e.airingAt - t) < 36 * 3600_000).sort((a, b) => Math.abs(a.airingAt - t) - Math.abs(b.airingAt - t));
        const ids = [...new Set(near.map((e) => e.id))].slice(0, 12); // داخل سقف كاش الصور (art.js)
        // دفعات صغيرة: لا تزاحم طلبات الصفحة الأولى
        const next = () => { const batch = ids.splice(0, 4); if (batch.length) void Promise.all(batch.map((id) => loadAnimeArt(id).catch(() => null))).then(next); };
        next();
      });
      unifiedView.refresh();
      unifiedDiscover.refreshTrending(); // «اكتشف» الظاهر قبل وصول البيانات لا يبقى على «نجهّز الرائج…» (#323 U-05)
      return loadHeroLogos(d?.trending).then(() => unifiedView.refresh());
    }).catch(() => { unifiedData.asked = false; });
    void import('../lib/cinema-meta.js').then(({ catalog }) => Promise.all([catalog('movie', 'top'), catalog('series', 'top')]))
      .then(([movie, series]) => {
        unifiedData.cinema = { movie, series };
        unifiedView.refresh();
        unifiedDiscover.refreshTrending();
      }).catch(() => {});
  }
  /** تحديثات الأفلام المؤكدة من Update Engine نفسه؛ لا نستنتجها من ترتيب Cinemeta. */
  let movieUpdatesAskedAt = 0;
  async function refreshMovieUpdates() {
    if (Date.now() - movieUpdatesAskedAt < 120_000) return;
    movieUpdatesAskedAt = Date.now();
    // المصدر نفسه الذي يقرؤه قسما السينما والأنمي (#323 U-03/O-1): حلقات المسلسلات كانت تُستنتج من أول 16
    // مسلسلًا في كتالوج Cinemeta «top» (أشهرها عالميًا لا ما رصده Update Engine)، والأنمي غائب كليًا.
    const [groups, animeGroups] = await Promise.all([latestGroups('cinema', 60).catch(() => null), latestGroups('anime', 60).catch(() => null)]);
    const real = (g) => Number.isFinite(g.at) && g.at > 0;
    if (groups) { // Outage: preserve last verified events rather than showing false updates.
      unifiedData.movieUpdates = groups
        .filter((g) => g.kind === 'movie' && /^cinema:[^:]+$/.test(String(g.work ?? '')) && real(g))
        .slice(0, 30)
        .map((g) => ({
          x: { id: String(g.work).slice('cinema:'.length), title: g.title, poster: g.cover, type: 'movie' },
          at: g.at,
          publishedAt: g.publishedAt ?? null,
        }));
      unifiedData.series = groups
        .filter((g) => g.kind === 'episode' && /^cinema:/.test(String(g.work ?? '')) && real(g) && Number.isFinite(g.high))
        .slice(0, 30)
        .map((g) => ({ x: { id: String(g.work).slice('cinema:'.length), title: g.title, poster: g.cover, type: 'series' }, season: g.season ?? 1, episode: g.high, released: g.at }));
    }
    if (animeGroups) {
      unifiedData.animeUpdates = animeGroups
        .filter((g) => g.kind === 'episode' && /^anime:\d+$/.test(String(g.work ?? '')) && real(g))
        .slice(0, 30)
        .map((g) => ({ x: { id: Number(String(g.work).slice('anime:'.length)), title: g.title, poster: g.cover }, episode: g.high, more: g.events?.length ?? 1, at: g.at }));
    }
    if (currentPage() === 'home' && root.dataset.content === 'unified') unifiedView.refreshUpdates();
  }

  let unifiedMounted = false;
  function renderAllHome({ ifChanged = false } = {}) {
    const host = q('allHome');
    if (!host) return;
    if (!identityAsked) {
      identityAsked = true;
      void loadIdentity().then((found) => { if (found && root.dataset.content === 'unified') renderAllHome(); });
    }
    loadUnifiedData();
    void refreshHomeUpdates();
    void refreshMovieUpdates();
    if (!unifiedMounted || !host.firstChild) { unifiedView.mount(host); unifiedMounted = true; } else unifiedView.refresh({ ifChanged });
  }

  const insights = createInsights({ sync, host: q('insightsBody'), mountImage, openWork, previewWork: (w) => previewWork(w), workFromRef, toast });

  const actions = {
    toggleSections: () => dock().consumeDrag() || dock().toggle(),
    toggleRail,
    railLogo,
    pickSection,
    shareAnime: () => anime.shareCurrent(),
    backFromDetail: () => goBack(),
    goBack: () => goBack(),
    closeDrawer,
    drawerBackdropClick: (e) => {
      if (e.target === q('drawerBackdrop')) closeDrawer();
    },
    drawerNavigate: (_e, t) => drawerNavigate(t.dataset.arg),
    rafiqMemory: () => void rafiq.memory(),
    rafiqNew: () => void rafiq.fresh(),
    rafiqHistory: () => rafiq.history(),
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
    readTogetherCurrent: () => readTogetherCurrent(),
    markPreviousReading,
    toggleTranslateCurrent,
    readNow,
    flipChapterOrder,
    toggleSummary,
    toggleFavoriteCurrent,
    toggleLaterCurrent,
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
    if (e.target.contains(q('searchInput'))) rememberSearch(q('searchInput').value);
    // «بحث» في لوحة المفاتيح يخفيها: النتائج تحتها لا فوقها
    e.target.querySelector('input')?.blur();
  });
  root.addEventListener('change', (e) => {
    if (e.target.closest('[data-change="renderLibrary"]')) renderLibrary();
  });

  // ترويسة صفحة العمل تكتسي خلفية عند التمرير، وعنوان العمل يظهر فيها
  const onScroll = () => {
    // كما في نموذج المالك: الشريط يصير صلبًا مع الاسم بعد 220px
    if (currentPage() === 'detail') q('detailTop').classList.toggle('collapsed', window.scrollY > 220);
  };
  window.addEventListener('scroll', onScroll, { passive: true });

  const onKey = (e) => {
    // القارئ فوق القشرة يعالج رجوعه وحده: بلا هذا يرجع Esc خطوتين
    if (e.key === 'Escape' && !document.querySelector('.rd, .fv')) handleBack();
  };
  document.addEventListener('keydown', onKey);
  const unsubscribe = sync.onChange?.((tables) => {
    if (tables.includes('work_views') || tables.includes('progress')) {
      if (currentPage() === 'home' && tables.includes('work_views')) {
        if (!state.heroItems.length) refreshFriendsHero();
        renderHome();
      }
    }
    // المكتبة الظاهرة تتحدّث فورًا (كانت تبقى قديمة حتى تُفتح من جديد)، بإطار واحد مهما تتابعت الكتابات
    if (currentPage() === 'library' && tables.some((t) => ['library', 'collections', 'completions', 'work_views', 'ratings'].includes(t))) {
      if (!libraryRepaint) libraryRepaint = requestAnimationFrame(() => { libraryRepaint = 0; if (currentPage() === 'library') renderActiveLibrary(); });
    }
    if (tables.some((t) => ['library', 'collections', 'completions'].includes(t))) {
      refreshLibraryDetail();
      if (currentPage() === 'home') renderHome();
    }
    if (tables.includes('ratings')) {
      pendingRating = null;
      paintDetailMenu();
      const rate = root.querySelector('.mw-rate') ?? document.querySelector('.mw-rate');
      if (rate) renderRating(rate, rate._target ?? null);
    }
    if (tables.includes('chapter_marks') && currentPage() === 'detail' && state.current?._chapters) renderChapters(state.current);
    majlis.onChange(tables, { visible: currentPage() === 'majlis' && state.socialTab === 'recs' });
    room.onChange(tables);
    profile.onChange(tables);
    if (tables.includes('notifications')) {
      paintNotifyDots();
      if (notificationsVisible()) renderNotifications();
    }
    friends.onChange(tables);
  });

  /** زرّ الرجوع (أندرويد وEsc): الورقة ثم الدرج ثم الصفحة السابقة. */
  function handleBack() {
    if (editor?.open) return editor.handleBack();
    if (unifiedSearch.close()) return true;
    if (unifiedDiscover.back()) return true;
    if (unifiedView.back()) return true;
    if (sectionsOpen()) return setSectionsOpen(false) ?? true;
    // الورقة فوق المحادثة تُغلق أولًا، ثم المحادثة نفسها (لبابها في الأصدقاء)
    if (majlis.closeBar() || closeSheet() || closeDrawer() || room.close()) return true;
    // صفحة العمل: قائمة «المزيد» ثم وضع «علّم فصول» يُغلقان قبل الرجوع
    if (currentPage() === 'detail' && q('detailMenu')?.classList.contains('open')) return closeDetailMenu() ?? true;
    if (currentPage() === 'detail' && state.marking) return exitMarkMode() ?? true;
    return goBack();
  }

  // VANTARA Together: ادعُ بالأفاتارات، والبطاقة في المجلس، والجلسة يربطها المشغّل والقارئ
  const together = createTogether({
    sync,
    baseUrl: () => endpoints().sync,
    friends: () => deps.friends?.() ?? [],
    avatarNode,
    openSheet,
    closeSheet,
    toast,
    openMedia: (media) => openTogetherMedia(media),
  });
  function openTogetherMedia(media) {
    if (!media) return;
    if (media.kind === 'manga') {
      void openWork(workFromRef(media.seriesRef, media.title, media.cover), { readNumber: Number.isFinite(media.chapter) ? media.chapter : null });
    } else if (media.kind === 'anime') {
      // الحلقة التي في الغرفة الآن (قد يكون المضيف انتقل للتالية بعد الدعوة)
      const live = Number(/#(\d+)$/.exec(together.session?.room.timeline?.media?.key ?? '')?.[1]);
      const episode = Number.isFinite(live) ? live : media.episode;
      openAnimeRef(media.seriesRef, { title: media.title, cover: media.cover, chapter: { number: episode, label: `الحلقة ${episode}` }, play: true });
    } else if (media.kind === 'cinema') {
      const live = Number(/#(\d+)$/.exec(together.session?.room.timeline?.media?.key ?? '')?.[1]);
      const season = Number(String(media.seriesRef).split(':')[2]) || media.season || null;
      openCinemaRef(media.seriesRef, { title: media.title, cover: media.cover, playAt: { season, episode: Number.isFinite(live) ? live : media.episode } });
    }
  }

  const friendsHost = q('friendsBody');
  friendsHost.classList.add('fr-host');
  const friends = createFriends({
    sync,
    host: friendsHost,
    section: () => root.dataset.section ?? 'manga',
    presence: () => deps.presence?.() ?? Promise.resolve([]),
    avatarNode,
    mountImage,
    workFromRef,
    preview: (w, opts) => previewWork(w, opts),
    openFrame: (id) => void deps.go({ name: 'frame', id }),
    openProfile: (userId) => openProfile(userId),
    openRoom: (focus) => room.open(focus),
    markSeen: (kind, id) => majlis.markSeen(kind, id),
    openSheet,
    closeSheet,
    toast,
    mediaUrl,
    visible: () => currentPage() === 'majlis' && state.socialTab === 'friends' && !room.isOpen(),
  });
  const room = createRoom({
    sync,
    together,
    mount: root,
    avatarNode,
    mountImage,
    workFromRef,
    preview: (w, opts) => previewWork(w, opts),
    openFrame: (id) => void deps.go({ name: 'frame', id }),
    openProfile: (userId) => openProfile(userId),
    openSheet,
    closeSheet,
    toast,
    presence: () => deps.presence?.() ?? Promise.resolve([]),
    mediaUrl,
    pageImage: available() ? deps.pageImage : null,
    markSeen: (kind, id) => majlis.markSeen(kind, id),
    library: roomLibrary,
    encodeAvatar,
    onClose: () => {
      if (currentPage() === 'majlis' && state.socialTab === 'friends') friends.render();
    },
  });
  /** رابط ملف في خادم الوسائط (صورة المجلس، الرسائل الصوتية). */
  function mediaUrl(hash) {
    return `${endpoints().sync}/v1/media/${hash}`;
  }
  /** ما يُرشَّح من المحادثة: مكتبتك في المانجا والأنمي، بمراجعها الحقيقية. */
  function roomLibrary() {
    const seen = new Set();
    const out = [];
    const add = (w) => {
      if (!w.ref || seen.has(w.ref)) return;
      seen.add(w.ref);
      out.push(w);
    };
    for (const w of libraryWorks('all')) add({ ref: String(w.id), title: titleOf(w), cover: w.coverImage?.large ?? null, anime: false });
    for (const kind of ['library', 'read_later', 'favorite', 'completed']) {
      for (const m of animeAccount.shelf(kind)) add({ ref: `anime:${m.id}`, title: m.title, cover: m.poster, anime: true });
    }
    // السينما: «قائمتي» و«المفضلة» من الحساب بمرجع `cinema:`
    for (const r of [...sync.rows('library', (x) => x.user_id === me() && !x.removed), ...sync.rows('collections', (x) => x.user_id === me() && x.member)]) {
      if (String(r.series_ref).startsWith('cinema:')) add({ ref: r.series_ref, title: r.series_title ?? sync.rows('works', (w) => w.series_ref === r.series_ref)[0]?.title ?? 'عمل', cover: r.cover_url ?? null, anime: true, section: 'cinema' });
    }
    return out;
  }
  /** صورة المجلس: GIF يبقى متحركًا، والثابتة تُقص وتُضغط. */
  async function encodeAvatar(file) {
    return prepareRoomAvatar(file);
  }
  const majlis = createMajlis({
    sync,
    host: q('majlisBody'),
    // مجلسان منفصلان: الأنمي في قسمه والمانجا في قسمها
    section: () => root.dataset.section ?? 'manga',
    presence: () => deps.presence?.() ?? Promise.resolve([]),
    avatarNode,
    mountImage,
    workFromRef,
    openWork: (w) => void openWork(w),
    preview: (w, opts) => previewWork(w, opts),
    openAnime: (ref, opts) => openAnimeRef(ref, opts),
    openFrame: (id) => void deps.go({ name: 'frame', id }),
    openProfile: (userId) => openProfile(userId),
    openShare: () => navTo('discover'),
    pageImage: available() ? deps.pageImage : null,
    openSheet,
    closeSheet,
  });
  // الترجمة لمن فُتحت له وحده (قيد التطوير للبقية): الخادم يقول، والجهاز يخفي كل أزرارها
  const checkTranslationAccess = () =>
    sync
      .translation('/v1/translate/usage')
      .then((res) => {
        if (res.status === 200 && typeof res.body?.allowed === 'boolean') setTranslationLocked(!res.body.allowed);
        else if (res.status === 403 && res.body?.error === 'translation_locked') setTranslationLocked(true);
        else return;
        if (onSettings()) renderSettings();
      })
      .catch(() => {});
  setTimeout(checkTranslationAccess, 1500);
  // ما وصل هذا الجهاز قبل فتح الشاشة: المرسل يرى «وصله» الآن لا عند أول مجلس
  setTimeout(() => {
    majlis.acknowledgeDelivered();
  }, 0);
  // التسخين مؤجل إلى سكون الرئيسية، ولا يزاحم البحث.
  setTimeout(() => {
    const idle = () => !document.hidden && currentPage() === 'home' && root.dataset.section === 'manga';
    if (!available() || !idle()) return;
    const seen = new Set();
    const works = [...libraryWorks('all'), ...historyWorks().slice(0, 12)].filter((w) => !seen.has(w.id) && seen.add(w.id));
    void prewarm(works, { onDone: (full) => rememberWork(full), shouldContinue: idle });
  }, 30_000);
  // مجسّ Latest: صفحات «آخر التحديثات» لكل مصدر وفصول ما صعد فيها منذ المسح السابق.
  // ما يُرى يذهب لـUpdate Engine (عبر محرك الإضافات)، والخادم يقرّر ما الجديد.
  // كان لا يعمل إلا في سكون رئيسية المانجا ويتوقف بمجرد مغادرتها (حتى بفتح «آخر
  // التحديثات» نفسها) ومرة كل 20 دقيقة، فلا يكتمل. المسح الآن تفاضلي رخيص: يعمل
  // ما دام التطبيق ظاهرًا خارج القارئ، كل 10 دقائق، وعند فتح «آخر التحديثات».
  const sweepable = () => !document.hidden && root.isConnected;
  let sweptAt = 0;
  let sweeping = null;
  function sweepLatest({ minGap = 10 * 60_000 } = {}) {
    if (sweeping || !available() || Date.now() - sweptAt < minGap || !sweepable()) return sweeping;
    sweptAt = Date.now();
    sweeping = scanLatestChapterUpdates({ shouldContinue: sweepable }).catch(() => {}).finally(() => {
      sweeping = null;
      updatesAskedAt = 0;
      setTimeout(() => void refreshHomeUpdates(), 6000);
    });
    return sweeping;
  }
  setTimeout(() => void sweepLatest(), 15_000);
  setInterval(() => void sweepLatest(), 2 * 60_000);

  const profile = createProfile({
    sync,
    host: q('profileBody'),
    // بطاقة الأرقام تتبع القسم: المانجا فصول، والأنمي حلقات
    section: () => root.dataset.section,
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
    chooseTop: (position) => chooseProfileTop(position),
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
      previewWorks: libraryWorks('all').slice(0, 2).map((w) => ({ title: titleOf(w), cover: w.coverImage?.large || null })),
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

  async function restoreAddonWork(ref, fallback) {
    const addons = await getAddonRuntime();
    await addons.ready;
    return restoreSourceWork(ref, { addons, title: fallback.title, cover: fallback.poster ?? fallback.cover });
  }
  const animeAccount = createAnimeAccount(sync);
  const anime = createAnime({
    root, q, el, toast, openSheet, closeSheet, showPage, workReady, workShown, settleIn, motionActive, afterMotion, unifiedLook: () => unifiedLookOn(), goBack: () => goBack(), currentPage, genreAr, readKv, writeKv,
    playableSources, addSource,
    // بنر «اليوم» يُجهَّز في وقت الخمول بعد فتح التطبيق، فيكون جاهزًا من أول دخول لقسم الأنمي
    warmToday: true,
    openUpdates: (section) => openUpdates(section),
    sync,
    openWorkMenu: openMediaWorkMenu,
    openWorkOptions: (target) => openWorkOptions(target),
    mediaState,
    // «من نفس العالم»: مانجا العمل تُفتح في قسم المانجا ببحث عن اسمها في مصادر المستخدم
    openMangaTitle: (title) => {
      writeSection('manga');
      applySection('manga');
      buildDrawer();
      openSearch();
      searchFor(title);
    },
    restoreSourceWork: restoreAddonWork,
    openProfile,
    friends: () => deps.friends?.() ?? [],
    together: () => together,
    // الحضور: أصدقاؤك يرون «يشاهد: … الحلقة 12» في المجلس
    setWatching: (info) => deps.setWatching?.(info),
    playerPresence: () => deps.playerPresence?.(),
    // ترشيح الأنمي: نفس ورقة المانجا، بمرجع `anime:<id>` يفتحه المجلس في قسم الأنمي
    share: (work) =>
      openShareSheet({
        sync,
        friends: deps.friends?.() ?? [],
        openSheet: (build) => openSheet(build, { tone: 'anime' }),
        closeSheet,
        sheetBody: () => q('sheetBody'),
        toast,
        work,
      }),
  });
  // السينما: نفس هيكل الأنمي، ببياناتها ومصادرها
  const cinema = createCinema({
    root, q, el, toast, openSheet, closeSheet, showPage, workReady, workShown, settleIn, motionActive, afterMotion, unifiedLook: () => unifiedLookOn(), currentPage, readKv, writeKv, sync,
    playableSources, addSource,
    openWorkMenu: openMediaWorkMenu,
    openWorkOptions: (target) => openWorkOptions(target),
    mediaState,
    restoreSourceWork: restoreAddonWork,
    together: () => together,
    // ترشيح فيلم أو مسلسل: نفس ورقة المانجا والأنمي، بمرجع `cinema:` يفتحه المجلس في قسمه
    share: (work) =>
      openShareSheet({
        sync,
        friends: deps.friends?.() ?? [],
        openSheet: (build) => openSheet(build, { tone: 'cinema' }),
        closeSheet,
        sheetBody: () => q('sheetBody'),
        toast,
        work,
      }),
    openUpdates: (section) => openUpdates(section),
    setWatching: (info) => deps.setWatching?.(info),
    playerPresence: () => deps.playerPresence?.(),
  });
  // «رفيق»: مساعد التوصيات. البطاقة تفتح العمل الحقيقي: الأنمي بمعرّفه، والمانجا
  // بعنوانها في مصادرنا العربية (وإلا صفحة البحث بالعنوان)
  const rafiq = createRafiq({
    sync,
    host: q('rafiqBody'),
    el,
    toast,
    openSheet,
    closeSheet,
    genreAr,
    readWatch: () => readWatch(sync.user?.userId ?? null),
    section: () => (root.dataset.section === 'anime' ? 'anime' : 'manga'),
    openAnime: (card) => openAnimeRef(card.workId, { title: card.title, cover: card.cover }),
    openManga: async (card) => {
      const found = await resolveManga(card);
      if (found) {
        void openWork(found);
        return String(found.id);
      }
      toast('ما لقيته باسمه بالضبط في مصادرنا، هذي نتائج البحث 👀');
      showPage('search');
      searchFor(card.title);
      return null;
    },
    // مكتبتك وآخر ما فتحت: وين وصل العربي والإنجليزي، من المحفوظ بلا شبكة
    gaps: async () => {
      const seen = new Set();
      const works = [...libraryWorks('all'), ...historyWorks().slice(0, 40)].filter((w) => String(w.id).startsWith('ext:') && !seen.has(w.id) && seen.add(w.id)).slice(0, 80);
      const out = [];
      for (const w of works) {
        const span = await cachedSpan(w.id);
        if (span && (span.ar || span.en)) out.push({ ref: String(w.id), title: titleOf(w), ...span });
      }
      return out;
    },
    // عمل ما جُمعت فصوله: يُبحث عنه ويُجمع من كل المصادر، ثم نرجع وين وصل كل لسان
    checkChapters: async (card) => {
      const w = await resolveManga(card);
      if (!w) return null;
      const full = await loadWorkOnce(w, {});
      return { ref: String(full.id), ...chapterSpan(full._editions) };
    },
    translationOpen: () => !translationLocked(),
    // «أضف» من بطاقة رفيق: نفس عمليات المكتبة في صفحة العمل (لا نظام موازٍ)
    addManga: async (card, where) => {
      const w = await resolveManga(card);
      if (!w) return false;
      const d = descriptorOf(w);
      if (where === 'later') {
        sync.enqueue('readLater.set', { ...d, member: true });
        return 'في «أقرأ لاحقًا»';
      }
      if (!libraryEntry(d.seriesRef)?.row) sync.enqueue('library.add', d);
      afterLibraryChange();
      return 'أضيف لمكتبتك';
    },
    // الأنمي في حسابك (أتابعها / شاهد لاحقًا)، وقائمة الجهاز لمن لم يسجّل
    addAnime: (card, where = 'library') => {
      const id = Number(String(card.workId).slice('anime:'.length));
      if (!Number.isFinite(id)) return false;
      const m = { id, title: card.title, poster: card.cover, posterSmall: card.cover, banner: card.banner, color: card.color, score: card.score, status: card.status, episodes: card.count };
      if (!sync.user?.userId) return addToAnimeList(m);
      if (where === 'later') animeAccount.setCollection('read_later', m, true);
      else if (!animeAccount.inLibrary(id)) animeAccount.setLibrary(m, true);
      return true;
    },
    translateAhead: async (card, range) => {
      const w = await resolveManga(card);
      if (!w) return toast('ما لقيت العمل في مصادرنا 😭');
      const full = await loadWorkOnce(w, {});
      openTranslateAhead(full, range);
    },
  });
  /** عمل مانجا من بطاقة رفيق: مرجعك إن كان، وإلا بحث بعناوينه في مصادرنا. */
  async function resolveManga(card) {
    if (card.ref?.startsWith('ext:')) return workFromRef(card.ref, card.title, card.cover);
    if (root.dataset.section !== 'manga') {
      writeSection('manga');
      applySection('manga');
      showHome('manga');
    }
    const titles = [card.title, ...(card.titles ?? [])].filter(Boolean);
    for (const t of [...new Set(titles)].slice(0, 3)) {
      try {
        const { items } = await browse({ query: t, keepWestern: true });
        const found = items.find((w) => titles.some((x) => titlesMatch(titleOf(w), x)));
        if (found) return found;
      } catch {
        // المصدر ما ردّ: العنوان التالي
      }
    }
    return null;
  }
  // الـPWA بلا رفيق (قرار المالك): لا سؤال للخادم ولا أثر في القائمة
  if (supports('rafiq')) setTimeout(() => void rafiq.check(), 2500);

  const startSection = readSection();
  applySection(startSection);
  applyExperience();
  showHome(startSection);
  dock().activate(currentPage());
  warmed.add(startSection);
  // الأقسام الثلاثة جاهزة قبل أول تبديل: تُرسم مرة في وقت فراغ بعد الإقلاع، ثم التبديل حركة طبقة فقط
  setTimeout(() => idle(() => {
    // المحتوى الموحد يعرض واجهته هو والأقسام الثلاثة مخفية: لا تُرسم في الخلفية (#323 U-06؛ كان رسمها
    // يقع أثناء التنقل في الموحد فيهبط الرجوع إلى 13 إطارًا). تُرسم عند أول دخول للقسم (beginSection).
    if (root.dataset.content === 'unified') return;
    for (const id of ['manga', 'anime', 'cinema']) if (!warmed.has(id)) renderSection(id);
    // Built is not laid out: a hidden section gets its first style and layout at the moment of the first switch
    // (measured: one 270 ms task, 142 ms layout + 78 ms style, on cinema), the jank owners saw only on the first
    // switch on weak devices. In a later idle slot the sections stand by off-screen once so that cost is paid here.
    idle(() => {
      if (currentPage() !== 'home' || dockCtl?.isOpen() || layers?.moving || root.dataset.content === 'unified') return;
      const motion = sectionLayers();
      motion.prepare();
      void q('home')?.offsetHeight; // the off-screen layout itself
    });
  }), 2500);
  if (root.dataset.content !== 'unified') {
    if (startSection === 'anime') anime.show();
    if (startSection === 'cinema') cinema.show();
  } else warmed.delete(startSection); // يُرسم عند أول دخول له لا في الإقلاع الموحد

  paintNotifyDots();
  refreshFriendsHero();
  if (!state.heroItems.length) renderHeroFallback();
  renderHome();
  void refreshHomeUpdates();
  // ابدأ Latest عند دخول التطبيق مباشرة؛ loadHome وصفحته يتشاركان نفس الطلب.
  if (available()) void latestFirstPage();
  void loadHome();
  const refreshChapters = () => {
    if (!document.hidden && currentPage() === 'home' && root.dataset.section === 'manga' && Date.now() - homeCheckedAt >= 60_000) void loadHome();
  };
  const chapterRefreshTimer = setInterval(refreshChapters, 60_000);
  document.addEventListener('visibilitychange', refreshChapters);
  railReady = true;
  showPage(page);

  // الرجوع من القارئ أو الأصدقاء يعيد الصفحة كما تُركت، بتمريرها
  let savedScroll = 0;
  return {
    root,
    together,
    showPage,
    openWork,
    /** عمل من مرجعه وحده (إشعار، رابط): صفحته في الواجهة لا الشاشة القديمة. */
    openRef: (ref, title, cover) => void openWork(workFromRef(ref, title, cover)),
    // أنمي أو سينما من مرجعه (لقطات المعاينة في tools/ui-previews تفتح صفحة العمل بها)
    openAnimeRef,
    openCinemaRef,
    openMajlis,
    openProfile,
    handleBack,
    pause() {
      scrollRestore++; scrollRestoreCleanup?.();
      savedScroll = window.scrollY;
      majlis.hide();
      clearInterval(state.heroTimer);
      closeDrawer();
      closeSheet();
      closeDetailMenu();
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
      refreshChapters();
    },
    destroy() {
      scrollRestore++; scrollRestoreCleanup?.();
      unbindMangaDepth();
      ++pageMotionRequest;
      finishPageMotion();
      sourceVerification.close();
      addonViewGeneration++;closeAddonSource();
      followTimeClosed = true;
      try { stopFollowTime(); } catch {}
      majlis.hide();
      clearInterval(state.heroTimer);
      clearInterval(chapterRefreshTimer);
      sheetController.destroy();
      document.removeEventListener('visibilitychange', refreshChapters);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll);
      // مستمعات القسمين الدائمة (#311 D-011، D-013)
      cinema.destroy?.();
      anime.destroy?.();
      unsubscribe?.();
    },
  };
}

export { seriesRefOf };
