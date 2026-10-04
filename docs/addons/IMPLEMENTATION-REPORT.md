# تقرير التنفيذ قبل الدمج — Addon Fabric 0.2.0

**النتيجة:** نظام إضافات PWA قابل للاستخدام، مع إصلاحات محددة للجودات والكاش والتشخيص وترجمة حقيقية داخل المشغل. الفرع `feat/addon-fabric` و[PR #143](https://github.com/Meshal515/VANTARA/pull/143) للمراجعة؛ لا دمج أو نشر لهذه التغييرات بعد. هذا ليس إعلان اكتمال 64 بندًا أو ضمان 10K عمل أو 4K لكل فيديو.

## المشاكل وأسبابها والتعديل المحدود

| المشكلة | السبب الذي ثبت | التعديل | دليل القبول |
|---|---|---|---|
| Master HLS يظهر جودة غير محددة أو 720 مع أن فيه 1080 | المرشح لا يوسع multivariant ، أو يتخطى master المسمى 720 ؛ bucket يحوّل 1440/2160 إلى 1080 | قراءة RESOLUTION المحدودة في الخلفية، جودات فعلية، original Ready مستقلة، Auto عند المجهول | master حي 480/720/1080 ، tests labelled720 و 4K ، no autoplay |
| backup يمسك أول جودة | حاجز انتظار جماعي قبل نشر الجودة | نشر كل نتيجة probe مستقلة، scheduler محدودة للإضافات | fast Ready بينما dead RESOLVING ؛ اختيار 480 رغم 1080 جاهزة |
| الإضافة تستخدم جالب المصادر وتوكنه | boundary القديم مصمم لمصادر allowlist | addon direct public HTTPS فقط؛ core path كما كان | media/image/probe tests ، browser manifest→frame |
| موسم 1 يخرج بدل موسم 2 | cache URL لا يتضمن سياق موسم الإضافة/إصدارها | addon-only cache key version/type/S/E/memo ؛ core key محفوظ | RED→GREEN نفس work URL لموسمين |
| chapter1 من عمل آخر في Remote API | الفصل provider-local وحده بلا work memo | تغليف memo بـ addonWorkId/providerMemo واستخدامه لل pages/cache | repeated chapterID tests + reader regression ؛ لا progress migration |
| manifest مع resources null أو capabilities object يعطل المدير | dereference قبل رفض حقول nested | validation ترفض وتعيد errors دون crash | 3 malformed regression cases RED→GREEN |
| timeout الإضافة لا يدخل health cooldown | timeout كان AbortError مثل إلغاء المستخدم | TimeoutError مقابل AbortError ؛ health capability مستقل | timeout/retry/half-open regressions |
| قراءة provider list تستنفد half-open probe | getter يستدعي allow التي تحجز probe | ready pure ثم allow عند الطلب الحقيقي | إعادة listing ثم successful retry |
| Native cancellation يصل قبل IO registration | cancel يبحث Call لم تسجل بعد | bounded cancellation markers وقفل التسجيل/check قبل execute | RED→GREEN cancel-before-start |
| native bounded body فارغ | peek/read استُخدم على مصدر وصل EOF | قراءة Buffer محدودة limit+1 | GET{} وحراسة oversize RED→GREEN |
| صفحات 403/429/503 أو script verification تُرى ك 0 links عامة | host parser يقرأ failure HTML كصفحة عادية | UPSTREAM_HTTP/status و RESOLVER_BROWSER_REQUIRED مع script/body guard | status/challenge fixtures ، Sibnet403 live |
| soft subs تضيع و HLS light لا يشغلها | bridge أسقط candidate.subtitles والبناء light يحذف caption controller | نقل metadata ، full hls.js1.6.15 ، جلسة tracks منفصلة، ورقة ⋮ الحالية | source VTT + actual OpenSubtitles609cues في player |
| tracks من server/episode/choice قديمة | asynchronous نتائج تحمل context قديم | generation ، signal ، selection guard ، cleanup files/Blob/listeners | switch/Off/late/provider failure tests ؛ physical Media3 لم تختبر |

أضاف المالك لاحقًا تعديلات UI محددة؛ نُفذت بحدود موثقة في [تقرير الواجهة قبل وبعد](UI-REPORT.md). native source architecture وAniyomi محفوظان. لا مصادر جديدة ولا توسيع allowlist. مرآة 404 العامة تتيح الأصل؛ deleted الصريح و 410 terminal محفوظان باختباراتهما من PR141. سلسلة redirect تتقيد بالقفزة السابقة في الكود السابق؛ اختبار 403 لعائلة Uqload/Vidmoly ضمن suite الحالية.

## المسار القابل للاستخدام

1. خانة «الإضافات» ثابتة بقطعة أحجية SVG في الأقسام الثلاثة، وفلاتر محتوى وحالة داخلها.
2. URL→معاينة name/version/capabilities/hosts→تثبيت صريح. configured URL محفوظ محليًا ولا يظهر في البطاقة/رسالة الخطأ.
3. المصادر الحالية adapters للحدود فقط؛ Remote v1 JSON و Stremio مستقلان؛ لا remote JS/eval/iframe/APK execution.
4. Source Mode يتصفح ويبحث المصدر المختار فقط، مع pagination بحسب capability ؛ يفتح بطاقات وتفاصيل/قارئ/مشغل VANTARA الموجودة. Back يحفظ tab/query/scroll.
5. الهوية من IDs صريحة ونوع العمل والسياق؛ لا دمج إضافات بالعنوان ولا guess IMDb للأنمي. Unknown يبقى unknown.
6. Streams عامة browser-compatible فقط؛ torrent/infoHash/externalUrl/localhost/required headers/DASH ليست Ready في PWA. لا proxy عالمي للإضافات.
7. scheduler تبدأ 3 وتوسع 4/5/6 بعد 250/700/1500ms ، ≤3 لكل origin ؛ تعطّل provider لا يحجب نتيجة أخرى ولا يغير اختيار المستخدم.
8. health لكل addon/capability/runtime ، p50/p95 من آخر 50 samples ، آخر استجابة ناجحة، failure/empty/timeout ، cooldown30s/2m/10m بعد 3/4/5 failures ، retry يدوي. نجاح manifest لا يثبت playback.
9. TTL منفصلة و version/input isolation ؛ streams بلا expiry مثبت لا تكاش. snapshots تحرس جلسات source/reader/playback ، staged permissions قبل التفعيل و rollback compatible.
10. Pin محلي بحسب profile ، storage منفصل vantara-addons باستخدام store الحالي؛ لا schema للمكتبة/التقدم/الحساب.

## الترجمات

- hard sub جزء من الصورة، والصوت العربي ليس Text Track. لا ادعاء إزالة/تحريك ترجمة محروقة.
- soft source/embedded مستقلة عن providers ، وتظهر من metadata/track events. المصدر العربي له الأولوية؛ Off واختيار المستخدم محفوظان.
- provider جديدة تُفحص في الخلفية؛ manifest وحده لا يفتح UI وهمية. نتائج فعلية أو health ناجحة تسمح بقائمة finite. فشلها لا يستدعي playback failover.
- IMDb+kind+season/episode أساس الطلب، filename/hash/size إن وجدت. exact release لا يثبت بالاسم أو بادعاء provider وحده؛ لا اختيار external تلقائي عشوائي.
- PWA ورقة واحدة من⋮: إيقاف/من الفيديو/ترجمات إضافية؛ SRT/VTT bounded إلى WebVTT ، no HTML execution ، ASS غير مدعوم.
- APK زر الترجمة الأصلي، Kotlin/OkHttp/Media3 ؛ addons remote هنا subtitles فقط. نتائج discovery لا تعيد prepare ؛ الاختيار الصريح يحمل ملفًا محليًا مع حفظ position/playWhenReady. لا كود JS native source ولا تسريب cookie/header الفيديو للمزود.
- لا AI أو editor. طلب المالك اللاحق يضيف توقيت/حجم/موضع PWA Soft subtitles في Panel مستقلة، وفق دعم runtime وبلا reload؛ [دليل الواجهة](UI-REPORT.md).

## الاختبارات التي شُغلت

| الفحص | النتيجة |
|---|---|
| Vitest whole repository | **1509/1509 ، 176 ملفًا**، 65.39s |
| repository safety | **54/54**؛ imports/precache/digest/platform gate/allowlist/CSS guards |
| TypeScript direct compiler API/sync/fetcher | ناجح؛ pnpm wrapper توقف قبل mutation لأنه أراد reinstall linked node_modules بلا TTY ؛ استخدمنا compiler المثبت، لا dependency change |
| Kotlin + assembleDebug | **243 tests ، 0 failures ، 2 existing skipped**؛ build ناجح |
| Chromium151 full shell manager | manga/anime/cinema ، narrow/wide ؛ لا page errors |
| Controlled Stremio→catalog→meta→stream→selector→Play→HLS frame | إطار 320×180 ؛ **لا video قبلضغط Play**؛ ready عندفتح selector+7ms نتيجة warm ، ليست cold live TTFR |
| OpenSubtitles حقيقية داخل player | 87listing/4Arabic ؛ ملف 58797B ،**609cues عربية showing**؛ الفيديوعند 4.318s/ready4 ،لا errors ؛ الفيديو fixture لا Mentalist upstream |
| Source VTT في player | عربية showing ، 1cue ؛ تعمل دونمزوّدترجمة |
| slow/deadbackup ، latecallback ، qualitychoice ، zero links | regression أخضر؛ noauto مؤكدة في fixtures |
| manga original cache | regression السابق محفوظ، remotechapterownership إضافة مستقلة |
| PWAupdates/current shell | updater/build/release والسوابق ضمن suite ؛ swprecache يشمل كل modules الجديدة مع digest ؛ update production القديم→الجديد لا يثبت قبلالنشر |

[اختيار Ready دون autoplay](proofs/catalog-ready.png)، [إطار الفيديو بعد Play](proofs/catalog-frame.png)، [ترجمة عربية من Provider حقيقي](proofs/subtitle-live-on-frame.png)، [ترجمةالمصدر](proofs/subtitle-source-sheet.png)، [مدير desktop](proofs/manager-desktop.png)، [مدير mobile](proofs/manager-mobile.png).

## تدقيق المصادر الحالية

فُحصت المصادر الثمانية الموجودة بمحركاتها الفعلية من بيئة التطوير عبر proxy مباشر. هذه **ليست** شبكة الهاتف ولا fetcher production مصادقًا عليه. IPv4/IPv6 winning family غير معروفة هنا. زمن firstResolved أدناه **تسلسلي تشخيصي**، لا TTFR الواجهة؛ الروابط extracted **ليست frame-verified**. 0 روابط فشل استخراج دائمًا؛ لا نُنسبه للمضيف أو parser دوندليل. الاختبار لا يجمع نتائج search0 غيرالمناسبة باعتبارالمصدرتالفًا.

### witanime — witanime.site

الفحص: `challenge` بعد 109ms ، query `frieren`. Cloudflare محدود؛ ليس parser failure.

### shahiid — shahiid-anime.net

Query `naruto`: search22/1934ms ؛ العمل: Naruto ؛ الحلقات 20/2545ms ؛ الحلقة: الحلقة 1 ؛ السيرفرات 4/5871ms. firstResolved1930ms ؛ all7771ms.

| السيرفر | embed/actual host المعروف | resolver/adapter | الحالة | latency ms | streams/الجودة/ملفالفيديو |
|---|---|---|---|---:|---|
| Megamax متعدد | share4max.com | MegaMax mirror hub | RESOLVED_NOT_FRAME_VERIFIED | 1930 | 1 — hls/480/kpk2jakbzwgv.tnmr.org |
| Sendvid | sendvid.com | generic/packer/iframe | RESOLVED_NOT_FRAME_VERIFIED | 3287 | 1 — mp4/غيرمحددة/videos2.sendvid.com |
| الجودة HD | يُكتشف بعد POST/gate | source adapter direct | UPSTREAM_OR_FETCH_ERROR | 468 | 0 — لا streams |
| Okru | ok.ru | OK.ru metadata | RESOLVER_EMPTY | 2086 | 0 — لا streams |

### arabseed — m.myseed.pics

Query `toy story`: search10/373ms ؛ العمل: فيلم Toy Story 5 مدبلج مصري؛ الحلقات 1/0ms ؛ الحلقة: فيلم Toy Story 5 مدبلج مصري؛ السيرفرات 12/687ms. firstResolved1000ms ؛ all7130ms.

| السيرفر | embed/actual host المعروف | resolver/adapter | الحالة | latency ms | streams/الجودة/ملفالفيديو |
|---|---|---|---|---:|---|
| MySeed | يُكتشف بعد POST/gate | source adapter direct | RESOLVED_NOT_FRAME_VERIFIED | 1000 | 1 — mp4/1080/cdnfdcp2503.cdn.makeup |
| MySeed | يُكتشف بعد POST/gate | source adapter direct | RESOLVED_NOT_FRAME_VERIFIED | 701 | 1 — mp4/720/cdnfdcp2503.cdn.makeup |
| MySeed | يُكتشف بعد POST/gate | source adapter direct | RESOLVED_NOT_FRAME_VERIFIED | 712 | 1 — mp4/480/cdnfdcp2503.cdn.makeup |
| سيرفر 1 | vidara.to | generic/packer/iframe | RESOLVER_EMPTY | 596 | 0 — لا streams |
| سيرفر 2 | bysezejataos.com | generic/packer/iframe | RESOLVER_EMPTY | 289 | 0 — لا streams |
| سيرفر 3 | voe.sx | generic/packer/iframe | RESOLVER_EMPTY | 1094 | 0 — لا streams |
| سيرفر 1 | vidara.to | generic/packer/iframe | RESOLVER_EMPTY | 532 | 0 — لا streams |
| سيرفر 2 | bysezejataos.com | generic/packer/iframe | RESOLVER_EMPTY | 318 | 0 — لا streams |
| سيرفر 3 | voe.sx | generic/packer/iframe | RESOLVER_EMPTY | 894 | 0 — لا streams |
| سيرفر 1 | vidara.to | generic/packer/iframe | RESOLVER_EMPTY | 374 | 0 — لا streams |
| سيرفر 2 | bysezejataos.com | generic/packer/iframe | RESOLVER_EMPTY | 242 | 0 — لا streams |
| سيرفر 3 | voe.sx | generic/packer/iframe | RESOLVER_EMPTY | 377 | 0 — لا streams |

### tuktukcinema — tuktukhd.com

Query `the gentlemen`: search3/1182ms ؛ العمل: مسلسل The Gentlemen الموسم الثاني؛ الحلقات 8/325ms ؛ الحلقة: الحلقة 1 ؛ السيرفرات 1/294ms. firstResolved21662ms ؛ all21662ms.

| السيرفر | embed/actual host المعروف | resolver/adapter | الحالة | latency ms | streams/الجودة/ملفالفيديو |
|---|---|---|---|---:|---|
| TukTuk Vip | megatuktuk.store | tuktuk-site | RESOLVED_NOT_FRAME_VERIFIED | 21662 | 1 — hls/800/h85mclle5sxf9yf.acek-cdn.com |

### akwam — akwam.ss

الفحص: `HTTP_28` بعد 30019ms ، query `dune`. Timeout في شبكة التطوير؛ لا يثبت regression أو توقف المصدر على جهاز المستخدم.

### egydead — tv10.egydead.live

Query `dune`: search9/1441ms ؛ العمل: مشاهدة فيلم Dune Part 2 2024 مترجم؛ الحلقات 1/0ms ؛ الحلقة: مشاهدة فيلم Dune Part 2 2024 مترجم؛ السيرفرات 4/722ms. firstResolved1218ms ؛ all3078ms.

| السيرفر | embed/actual host المعروف | resolver/adapter | الحالة | latency ms | streams/الجودة/ملفالفيديو |
|---|---|---|---|---:|---|
| StreamHG | hgcloud.to | egydead-site | RESOLVED_NOT_FRAME_VERIFIED | 1218 | 1 — hls/غيرمحددة/qcsh3mkrd1sg2.premilkyway.com |
| EarnVids | morencius.com | egydead-site | RESOLVED_NOT_FRAME_VERIFIED | 795 | 1 — hls/غيرمحددة/dd2stliwt0bc.dramiyos-cdn.com |
| Mixdrop | mixdrop.top | egydead-site | UPSTREAM_REMOVED | 769 | 0 — لا streams |
| DoodStream | playmogo.com | egydead-site | RESOLVER_EMPTY | 296 | 0 — لا streams |

### ristoanime — ristoanime.me

Query `frieren`: search2/1831ms ؛ العمل: Sousou no Frieren ؛ الحلقات 28/504ms ؛ الحلقة: الحلقة 1 ؛ السيرفرات 7/285ms. firstResolved349ms ؛ all5842ms.

| السيرفر | embed/actual host المعروف | resolver/adapter | الحالة | latency ms | streams/الجودة/ملفالفيديو |
|---|---|---|---|---:|---|
| سيرفر 1 | vidmoly.net | ristoanime-site | RESOLVED_NOT_FRAME_VERIFIED | 349 | 1 — hls/غيرمحددة/prx-vi-a-1.vmpx.online |
| سيرفر 2 | video.sibnet.ru | ristoanime-site | UPSTREAM_HTTP_403 | 1245 | 0 — لا streams |
| سيرفر 3.1 | sendvid.com | ristoanime-site | UPSTREAM_HTTP_503 | 517 | 0 — لا streams |
| سيرفر 3 | listeamed.net | ristoanime-site | RESOLVER_EMPTY | 2464 | 0 — لا streams |
| سيرفر 4 | www.mp4upload.com | ristoanime-site | UPSTREAM_REMOVED | 181 | 0 — لا streams |
| سيرفر 5 | uqload.ws | ristoanime-site | UPSTREAM_REMOVED | 862 | 0 — لا streams |
| سيرفر احتياطي 1 | hlswish.com | ristoanime-site | UPSTREAM_REMOVED | 224 | 0 — لا streams |

### okanime — ww3.okanime.xyz

Query `one piece`: search8/616ms ؛ العمل: One Piece ؛ الحلقات 1180/226ms ؛ الحلقة: الحلقة 1 ؛ السيرفرات 3/292ms. firstResolved2717ms ؛ all3761ms.

| السيرفر | embed/actual host المعروف | resolver/adapter | الحالة | latency ms | streams/الجودة/ملفالفيديو |
|---|---|---|---|---:|---|
| mp4upload | mp4upload.com | okanime-site | UPSTREAM_REMOVED | 493 | 0 — لا streams |
| megamax | share4max.com | okanime-site | RESOLVED_NOT_FRAME_VERIFIED | 2224 | 1 — hls/1080/m5qqjwpatpzb.acek-cdn.com |
| uqload | uqload.is | okanime-site | RESOLVED_NOT_FRAME_VERIFIED | 1044 | 1 — hls/غيرمحددة/strm2.uqload.vc |

### Mentalist S01E01 ومعنى نتائج الجودة

الفحص الخاص بهذه الحالة: EgyDead وجد الموسم الأول و 23 حلقة و 4 سيرفرات. StreamHG استخرج HLS في 1073ms و EarnVids في 721ms ؛ Mixdrop حذف صريح و Dood فارغ. Master حي أكد 480/720/1080 و H.264/AAC. Akwam سابقًا أعاد MP4 بدقة 720/1280×720 و H.264/AAC ومدة 2709s و resolve519ms ؛ لا ننكر هذا baseline بسبب timeout عبر proxy الحالي.

فحص native/MSE الحي من بيئة التطوير لم يثبت frame ؛ fixture اشتغلت بالطريقين، لذلك لم أفرض MSE على الجميع. Slow Horses و Re:Zero والعمل المبلغ عنه تحتاج إعادة اختبار على نسخة الإنتاج بعد النشر. إصلاح عرض الجودة لا يثبت تشغيل كل مضيف.

Anime4Up redirect المشبوه لم يُمنح ثقة جديدة؛ المصدر ليس ضمن قائمة PWA الثمانية الفعلية. لا مصدر جديد بهذه المرحلة.

## الحدود قبل الدمج

- لم تختبر شبكة المستخدم أو 464XLAT أو winning connection family بهذه الجلسة. إصلاح IPv6 السابق في PR141 محفوظ؛ لا ادعاء أنه حل كل انتظار 45s.
- توجد روابط محذوفة و Cloudflare و HTTP403/503 و EMPTY غير محسومة. لا تصنيف Stable شامل. TukTuk استخرج رابطًا بعد 21.662s عبر proxy ؛ هذا ليس وعد ONE SECOND.
- Public demo من Google رد 403 عبر شبكة التطوير، فعُرض UNAVAILABLE. استُعمل controlled stream لاحقًا لإثبات مسار الإضافة، دون تحويل الرابط المحظور إلى Ready مزيفة.
- Continuity و embedded HLS captions و seek/failover في APK تحتاج هاتفًا. Unit tests وبناء debug لا يعوضان ذلك.
- بنود أوسع لم تكتمل: إعدادات declarative عامة، genre ، البحث العام الموحد للإضافات، زر «عرض جميع المصادر» من Source Mode ، كاش شعار الإضافة، telemetry الجلسة الشاملة و marketplace. المتوفر مسار v1 حقيقي؛ التغطية تسمي الجزئي صراحة.
- لا ضمان 4K دون وجودها عند upstream وتوافق codec. تسمية 720 لا تصبح 1080 بتعديل الواجهة. الجودات العالية المعلنة تُحفظ دون إسقاطها إلى bucket1080.
- تحديث PWA يحتاج دمجًا ونشرًا ثم فحص commit/build/SW الإنتاج. تغير native يحتاج APK جديدة؛ لا يكفي bundle واجهة فوق بصمة native قديمة.

## قرارات التنفيذ وكلفتها — Rulings I made

1. سكربتات مهارات cloud غير متاحة كملفات؛ استعملت سجلًا و brief يدويين بنفس الشروط. الكلفة إن أخطأت: نقص أتمتة السجل، دون استبدال الاختبارات.
2. بدأ T1 أثناء متابعة T0 ؛ fixture لم تثبت خللًا عامًا في transport ، فحفظت native/MSE الحاليين. الكلفة: حالة الشبكة أوالمضيف قد تحتاج متابعة بدل تغيير تخميني للمشغل.
3. نُفذت adaptersT4/T5 قبل صفحة T3 حتى توجد مسارات فعلية عند عرض installer. الكلفة: ترتيب التنفيذ فقط.
4. إعدادات الإضافات في instance من store الحالي باسم vantara-addons ، بلا schema/version تغيير. الكلفة: إعدادات محلية منفصلة يلزم دعم تصديرها لاحقًا.
5. Remote PWA تستخدم HTTPS/CORS مباشرة بلا proxy عام؛ streams التي تتطلب headers أو torrent أو localhost أو DASH غير مدعومة. الكلفة: بعض إضافات Stremio لا تعمل في هذه المنصة حاليًا.
6. APK remote addon تدعم ترجمات Stremio فقط الآن؛ مصادر Kotlin/Aniyomi تبقى في محركها. الكلفة: قدرات remote video/manga الخارجية في APK ليست متاحة بهذا الإصدار.
7. نستخدم configured URL منالمزود بدل اختراع نموذج settings لا يحدده البروتوكول. بقية بنود الرؤية الجزئية معلنة. الكلفة: إعداد provider يتم خارج المدير قبل لصق URL ، وبعض وظائف المواصفة تحتاج مرحلة لاحقة.
9. التصحيحات الأخيرة للبنر حافظت على cover وأبعاده وغيّرت focal position فقط؛ بانل Desktop على الحافة اليمنى المحددة بالدائرة في آخر صورة، والجوال بقي كما هو. الكلفة: موضع الصورة داخل cover يظل قصًا طبيعيًا، ولا نحوله إلى contain مخالف للطلب.
10. فتح provider-local من مرجع محفوظ يتطلب نفس الإضافة Enabled على الجهاز؛ لا title lookup أو Cinemeta بمعرف مزود. الكلفة: تعطيل/حذف الإضافة يعرض رسالة واضحة بدل فتح عمل آخر.
8. الاختبارات و fixture وروابط upstream والجهاز أدلة منفصلة؛ لا ادعاء frame أو Stable أو ONE SECOND حين لم يثبت. الكلفة: قبول T0/T7 للإنتاج يبقى غير مكتمل حتى اختبار الجهاز والجالب.

## المراجعة المستقلة

المراجعة المستقلة للفرع كله أعادت تشغيل 96 اختبار حدود ووجدت **9 Important، بلا Critical**. أُصلحت التسعة في مرور واحد، ثم أُعيدت المجموعة الكاملة (1509) وحراسة المستودع (54)، دون دورة إعادة مراجعة مستقلة أخرى. التفاصيل والسبب والاختبار لكل ملاحظة في [تقرير المراجعة](REVIEW-REPORT.md).

تحقق المتصفح النهائي: مرجع provider-local محفوظ في أفضل 5 أعاد فتح الفيلم عبر المزود نفسه؛ إضافة IMDb وصلت Ready خلال **208ms** بينما core locator معلق؛ لا video قبل ضغط الشخص؛ الانتقال S2E1→S2E2 طلب المسار الصحيح نفسه. هذه fixture محلية وليست قياس إنتاج أو وعد ONE SECOND.

ملاحظة Minor مؤجلة: getter مزودي ترجمة APK يستخدم health.allow بدل ready؛ health native لا تُغذّى حاليًا بنتائج التنفيذ في ذلك getter، فلم تُسجل blocker تشغيل. الكلفة: إذا رُبطت health native لاحقًا يلزم فصل القراءة عن حجز half-open. ملاحظة إلغاء episodes/meta عولجت بتمرير signal إلى الطلب الفعلي.

آخر أمر المالك أجاز الدمج والنشر بعد إنهاء التحقق؛ هذه الوثيقة تُرفع قبل الدمج، فلا تدّعي نشرًا سابقًا له.

## الملفات

قائمة الكود الكاملة نسبة إلى main قبل الدمج. كل مسار يتبع الإضافات، المصادر والتشغيل أو تعديلات UI المصرّح بها. SPEC الأصلية ومخططات الحساب/المكتبة/التقدم محفوظة؛ Vendor full hls نسخة 1.6.15 بنفس الرخصة، والبناء light السابق باقٍ. أسباب كل مجموعة أعلاه، وتفاصيل التخطيط في UI-REPORT والحدود في REVIEW-REPORT.

- [android/app/src/main/java/com/vantara/app/MainActivity.java](../../android/app/src/main/java/com/vantara/app/MainActivity.java)
- [android/app/src/main/kotlin/com/vantara/addons/AddonEnginePlugin.kt](../../android/app/src/main/kotlin/com/vantara/addons/AddonEnginePlugin.kt)
- [android/app/src/main/kotlin/com/vantara/addons/NativeAddonNetwork.kt](../../android/app/src/main/kotlin/com/vantara/addons/NativeAddonNetwork.kt)
- [android/app/src/main/kotlin/com/vantara/addons/RemoteAddonClient.kt](../../android/app/src/main/kotlin/com/vantara/addons/RemoteAddonClient.kt)
- [android/app/src/main/kotlin/com/vantara/addons/SubtitleProviders.kt](../../android/app/src/main/kotlin/com/vantara/addons/SubtitleProviders.kt)
- [android/app/src/main/kotlin/com/vantara/addons/SubtitleSession.kt](../../android/app/src/main/kotlin/com/vantara/addons/SubtitleSession.kt)
- [android/app/src/main/kotlin/com/vantara/anime/bridge/AnimeEnginePlugin.kt](../../android/app/src/main/kotlin/com/vantara/anime/bridge/AnimeEnginePlugin.kt)
- [android/app/src/main/kotlin/com/vantara/anime/player/PlayerActivity.kt](../../android/app/src/main/kotlin/com/vantara/anime/player/PlayerActivity.kt)
- [android/app/src/test/java/com/vantara/addons/RemoteAddonTest.kt](../../android/app/src/test/java/com/vantara/addons/RemoteAddonTest.kt)
- [apps/web/addons/adapters/bundled.js](../../apps/web/addons/adapters/bundled.js)
- [apps/web/addons/adapters/bundled.test.js](../../apps/web/addons/adapters/bundled.test.js)
- [apps/web/addons/adapters/remote.js](../../apps/web/addons/adapters/remote.js)
- [apps/web/addons/adapters/remote.test.js](../../apps/web/addons/adapters/remote.test.js)
- [apps/web/addons/adapters/stremio.js](../../apps/web/addons/adapters/stremio.js)
- [apps/web/addons/adapters/stremio.test.js](../../apps/web/addons/adapters/stremio.test.js)
- [apps/web/addons/cache.js](../../apps/web/addons/cache.js)
- [apps/web/addons/cache.test.js](../../apps/web/addons/cache.test.js)
- [apps/web/addons/contracts.js](../../apps/web/addons/contracts.js)
- [apps/web/addons/health.js](../../apps/web/addons/health.js)
- [apps/web/addons/health.test.js](../../apps/web/addons/health.test.js)
- [apps/web/addons/identity.js](../../apps/web/addons/identity.js)
- [apps/web/addons/identity.test.js](../../apps/web/addons/identity.test.js)
- [apps/web/addons/manifest.js](../../apps/web/addons/manifest.js)
- [apps/web/addons/manifest.test.js](../../apps/web/addons/manifest.test.js)
- [apps/web/addons/media.js](../../apps/web/addons/media.js)
- [apps/web/addons/media.test.js](../../apps/web/addons/media.test.js)
- [apps/web/addons/native-runtime.js](../../apps/web/addons/native-runtime.js)
- [apps/web/addons/native-transport.js](../../apps/web/addons/native-transport.js)
- [apps/web/addons/native-transport.test.js](../../apps/web/addons/native-transport.test.js)
- [apps/web/addons/registry.js](../../apps/web/addons/registry.js)
- [apps/web/addons/registry.test.js](../../apps/web/addons/registry.test.js)
- [apps/web/addons/runtime.js](../../apps/web/addons/runtime.js)
- [apps/web/addons/runtime.test.js](../../apps/web/addons/runtime.test.js)
- [apps/web/addons/scheduler.js](../../apps/web/addons/scheduler.js)
- [apps/web/addons/scheduler.test.js](../../apps/web/addons/scheduler.test.js)
- [apps/web/addons/streams.js](../../apps/web/addons/streams.js)
- [apps/web/addons/streams.test.js](../../apps/web/addons/streams.test.js)
- [apps/web/addons/subtitles.js](../../apps/web/addons/subtitles.js)
- [apps/web/addons/subtitles.test.js](../../apps/web/addons/subtitles.test.js)
- [apps/web/addons/transport.js](../../apps/web/addons/transport.js)
- [apps/web/addons/transport.test.js](../../apps/web/addons/transport.test.js)
- [apps/web/addons/video.js](../../apps/web/addons/video.js)
- [apps/web/addons/video.test.js](../../apps/web/addons/video.test.js)
- [apps/web/addons/work-view.js](../../apps/web/addons/work-view.js)
- [apps/web/addons/work-view.test.js](../../apps/web/addons/work-view.test.js)
- [apps/web/lib/addon-preparation.test.js](../../apps/web/lib/addon-preparation.test.js)
- [apps/web/lib/anime-engine.js](../../apps/web/lib/anime-engine.js)
- [apps/web/lib/release.js](../../apps/web/lib/release.js)
- [apps/web/pwa/boot.js](../../apps/web/pwa/boot.js)
- [apps/web/pwa/bridges/anime-probe.test.js](../../apps/web/pwa/bridges/anime-probe.test.js)
- [apps/web/pwa/bridges/anime-resolution.test.js](../../apps/web/pwa/bridges/anime-resolution.test.js)
- [apps/web/pwa/bridges/anime.js](../../apps/web/pwa/bridges/anime.js)
- [apps/web/pwa/bridges/manga-addon.test.js](../../apps/web/pwa/bridges/manga-addon.test.js)
- [apps/web/pwa/bridges/manga.js](../../apps/web/pwa/bridges/manga.js)
- [apps/web/pwa/player/player.css](../../apps/web/pwa/player/player.css)
- [apps/web/pwa/player/player.js](../../apps/web/pwa/player/player.js)
- [apps/web/pwa/player/player.test.js](../../apps/web/pwa/player/player.test.js)
- [apps/web/pwa/player/subtitle-adjustments.js](../../apps/web/pwa/player/subtitle-adjustments.js)
- [apps/web/pwa/player/subtitle-adjustments.test.js](../../apps/web/pwa/player/subtitle-adjustments.test.js)
- [apps/web/pwa/player/subtitles.js](../../apps/web/pwa/player/subtitles.js)
- [apps/web/pwa/player/subtitles.test.js](../../apps/web/pwa/player/subtitles.test.js)
- [apps/web/pwa/runtime.js](../../apps/web/pwa/runtime.js)
- [apps/web/pwa/sources/hls-variants.js](../../apps/web/pwa/sources/hls-variants.js)
- [apps/web/pwa/sources/hls-variants.test.js](../../apps/web/pwa/sources/hls-variants.test.js)
- [apps/web/pwa/sources/hosts-extractors.test.js](../../apps/web/pwa/sources/hosts-extractors.test.js)
- [apps/web/pwa/sources/hosts.js](../../apps/web/pwa/sources/hosts.js)
- [apps/web/sw.js](../../apps/web/sw.js)
- [apps/web/v35/addons-view.js](../../apps/web/v35/addons-view.js)
- [apps/web/v35/addons-view.test.js](../../apps/web/v35/addons-view.test.js)
- [apps/web/v35/anime-account.js](../../apps/web/v35/anime-account.js)
- [apps/web/v35/anime-account.test.js](../../apps/web/v35/anime-account.test.js)
- [apps/web/v35/anime.css](../../apps/web/v35/anime.css)
- [apps/web/v35/anime.js](../../apps/web/v35/anime.js)
- [apps/web/v35/cinema.css](../../apps/web/v35/cinema.css)
- [apps/web/v35/cinema.js](../../apps/web/v35/cinema.js)
- [apps/web/v35/icons.js](../../apps/web/v35/icons.js)
- [apps/web/v35/profile.css](../../apps/web/v35/profile.css)
- [apps/web/v35/shell.js](../../apps/web/v35/shell.js)
- [apps/web/v35/source-mode.js](../../apps/web/v35/source-mode.js)
- [apps/web/v35/source-mode.test.js](../../apps/web/v35/source-mode.test.js)
- [apps/web/vendor/hls.min.js](../../apps/web/vendor/hls.min.js)

الوثائق: REQUIREMENTS/PLAN/STATUS/COVERAGE/RESEARCH/CONTRACTS وهذا التقرير وproofs؛ المواصفة الأصلية لم تتغير. بصمة native بعد إدراج الملفات الجديدة فيgit: `2698148680d5dbcf734ae167`؛ البصمة السابقة `69a2052efac754d99b4273c8`.
