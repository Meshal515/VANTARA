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

// أي تعديل على ملفات القشرة يحتاج رقمًا جديدًا هنا، وإلا خدم الـSW القديم
const VERSION = 'vantara-shell-v4';

// كل ملف هنا يجب أن يكون مخزَّنًا **قبل** أول رسم. وحارس في
// `tools/repository-safety.test.mjs` يفشل إن استورد `app.js` وحدةً ناقصة من
// هذه القائمة: وحدة منسيّة تعني أن الإقلاع ينتظر الشبكة من حيث لا ندري.
const SHELL = [
  '/',
  '/app.js',
  '/reader.js',
  '/styles.css',
  '/lib/sync.js',
  '/lib/update.js',
  '/lib/icons.js',
  '/lib/config.js',
  '/lib/colors.js',
  '/lib/gradient.js',
  '/lib/coverflow.js',
  '/lib/content-api.js',
  '/lib/notifications.js',
  '/lib/queue.js',
  '/lib/tasks.js',
  '/lib/netpolicy.js',
  '/lib/toast.js',
  '/screens/accounts.js',
  '/manifest.webmanifest',
  '/fonts/NotoNaskhArabic-Regular.woff2',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(VERSION);
      // addAll ذرّية: ملف واحد يفشل ⇒ لا تثبيت، وهذا مقصود حتى لا تبقى
      // قشرة نصف مخزّنة تُخدم لاحقًا
      await cache.addAll(SHELL);
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((name) => name !== VERSION).map((name) => caches.delete(name)));
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
  url.pathname.startsWith('/screens/');

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // أصل آخر: لا شأن لنا به
  if (url.origin !== self.location.origin) return;

  // كل ما هو مصادَق عليه يمر إلى الشبكة ولا يُلمس
  if (url.pathname.startsWith('/v1/') || url.pathname.startsWith('/health')) return;

  // التنقّل: **الكاش أولًا**.
  //
  // كان هذا المسار شبكة أولًا ليصل التحديث فورًا، وثمنه أن كل إقلاع بارد
  // ينتظر الشبكة قبل أول بكسل — على شبكة جوال متذبذبة تعني شاشة بيضاء
  // ثوانيَ، وهي أول ما يحكم به المستخدم على التطبيق.
  //
  // ولا نفقد التحديث: النسخة الجديدة تُجلب في الخلفية وتُخزَّن للمرة القادمة،
  // و`lib/update.js` يسأل عن `version.json` ويعرض «حدّث الآن» — فآلية
  // التحديث موجودة أصلًا ولا تحتاج أن يدفع الإقلاع ثمنها.
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        const cache = await caches.open(VERSION);
        const cached = await cache.match('/');

        const fromNetwork = fetch(request)
          .then((response) => {
            if (response.ok) void cache.put('/', response.clone());
            return response;
          })
          .catch(() => undefined);

        if (cached) {
          event.waitUntil(fromNetwork);
          return cached;
        }
        // أول زيارة في حياة الجهاز: لا قشرة مخزَّنة بعد، فالشبكة هي الطريق
        return (await fromNetwork) ?? Response.error();
      })(),
    );
    return;
  }

  if (!isShellRequest(url)) return;

  // القشرة: من الكاش فورًا، وتحديث في الخلفية للمرة القادمة
  event.respondWith(
    (async () => {
      const cache = await caches.open(VERSION);
      const cached = await cache.match(request);

      const revalidate = fetch(request)
        .then((response) => {
          if (response.ok) void cache.put(request, response.clone());
          return response;
        })
        .catch(() => undefined);

      if (cached) {
        // لا ننتظر التحديث: الرد فوري، والنسخة الجديدة تُستخدم في الزيارة التالية
        event.waitUntil(revalidate);
        return cached;
      }
      return (await revalidate) ?? Response.error();
    })(),
  );
});
