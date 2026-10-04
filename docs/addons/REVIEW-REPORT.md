# المراجعة المستقلة وإصلاح الحدود — 2026-10-04

مراجعة الفرع كاملًا: 96 اختبار حدود ناجح، لكن إعادة الإنتاج كشفت 9 ملاحظات Important؛ لم تُصنّف أي Critical. أُصلحت الملاحظات في مرور واحد مع اختبارات regression. المجموعة النهائية **1509 اختبارًا /176 ملفًا**، الحراسة **54/54**، TypeScript API/sync/fetcher ناجح، Kotlin 243 (2 skipped موجودة) وبناء debug ناجح. لا يعتمد هذا التقرير على نجاح اختبارات قبل الإصلاح فقط.

| المشكلة قبل | السبب الحقيقي | التصحيح المحدود | دليل بعد |
|---|---|---|---|
| مزود الترجمة لا يُسأل لفيديو السينما المدمج | candidate.kind=cinema يطغى على series/movie المؤكدة | bridge لا يختلق kind؛ subtitle session يقبل أنواع العمل الحقيقية فقط | confirmed IMDb/S/E يستدعي provider بعد candidate legacy cinema |
| S2E1 يشغّل S1E1 من Remote | مطابقة رقم الحلقة وحده؛ response يحتوي مواسم متعددة | فلتر requestedSeason ومطابقة فريدة موسم+حلقة | bridge all-season regression يطلب s2e1 |
| التالي يفقد addon copies أو يعود للموسم الأول | copies المرسلة للمشغل لقطة locator الأصلية قبل إضافة المزود | prepare/snapshot يحتفظان بالنسخ الفعلية؛ warm/player يمررانها مع الموسم والحلقة | S2E1→S2E2 في bridge والمتصفح الحقيقي |
| EXPIRED / headers / DASH تظهر Ready | normalization reason موجود لكن publication يفحص URL فقط | gate قبل probe/publication يحفظ سبب الرفض | ثلاث حالات تبقى UNAVAILABLE ولا autoplay |
| URL إعدادات B يعيد بيانات A بنفس id/version | كاش يعتمد على id/version فقط | UUID محلي cacheEpoch عند install/activate/rollback؛ يمر عبر runtime وbridge caches | config-A→config-B يفعل request B؛ لا config secret في مفتاح الكاش |
| جودة HLS مستقلة تفقد الصوت/الترجمة | variant video URL لا يتضمن EXT-X-MEDIA الخارجية | إبقاء master حين يرتبط بملف Audio/Subtitle خارجي؛ مستويات المشغل تبقى متاحة | AUDIO وSUBTITLES regression، الأصل محفوظ |
| فيلم bundled Source Mode يصبح مسلسلًا | مصدر cinema يدعم النوعين، والافتراض series | نوع item المثبت، أو عنوان المصدر المعروف، أو مسار Akwam الموثق؛ الملتبس يفشل بوضوح | Akwam/movie يصبح movie؛ عمل مجهول لا يُخمن |
| عمل provider-local محفوظ لا يعاد فتحه | shell/controller يحاولان AniList/Cinemeta بمعرف الإضافة | مرجع opaque يحمل المزود والعمل؛ استرجاع التفاصيل والحلقات من إضافة enabled نفسها | custom:42 محفوظ في Top5 ثم يفتح نفس الفيلم فعليًا؛ MAL-only يحتفظ بهوية المزود |
| إضافة سريعة تنتظر بحث المصادر البطيء | warmUp ينتظر h.first قبل بدء addons | السباق بين نسخ الهوية المؤكدة ونسخ locator؛ النتيجة الفارغة لا تلغي الأخرى | Ready **208ms** مع core search معلّق، بلا فيديو حتى ضغط Play |

## الملفات وأسبابها

- `addons/registry.js`, `runtime.js`: cacheEpoch لا يكشف configured URL، وإلغاء meta عبر signal.
- `addons/adapters/remote.js`: فلتر الموسم؛ عقد API نفسه.
- `addons/video.js`, `lib/anime-engine.js`: استمرار النسخ الفعلية والتجهيز المبكر، بلا تغيير ترتيب السيرفر أو بدء تلقائي.
- `addons/work-view.js`: إثبات النوع واستعادة provider-local؛ لا بحث بالعنوان.
- `pwa/bridges/anime.js`: مطابقة الموسم، gate للـstreams، نسخ الجلسة، kind الصحيح، cache namespace والإلغاء.
- `pwa/bridges/manga.js`: تغيير namespace **لإضافات المانجا فقط** عند تغير إعداد المزود؛ القارئ وكاش المصادر المدمجة كما هما.
- `pwa/player/subtitles.js`, `player.js`: حماية هوية الترجمة وتمرير نسخة الحلقة التالية الفعلية.
- `v35/cinema.js`, `anime.js`, `shell.js`: ربط الاسترجاع/التجهيز بالمكونات الموجودة.
- `v35/anime-account.js`: سطر تحويل مرجع العرض يقبل addon ID بدل NaN؛ لا schema أو sync op أو تغيّر ملكية حساب.
- `pwa/sources/hls-variants.js`: عدم إسقاط rendition groups.
- اختبارات مقابل كل حد؛ و`subtitle-adjustments.test.js` يثبت وصول cues المتأخرة وتحديث controls الحقيقية فقط.

## أدلة التنفيذ والحدود

Red→Green موثق محليًا: اختبارات cache/kind/HLS/identity/status فشلت قبل الإصلاح؛ season/next/fast discovery فشلت قبل توفر السلوك؛ ثم نجحت المجموعة الكاملة. تحقق Chromium استخدم shell/player الحقيقيين مع مزود HTTP controlled وفيديو اختبار. لا يُقدَّم قياس 208ms كقياس upstream/4G أو ضمان لكل الأعمال.

لا Critical/Important معلّقة من هذه المراجعة. Minor مؤجلة: getter مزودي ترجمة APK يستخدم health.allow؛ لا يُغذّى حاليًا بنتائج native في ذلك الموضع. عند ربط native health لاحقًا يجب تحويل القراءة إلى ready دون حجز half-open. كلفة التأجيل: لا اختبار recovery native لهذه الحالة الآن. ملاحظة abort episodes/meta عولجت ضمن الحدود نفسها.

المصادر الحية وقيود Cloudflare/403/محذوف/بروتوكولات المضيف غير المحسومة مفصلة في IMPLEMENTATION-REPORT؛ لم تُحل بإخفاء الفشل أو Ready وهمي. لا ادعاء اكتمال جميع بنود SPEC أو توفر 4K لكل عمل، ولا اختبار هاتف فعلي لهذه الحزمة.
