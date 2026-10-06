/**
 * Service worker — قشرة التطبيق فقط.
 *
 * قاعدة واحدة تحكم ما يُخزَّن: **لا شيء من `/v1/` يُكاش.**
 *
 * السبب ليس البساطة. استجابات `/v1/` مصادَق عليها وشخصية: المكتبة والتقدم
 * والحضور وصور الصفحات. تخزينها في الـcache يعني:
 *   - بقاءها على الجهاز بعد تسجيل الخروج، خارج الكوكي الذي أُبطل.
 *   - عرض مكتبة مستخدم لمستخدم آخر على جهاز مشترك.
 *   - تقدم قديم يُقرأ كأنه حالي، وهو أسوأ من عدم وجوده.
 *
 * والقراءة دون اتصال موجودة أصلًا في Uchiyomi (`/api/offline/plan` +
 * `/api/downloads`)، فلا داعي لبناء نسخة ثانية منها هنا بمخاطرها.
 *
 * ما يُكاش: القشرة الثابتة — HTML وJS وCSS والخط والأيقونات. وهذا ما يجعل
 * الإقلاع فوريًا ويجعل التطبيق يفتح على شاشة مفهومة بلا اتصال.
 */

/**
 * بصمة محتوى القشرة كلها، ومنها يُشتقّ اسم الكاش.
 *
 * كان هذا رقمًا يُرفع باليد، وكان التعليق يقول «أي تعديل على ملفات القشرة
 * يحتاج رقمًا جديدًا هنا». ونُسي مرة واحدة فكلّف إصدارًا كاملًا: القشرة
 * تُخدم من الكاش قبل الشبكة، والاسم نفسه يعني أن `activate` لا يحذف شيئًا،
 * فبقي APK جديد يعرض جافاسكربت النسخة السابقة — الكتالوج الموحّد داخل
 * الحزمة، والقارئ يرى قائمة المصادر القديمة كما هي. كودٌ صحيح لا يصل الشاشة.
 *
 * فالاسم الآن مشتقٌّ من المحتوى لا من عزيمة أحد. و`tools/repository-safety.test.mjs`
 * يحسب البصمة من بايتات ملفات `SHELL` ويفشل إن خالفت المكتوب هنا، فتعديلُ
 * ملف قشرةٍ بلا تحديثها يكسر البناء — وهو بالضبط وقت إبطال الكاش.
 */
const SHELL_DIGEST = '58adc616707d0ae2d98ef699d18d1e3936d4eceda94beb1e9ab93e763c1bbb65';

const VERSION = `vantara-shell-${SHELL_DIGEST.slice(0, 16)}`;

/**
 * هل نحن داخل الـAPK؟
 *
 * Capacitor يقدّم الصفحة من `https://localhost` عبر خادم محلي يقرأ ملفات
 * الحزمة من قرص الجهاز. فالأصول هناك **ليست على الشبكة**: قراءتها فورية، وهي
 * دائمًا التي شُحنت مع هذا الإصدار.
 *
 * وتخزينها في كاش الـservice worker لا يشتري سرعةً ولا عملًا دون اتصال —
 * الملفات في الحزمة على الحالين — ويشتري عطلًا واحدًا: حزمةٌ جديدة تُثبَّت فوق
 * قديمة، والكاش باقٍ في تخزين الـWebView لأنه لا يُمسح بتحديث التطبيق، فيبقى
 * يخدم جافاسكربت الإصدار السابق. كودٌ صحيح داخل الحزمة لا يصل الشاشة أبدًا،
 * ولا علاج إلا مسح بيانات التطبيق. حدث هذا فعلًا وكلّف إصدارًا كاملًا.
 *
 * فلا اعتراض هنا إطلاقًا، و`activate` يمسح كل كاشٍ يجده — ومنه ما خلّفته نسخة
 * أقدم من هذا الملف. وبهذا يصل تحديث الـAPK إلى الشاشة من أول إقلاع، وهو
 * الغرض من توقيع الإصدارات بمفتاح ثابت: تُثبَّت فوق سابقتها ولا تُحذف.
 *
 * والكاش يبقى على الويب كما كان: هناك الأصول على الشبكة فعلًا، والقشرة
 * المخزَّنة هي الفرق بين إقلاعٍ فوري وشاشةٍ بيضاء.
 */
const BUNDLED = self.location.hostname === 'localhost';

/**
 * كاشات الـPWA الدائمة: صور المصادر (أغلفة وصفحات) وإعداد الجالب. لا تُمسح مع
 * تغيّر القشرة، ولا تُنشأ داخل الـAPK أصلًا (`BUNDLED` يرجع قبلها).
 */
const IMAGE_CACHE = 'vantara-img-v1';
const PWA_CONFIG_CACHE = 'vantara-pwa-config';
const KEEP = [IMAGE_CACHE, PWA_CONFIG_CACHE];

// كل ملف هنا يجب أن يكون مخزَّنًا **قبل** أول رسم. وحارس في
// `tools/repository-safety.test.mjs` يفشل إن استورد `app.js` وحدةً ناقصة من
// هذه القائمة: وحدة منسيّة تعني أن الإقلاع ينتظر الشبكة من حيث لا ندري.
const SHELL = [
  '/icons/pwa-icon-192.png',
  '/icons/pwa-icon-512.png',
  '/icons/pwa-maskable-192.png',
  '/icons/pwa-maskable-512.png',
  '/icons/pwa-apple-touch-icon.png',
  '/icons/pwa-favicon-32.png',
  '/',
  '/app.js',
  '/reader.js',
  '/styles.css',
  '/lib/sync.js',
  '/lib/optimistic.js',
  '/lib/updater.js',
  '/lib/translate.js',
  '/lib/translation-repair-admission.js',
  '/lib/translate-batch.js',
  '/lib/translate-settings.js',
  '/lib/translate-learn.js',
  '/lib/translate-jobs.js',
  '/lib/translate-perf.js',
  '/lib/translation-native.js',
  '/lib/chapter-store.js',
  '/lib/icons.js',
  '/lib/config.js',
  '/lib/silk.js',
  '/lib/silk-palette.js',
  '/lib/gate-policy.js',
  '/lib/frame.js',
  '/lib/content-api.js',
  '/lib/notifications.js',
  '/lib/queue.js',
  '/lib/tasks.js',
  '/lib/netpolicy.js',
  '/lib/toast.js',
  '/lib/report.js',
  '/screens/accounts.js',
  '/screens/pin-pad.js',
  '/screens/add-account.js',
  '/screens/sources.js',
  '/lib/extension-engine.js',
  '/lib/catalog.js',
  '/lib/manga-aliases.js',
  '/lib/manga-alias-store.js',
  '/data/manga-aliases.json',
  '/lib/manga-meta.js',
  '/v35/card-reconcile.js',
  '/v35/image-loading.js',
  '/v35/text-actions.js',
  '/v35/source-latest.js',
  '/v35/insights.js',
  '/v35/work-insights.js',
  '/v35.css',
  '/v35/core.css',
  '/addons/adapters/bundled.js',
  '/addons/adapters/remote.js',
  '/addons/adapters/stremio.js',
  '/addons/cache.js',
  '/addons/assessment.js',
  '/addons/import.js',
  '/addons/stremio-model.js',
  '/addons/contracts.js',
  '/addons/health.js',
  '/addons/identity.js',
  '/addons/manifest.js',
  '/addons/media.js',
  '/addons/native-runtime.js',
  '/addons/native-transport.js',
  '/addons/registry.js',
  '/addons/runtime.js',
  '/addons/scheduler.js',
  '/addons/streams.js',
  '/addons/subtitles.js',
  '/addons/transport.js',
  '/addons/video.js',
  '/addons/work-view.js',
  '/pwa/player/subtitles.js',
  '/pwa/player/subtitle-adjustments.js',
  '/pwa/sources/hls-variants.js',
  '/v35/addons-view.js',
  '/v35/source-mode.js',
  '/vendor/hls.min.js',
  '/v35/shell.js',
  '/v35/markup.js',
  '/v35/icons.js',
  '/v35/plural.js',
  '/v35/works.js',
  '/v35/work-ref.js',
  '/v35/covers.js',
  '/v35/emoji.js',
  '/v35/reading.js',
  '/v35/reader.js',
  '/v35/tap-gesture.js',
  '/v35/reader-core.js',
  '/v35/reader-translate.js',
  '/v35/reader.css',
  '/v35/majlis.js',
  '/v35/friends.js',
  '/v35/friends-reading.js',
  '/v35/feed-snapshot.js',
  '/v35/majlis-chat.js',
  '/v35/social-kit.js',
  '/v35/voice.js',
  '/v35/frame-viewer.js',
  '/v35/profile.js',
  '/v35/profile-theme.js',
  '/v35/profile-top.js',
  '/v35/profile-color.js',
  '/v35/profile-color-picker.js',
  '/v35/profile-contrast.js',
  '/v35/profile-appearance.js',
  '/v35/profile-editor.js',
  '/v35/media-encode.js',
  '/vendor/gifenc.js',
  '/lib/identity.js',
  '/avatars/meshal.webp',
  '/avatars/d7m.webp',
  '/avatars/man.webp',
  '/v35/profile.css',
  '/v35/share.js',
  '/v35/majlis.css',
  '/v35/social.css',
  '/v35/anime.css',
  '/v35/cinema.css',
  '/v35/manga.css',
  '/v35/anime.js',
  '/v35/cinema.js',
  '/v35/anime-account.js',
  '/v35/rafiq.js',
  '/v35/rafiq.css',
  '/v35/wide.css',
  '/v35/addons.css',
  '/account.css',
  '/v35/side-dock.js',
  '/v35/sections.js',
  '/v35/updates-view.js',
  '/v35/motion.js',
  '/vendor/gsap.esm.js',
  '/lib/anime-meta.js',
  '/lib/anime-engine.js',
  '/lib/cinema-meta.js',
  '/lib/cinema-match.js',
  '/lib/cinema-fast.js',
  '/lib/cinema-identity.js',
  '/lib/source-states.js',
  '/lib/update-engine.js',
  '/lib/follow-time.js',
  '/lib/release.js',
  '/lib/capabilities.js',
  '/lib/migrations.js',
  '/anime/sources.json',
  '/manifest.webmanifest',
  '/fonts/NotoSansArabic.var.woff2',
  '/fonts/Inter-Latin.var.woff2',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  // قناع شعار «من يتابع؟»: بدونه يظهر مربّعٌ ملوّن مكان الشعار دون اتصال
  '/icons/logo-mark.png',
  // الـPWA (pwa/): جسور الويب ومحركات المصادر والكاش. تُستورد في المتصفح وحده،
  // وتُخزَّن هنا ليفتح التطبيق دون اتصال على آخر ما رآه.
  '/pwa/boot.js',
  '/pwa/bridges/anime.js',
  '/pwa/bridges/manga.js',
  '/pwa/cache/images.js',
  '/pwa/cache/store.js',
  '/pwa/net/endpoint.js',
  '/pwa/net/fetcher.js',
  '/pwa/platform.js',
  '/pwa/player/player.css',
  '/pwa/player/player.js',
  '/pwa/runtime.js',
  '/pwa/sources/contract.js',
  '/pwa/sources/crypto.js',
  '/pwa/sources/dates.js',
  '/pwa/sources/defs.json',
  '/pwa/sources/dom.js',
  '/pwa/sources/engines/arabseed.js',
  '/pwa/sources/engines/index.js',
  '/pwa/sources/engines/madara.js',
  '/pwa/sources/engines/iken.js',
  '/pwa/sources/engines/mangadex.js',
  '/pwa/sources/engines/mangaswat.js',
  '/pwa/sources/engines/mangathemesia.js',
  '/pwa/sources/engines/teamx.js',
  '/pwa/sources/engines/zeistmanga.js',
  '/pwa/sources/engines/shahiid.js',
  '/pwa/sources/engines/tuktuk.js',
  '/pwa/sources/engines/akwam.js',
  '/pwa/sources/engines/egydead.js',
  '/pwa/sources/engines/ristoanime.js',
  '/pwa/sources/engines/okanime.js',
  '/pwa/sources/engines/video-common.js',
  '/pwa/sources/engines/witanime.js',
  '/pwa/sources/hosts.js',
  '/pwa/sources/registry.js',
  '/pwa/update.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      if (!BUNDLED) {
        const cache = await caches.open(VERSION);
        // addAll ذرّية: ملف واحد يفشل ⇒ لا تثبيت، وهذا مقصود حتى لا تبقى
        // قشرة نصف مخزّنة تُخدم لاحقًا
        await cache.addAll(SHELL);
      }
      // الـAPK: يتفعّل فورًا كما كان. الويب: ينتظر حتى يضغط الشخص «تحديث»
      // (رسالة skip-waiting) أو يُغلق التطبيق — لا تحديث يكسر جلسة مفتوحة.
      if (BUNDLED) await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      // داخل الـAPK يُمسح كل شيء، ومنه ما خزّنته نسخة أقدم من هذا الملف —
      // وهذا ما يفكّ جهازًا عالقًا على واجهة قديمة بلا مسح بيانات التطبيق.
      const doomed = BUNDLED ? names : names.filter((name) => name !== VERSION && !KEEP.includes(name));
      await Promise.all(doomed.map((name) => caches.delete(name)));
      await self.clients.claim();
    })(),
  );
});

/** رسالة من الصفحة لتفعيل نسخة جديدة فورًا بدل انتظار إغلاق كل التبويبات. */
self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') void self.skipWaiting();
});

const isShellRequest = (url) =>
  SHELL.includes(url.pathname) ||
  url.pathname.startsWith('/icons/') ||
  url.pathname.startsWith('/fonts/') ||
  url.pathname.startsWith('/lib/') ||
  url.pathname.startsWith('/pwa/') ||
  url.pathname.startsWith('/screens/');

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // أصل آخر: لا شأن لنا به
  if (url.origin !== self.location.origin) return;

  // داخل الـAPK لا اعتراض: الطلب يذهب إلى خادم Capacitor المحلي فيقرأ ملف
  // الحزمة الحالي. وهذا وحده يضمن أن تحديث الـAPK يصل الشاشة.
  if (BUNDLED) return;

  // كل ما هو مصادَق عليه يمر إلى الشبكة ولا يُلمس
  if (url.pathname.startsWith('/v1/') || url.pathname.startsWith('/health')) return;

  // صور المصادر في الـPWA: من الكاش أولًا، وإلا عبر جالب الويب ثم تُحفظ
  if (url.pathname === '/__img') {
    event.respondWith(sourceImage(url));
    return;
  }

  // التنقّل: **الكاش أولًا**.
  //
  // كان هذا المسار شبكة أولًا ليصل التحديث فورًا، وثمنه أن كل إقلاع بارد
  // ينتظر الشبكة قبل أول بكسل — على شبكة جوال متذبذبة تعني شاشة بيضاء
  // ثوانيَ، وهي أول ما يحكم به المستخدم على التطبيق.
  //
  // العامل الجديد ينزّل القشرة كاملة في كاش منفصل. لا نكتب ملفات النسخة
  // الجديدة في كاش العامل القديم قبل تطبيق التحديث.
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        const cache = await caches.open(VERSION);
        const cached = await cache.match('/');

        if (cached) return cached;
        const fromNetwork = fetch(request)
          .then((response) => {
            if (response.ok) void cache.put('/', response.clone());
            return response;
          })
          .catch(() => undefined);

        // أول زيارة في حياة الجهاز: لا قشرة مخزَّنة بعد، فالشبكة هي الطريق
        return (await fromNetwork) ?? Response.error();
      })(),
    );
    return;
  }

  if (!isShellRequest(url)) return;

  // القشرة المثبتة ثابتة؛ العامل الجديد ينزّل التحديث في كاش منفصل.
  event.respondWith(
    (async () => {
      const cache = await caches.open(VERSION);
      const cached = await cache.match(request);

      if (cached) return cached;
      const revalidate = fetch(request)
        .then((response) => {
          if (response.ok) void cache.put(request, response.clone());
          return response;
        })
        .catch(() => undefined);

      return (await revalidate) ?? Response.error();
    })(),
  );
});

// ───────────────────── صور المصادر (PWA فقط) ─────────────────────
//
// الواجهة تضع `<img src="/__img?u=…&r=…">` (pwa/cache/images.js). هنا:
//   - موجودة في كاش الصور ⇒ تُرد فورًا، بلا شبكة (وتعمل دون اتصال).
//   - غير موجودة ⇒ تُجلب من جالب الويب بالإذن المحفوظ، وتُحفظ إن كانت صورة.
//   - الكاش محدود: أكثر من MAX_IMAGES أو تجاوز نصف حصة الموقع ⇒ يُحذف الأقدم.
// المفتاح رابط الصورة الأصلي وحده (بلا الإذن ولا المرجع)، فتجديد الإذن لا يفرغه.

const MAX_IMAGES = 2500;
let lastTrim = 0;

async function pwaConfig() {
  const cache = await caches.open(PWA_CONFIG_CACHE);
  const hit = await cache.match('/__pwa/config');
  if (!hit) return null;
  try {
    return await hit.json();
  } catch {
    return null;
  }
}

async function sourceImage(url) {
  const source = url.searchParams.get('u') ?? '';
  const key = new Request(`/__img?u=${encodeURIComponent(source)}`);
  const cache = await caches.open(IMAGE_CACHE);
  const hit = await cache.match(key);
  if (hit) return hit;

  const config = await pwaConfig();
  if (!config?.fetchBase || !config?.grant || !/^https?:\/\//.test(source)) return new Response(null, { status: 503 });
  const remote = new URL('/v1/media', config.fetchBase);
  remote.searchParams.set('u', source);
  const referer = url.searchParams.get('r');
  if (referer) remote.searchParams.set('r', referer);
  remote.searchParams.set('g', config.grant);

  let response;
  try {
    response = await fetch(remote.toString(), { mode: 'cors', credentials: 'omit' });
  } catch {
    return new Response(null, { status: 504 });
  }
  const type = response.headers.get('content-type') ?? '';
  if (response.ok && type.startsWith('image/')) {
    const body = await response.blob();
    const stored = new Response(body, { status: 200, headers: { 'content-type': type, 'cache-control': 'max-age=31536000' } });
    try {
      await cache.put(key, stored.clone());
    } catch {
      // القرص ممتلئ: نكنس بقوة، والصورة تُعرض على كل حال
      lastTrim = 0;
    }
    void trimImages();
    return stored;
  }
  return response;
}

/** يحذف الأقدم دخولًا حتى يرجع الكاش تحت الحد (مرة كل دقيقة على الأكثر). */
async function trimImages() {
  const now = Date.now();
  if (now - lastTrim < 60_000) return;
  lastTrim = now;
  const cache = await caches.open(IMAGE_CACHE);
  const keys = await cache.keys();
  let excess = keys.length - MAX_IMAGES;
  try {
    const { usage = 0, quota = 0 } = (await self.navigator.storage?.estimate?.()) ?? {};
    // فوق نصف الحصة: نحرر خُمس الصور أيضًا
    if (quota && usage > quota / 2) excess = Math.max(excess, Math.ceil(keys.length / 5));
  } catch {
    // بلا تقدير: العدد وحده يحكم
  }
  // keys() بترتيب الإدخال: الأول هو الأقدم
  for (const request of keys.slice(0, Math.max(0, excess))) await cache.delete(request);
}
