# خطة تنفيذ VANTARA Addon Fabric

> للتنفيذ: تُستخدم مهارة `superpowers:executing-plans` للتنفيذ المتسلسل، أو `superpowers:subagent-driven-development` إذا اختار المالك التنفيذ بالوكلاء. كل مرحلة تُراجع وتختبر قبل التي تليها. هذه الخطة تحتاج مراجعة المالك قبل كتابة نظام الإضافات.

**الهدف:** إضافات URL حقيقية للمانجا والأنمي والسينما والترجمة، بواجهة فانتارا وعقود معزولة، مع إصلاح أعطال PWA المثبتة.

**المعمارية:** مدير مشترك للهوية والmanifest والتثبيت والصحة، مع adapters/runtime منفصلة. المصادر الأصلية تستمر بمساراتها الحالية؛ native APK يطلب البيانات ويشغلها عبر Kotlin/OkHttp/Media3، وPWA عبر browser/جالب الويب عند الحاجة. يجمع الفيديو نتائج مستقلة تدريجيًا؛ الترجمة تبدأ بعد اختيار الفيديو ولا تدخل شرط جاهزيته.

**التقنيات:** ES modules وIndexedDB الحالي وVitest، Kotlin/OkHttp/Media3 الحالي، HTTP JSON وفق Stremio. لا framework واجهة جديد أو bundler جديد.

**المواصفة:** [SPEC.md](SPEC.md)، [REQUIREMENTS.md](REQUIREMENTS.md)، وتعديلات المالك في المحادثة. [RESEARCH.md](RESEARCH.md) يحفظ أدلة البروتوكول والمشغّل.

## القيود العامة

- تصميم CSS الحالي محفوظ؛ مدخل إضافات واحد ثابت وSVG قطعة أحجية. لا sidebar مصادر جديد يتبدل حسب القسم.
- لا حسابات/مكتبة/تقدم/schema جديدة، لا حذف Aniyomi، لا تغيير قارئ المانجا المستقر خارج adapter boundary.
- لا autoplay عند Ready، ولا تغيير اختيار server/quality بسبب provider.
- لا arbitrary JS/HTML، لا CAPTCHA bypass، لا تشغيل تورنت أو streaming server محلي مزيف.
- APK وPWA متفقان وظيفيًا؛ runtime الأصلي يبقى أصليًا.
- default unknown metadata = null؛ Ready يتطلب stream صالحًا؛ نتيجة provider ليست دليل تشغيل فيديو.
- لا merge/deploy دون «ادمج» جديدة لهذه المرحلة. الموافقة السابقة استُخدمت في PR #142.

## نقاط المراجعة الأهم

1. URL إعداد يحتوي token في path/query: لا يظهر raw في بطاقة/سجل/PR أو خطأ.
2. إضافة تعلن نفسها رسمية أو تعيد localhost/عنوانًا خاصًا أو redirect إلى عائلة أخرى: تُرفض دون توسيع ثقة المصادر.
3. نتيجتا حلقة متساويتان في الاسم من موسمين أو Part مختلفين: لا تُدمجان ولا تستعمل ترجمة أحدهما للأخرى.
4. إلغاء session/تبديل السيرفر أثناء طلب subtitle أو resolver: لا callbacks متأخرة ولا tracks متسربة.
5. تحديث adapter خلال مشاهدة/قراءة فعالة وفشل النسخة الجديدة: الجلسة تستمر على snapshot القديم وcore يعمل.

تغطية هذه الحالات مذكورة في مهام T1/T2/T5/T6/T7/T8، وليس ادعاءً أنها اختُبرت بالفعل.

## قرارات حدود التنفيذ

- نبدأ باختبار وإصلاح PWA playback ثم foundation؛ لا نخلط PR إصلاح مثبت مع كل مشروع الإضافات.
- Stremio endpoints القياسية CORS-compatible تُطلب مباشرة بـ`credentials: omit`؛ headers/identity فانتارا لا تُرسل إليها. لا generic proxy جديد في مرحلة الأساس. CORS غير المتوافق يصنف Partial/Unsupported بوضوح. طلب proxy محدود لاحقًا يحتاج اختبارات DNS والredirect والحجم وموافقة نطاق منفصلة عند الضرورة.
- registry الرسمي الأول يعرض built-in الموجود، وOpenSubtitles v3 كـ**متاح للتثبيت** بعد التحقق الحي، لا enabled تلقائيًا. روابط المجتمع يضيفها المستخدم يدويًا.
- manga APKs لا تصبح PWA addons. دعم remote manga API يُعلن عندما تتطابق manifest والعقود المطلوبة فعلًا؛ المصدر المدمج الحالي مثال حقيقي أول للـadapter.
- مواصفة Remote VANTARA v1: manifest وفق AF-03، `baseUrl` HTTPS من نفس الأصل، `resources` map محدود باسم capability إلى path template. يسمح placeholders محددة `workId/chapterId/page/query`، طلب GET JSON فقط في v1، دون cookies/headers سرية. results تتبع أشكال `pwa/sources/contract.js` للمانجا وstreams/episodes الموثقة في `CONTRACTS.md` عند T1. القدرات غير المدعومة تبقى ظاهرة كغير مدعومة. لا parser JS يأتي من URL.
- قيم الحراسة المقترحة: manifest ≤256KiB، resource JSON/ملف ترجمة ≤2MiB، 1000 عنصر في response، timeout 15s للmanifest والsubtitle، 30s للcatalog/metadata، 45s كحد أقصى لجلسة resolver كاملة مع progressive publishing، وليس حاجزًا لأول Ready.
- scheduler: ≤6 طلبات فعالة للمهمة، ≤3 لكل أصل؛ يبدأ 3 providers، يوسع بعد 250/700/1500ms حسب الصحة والملاءمة. إلغاء Session يلغي الطلبات الفعلية، وليس callback فقط.
- circuit breaker بعد 3 إخفاقات للقدرة نفسها: 30s ثم 2m ثم 10m، half-open probe واحد؛ retry يدوي يتجاوز cooldown. النتائج الفارغة الصحيحة لبحث/ترجمة لا تساوي source crash؛ صفر streams ليس playback success.
- cache مقترح: manifest/logo 24h، catalog/home 15m، search 5m، metadata 24h، chapters/episodes 5m، subtitle listing 15m، ملف الترجمة 24h؛ stream/LKG يلتزم أقصر expiry مثبت. verification لا يخزن في cache المحتوى ولا يخرج من runtime المصدر.

---

## T0 — إثبات وإصلاح مشاكل PWA الحالية قبل الإضافات

**الملفات:** `apps/web/pwa/player/player.js`، `apps/web/pwa/player/player.test.js`، `apps/web/pwa/bridges/anime.js` وtests المقابلة؛ extractor واحد فقط إذا أثبتت الحالة سببًا فيه. أدوات التشخيص تحت `tools/pwa/` عند حاجة فعلية.

**مدخلات:** The Mentalist IMDb `tt1196946` الموسم1 الحلقة1، Slow Horses موسم1 حلقة1، Re:Zero والعمل المعروف من بلاغ المالك؛ مسارات Akwam/EgyDead المعروفة.

**ناتج:** root-cause report مستقل وحل أقل مساحة للحالات التي تقع داخل VANTARA. لا توسيع allowlist دون host مثبت.

- [ ] إعادة اختبار search→الموسم الصحيح→الحلقة→servers→stream→master/variant/segment→frame، مباشرًا وعبر جالب الإنتاج، مع إخفاء الروابط الموقعة.
- [ ] اختبار fixture HLS H.264/AAC حقيقية في Chromium يعلن native `maybe`، وSafari-compatible native fallback. لا يكفي أن master يُقرأ.
- [ ] عند إثبات transport failure: اختبار أحمر قبل التعديل؛ تفضيل `Hls.isSupported()` حيث يلزم مع fallback الأصلي دون كسر Safari أو MP4.
- [ ] اختبار جودة StreamHG: `#EXT-X-STREAM-INF` يعلن 480/720/1080، تظهر الجودات الثلاث دون fake 4K؛ 2160 حقيقية تبقى 2160 ولا تنزل إلى bucket1080.
- [ ] اختبار frame/seek/failover بعد الإصلاح، ثم baselines Akwam/EgyDead وبقاء اختيار المستخدم وعدم autoplay.
- [ ] تسجيل TTFR ووقت اكتمال الباقي وhost/سبب/family إن توفرت؛ عدم الادعاء أن شبكة المستخدم اختُبرت من CI.
- [ ] commit وPR إصلاح عربي منفصل، قبل دمج الإضافات.

## T1 — العقود والهوية والتحقق من Manifest

**إنشاء:** `apps/web/addons/contracts.js`، `manifest.js`، `identity.js` واختبارات كل منها؛ `docs/addons/CONTRACTS.md`.

**واجهات:** `validateManifest(raw,{origin,productVersion}) → {manifest,compatibility,errors}`؛ `normalizeWork(raw,{addonKey,type}) → {canonicalId,externalIds,sourceCopies,kind,season,part}`؛ `chapterIdentity({canonicalMangaId,sourceId,sourceWorkId,chapterId,number,volume,memo}) → string`.

`addonKey` من origin + manifest id، وURL إعداد يُحفظ سرًا في storage لا يدخل canonicalId أو السجل. movie/series/anime/manga namespaces مستقلة. لا canonicalId مشترك دون external IDs مؤكدة من نفس النوع؛ هوية provider-local مستقرة عندما لا توجد mapping مثبتة.

- [ ] اختبارات أحمر: manifest malformed/unknown protocol/minVersion/spoofed official/JS URL/malformed permission، ومنع title-only merge والموسم/Part/movie-vs-TV وchapter-1 المختلف.
- [ ] توثيق عقود home/search/details/chapters/pages/episodes/streams/subtitles وحقول metadata وexpiry وsource/addon origin.
- [ ] تنفيذ pure validation/normalization فقط، مع `null` للmetadata المجهولة ولا صلاحية غير معلنة.
- [ ] تشغيل `node node_modules/vitest/vitest.mjs run apps/web/addons` وreader chapter-cache tests، ثم commit عربي.

## T2 — Registry والصحة وطلب Remote معزول

**إنشاء:** `apps/web/addons/registry.js`، `transport.js`، `health.js`، `scheduler.js`، `cache.js` واختبارات مقابلة. استخدام store الحالي دون version/schema migration.

**واجهات:** `createAddonRegistry({store,transport,clock,coreAdapters}).list(filter)`؛ `.inspect(url,{signal})` ثم `.install(preview)`؛ `.enable(key,value)`، `.remove(key)`، `.stage(key)`، `.activateStaged(key)`، `.rollback(key)`، `.snapshot()`؛ `request(addon,capability,input,{signal,sessionId})`؛ `runProgressive(jobs,{signal,onResult})`.

التثبيت يحفظ installed/staged/previous manifest وتوقيته وpermissions، enable منفصل عن health، snapshot session يمنع hot swap. health scope `addonKey|capability|runtime` مستقل عن المصدر الآخر. المصدر المدمج لا يُحذف من core بواسطة removal خارجي.

- [ ] أحمر: private/IP/credentials URL، origin redirect escape، response oversized، cross-addon storage/cookies، credential redaction، rate limit، retry/cooldown، late callback، إلغاء فعلي، 100 إضافات لا تساوي 100 طلب فورًا.
- [ ] تنفيذ النقل GET JSON المحدود، `credentials:omit` وbounded body parsing، دون global fetcher allowlist تغيير أو iframe/eval.
- [ ] تنفيذ registry + staged session snapshot + capability health + TTL وفق القيم في هذه الخطة.
- [ ] أحمر/أخضر: core يعمل مع all-addon failure؛ manifest fetch ناجح لا يجعل playback health ناجحًا؛ rollback فقط عند وجود compatible previous version.
- [ ] اختبار module suite وsafety، commit عربي.

## T3 — صفحة إضافات واحدة ثابتة داخل التصميم الموجود

**إنشاء:** `apps/web/v35/addons-view.js` واختباره. **تعديل محدود:** `v35/icons.js`، `v35/shell.js`، و`v35/markup.js` عند حاجة route مستقل. لا تعديل core.css/wide.css/global layout.

**واجهات:** `renderAddons({registry,filter,onOpenSource,onBack}) → HTMLElement`؛ `renderAddonDetails({addon,registry,onOpenSource})`. actions install/enable/remove/retry/stage تتصل بregistry؛ لا HTML خارجي.

- [ ] أحمر: مدخل «الإضافات» SVG puzzle يبقى نفسه في manga/anime/cinema؛ الفلتر الداخلي لا يبدل قسم التطبيق؛ narrow/wide كلاهما قابل للوصول.
- [ ] بناء الصفحة باستخدام page-body، chips، sheet، buttons، card classes الموجودة. تفاصيل الصلاحيات ومعاينة URL قبل install.
- [ ] render حالات empty/disabled/challenge/update/partial صادقة؛ أسماء وألوان المصدر آمنة عبر textContent؛ secrets URLs لا تعرض.
- [ ] اختبارات Back، disable/remove، pin order، install cancel، ولقطات screenshot RTL جوال وdesktop قبل/بعد للمراجعة دون إعادة تصميم.
- [ ] targeted tests + safety + commit عربي.

## T4 — Source Mode لكل الأقسام مع الحفاظ على المصادر الحالية

**إنشاء:** `apps/web/addons/adapters/bundled.js`، `adapters/remote.js`، `apps/web/v35/source-mode.js` واختباراتها. **تعديل boundary فقط:** `lib/extension-engine.js`، `lib/anime-engine.js`، `pwa/bridges/manga.js`، `pwa/bridges/anime.js`، `v35/shell.js`.

**واجهات:** `createBundledAdapter({sourceDef,engine})` و`createRemoteAdapter({manifest,transport})` يعيدان capability methods المعلنة في CONTRACTS؛ `openSource({addonKey,sourceId,content,tab,filter,scroll})` يفتح الصفحة نفسها، و`onOpenWork` يمرر Source Copy إلى صفحة العمل الحالية.

- [ ] أحمر: source search لا يسأل مصدرًا آخر؛ Madara chapter memo يعمل مع قارئ فانتارا؛ Back يعود لنفس source/tab/filter/scroll؛ لا iframe ولا library duplicate عند external IDs نفسها.
- [ ] ربط مصدر مانجا موجود أولًا عبر adapter facade، دون تغيير parser أو chapter caching؛ ثم anime/cinema الموجودان بنفس boundary مع عدم تحويل الكل دفعة واحدة.
- [ ] home/latest/popular/genre بحسب capability فقط؛ logo وفق manifest أو same-origin؛ unsupported native APK في PWA سبب واضح.
- [ ] Source Mode الفيديو source-first و«عرض جميع المصادر» لا يفتح player تلقائيًا. لا second sidebar.
- [ ] اختبار MangaReader الحقيقي بتتابع الأعمال السابق، source listing، narrow/wide screenshots وbaseline tests، commit عربي.

## T5 — Stremio والنتائج العامة والسيرفرات والجودات

**إنشاء:** `apps/web/addons/adapters/stremio.js`، `streams.js` واختباراتها. **تعديل محدود:** video bridge/identity boundaries الحالية وربط Source Copies من T4.

**واجهات:** `createStremioAdapter({manifest,manifestUrl,transport}).catalog({type,id,extra,signal})`، `.meta({type,id,signal})`، `.streams({type,videoId,signal,onResult})`، `.subtitles({type,videoId,extra,signal})`؛ `normalizeStreams(raw,{addonKey,workIdentity})` يحفظ subtitles/headers/quality/expiry ويصنف unsupported protocols.

- [ ] أحمر: resources object وtypes/idPrefixes، encoded config URL وextraArgs، movie ID مقابل series `tt:season:episode`، custom addon IDs غير قابلة للدمج بالعنوان، torrent/localhost/externalUrl ليست Ready.
- [ ] mapping الأنمي إلى IMDb لا يأتي من التخمين؛ يستخدم explicit mapping فقط، وإلا يستعمل namespace تدعمه الإضافة أو يبقى unsupported.
- [ ] ربط scheduler/session pipeline الحالية بالنتائج progressive؛ slow backup وprovider crash لا يمنعان Ready ولا autoplay.
- [ ] quality normalization تبقي 4K/1440/1080/HDR المعلنة أو المثبتة؛ معلومات غير مثبتة null. recommendation لا تغيّر user choice.
- [ ] live public addon + permitted demo stream لاختبار install→catalog→meta→video ID→frame؛ اختبار الموسم الخاطئ وتاريخ expiry.
- [ ] targeted + baseline source tests، commit عربي.

## T6 — ترجمة PWA حقيقية دون تعطيل الفيديو

**إنشاء:** `apps/web/addons/subtitles.js`، `apps/web/pwa/player/subtitles.js` واختباراتها. **تعديل:** candidate construction في `pwa/bridges/anime.js`، `pwa/player/player.js`؛ إضافة `/vendor/hls.min.js` full **1.6.15** بنفس الرخصة واستدعائه عند HLS فقط، وتحديث precache digest في T8.

**واجهات:** `discoverSubtitles({identity,stream,providers,signal,onResult})`؛ `createSubtitleSession({video,getHls,registry,identity,onChange}).setStream(candidate)`، `.tracks()`، `.select(id|null)`، `.close()`؛ نتيجته track `{id,kind:'source'|'addon',lang,label,provider,url,match}`. hard sub ليس track أصلًا.

- [ ] أحمر: no track/no provider لا UI وهمي؛ source العربية فقط تظهر وتعمل؛ hardcoded-only لا Track؛ provider failure لا video failure؛ نتيجة متأخرة بعد switch لا تتسرب.
- [ ] نقل candidate.subtitles وembedded HLS tracks، addtrack/removetrack/change وHls subtitle events، lifecycle generation وAbortSignal.
- [ ] إظهار «الترجمة» داخل المزيد فقط عندما توجد source tracks أو provider فعلي enabled/healthy. ورقة واحدة: إيقاف، من الفيديو، من الإضافات. عند empty finite completion رسالة «لا توجد ترجمة منفصلة لهذا الفيديو» دون spinner دائم.
- [ ] تحميل SRT/VTT المحدود وتحويل SRT إلى WebVTT عبر parser يحفظ التوقيت والنص الآمن؛ عرض text tracks لا HTML من الملف. ASS styling غير مدعوم في v1 ويصنف بصدق.
- [ ] provider requests تبدأ بعد اختيار candidate بالتوازي؛ النتائج لا تدخل await playback؛ source Arabic preferred، addon exact فقط آليًا إذا ثبت ولم يحدد المستخدم off/track.
- [ ] switch/seek/close تنظيف Blob URLs وtracks/listeners؛ إعادة المطابقة إذا duration/release تغير. لا subtitle editor أو positioning أو AI.
- [ ] live OpenSubtitles لـ`tt1196946:1:1` ثم اختيار ملف عربي في المشغل الفعلي، وcontrolled source VTT/HLS soft captions؛ APK parity في T7.
- [ ] tests + screenshots للمزيد والورقة مع CSS نفسه، commit عربي.

## T7 — تكامل APK المحافظ عبر مساره الأصلي

**إنشاء:** `android/app/src/main/kotlin/com/vantara/addons/RemoteAddonClient.kt`، `AddonEnginePlugin.kt`، `SubtitleProviders.kt` واختبارات Kotlin المقابلة. **تعديل boundary:** تسجيل Capacitor plugin؛ native candidate routing/bridge؛ `anime/player/PlayerActivity.kt` و`stream/Streams.kt` فقط لmetadata الضرورية.

**واجهات:** `RemoteAddonClient.request(addon,capability,input,requestId)` و`cancel(requestId)` يستخدمان client native وpermissions نفسه؛ `SubtitleProviders.discover(context,onResult)` بعد اختيار candidate؛ أحداث `addonSubtitleResult` تحمل session/candidate/generation وtrack metadata دون secrets؛ native `selectAddonSubtitle(track)` يربط الاختيار بـMedia3.

- [ ] أحمر: Native core/Aniyomi لا يمرّان عبر remote JS؛ Native requests تحفظ DNS/DoH والrace الموجودة؛ provider timeout/cancellation لا يغير player source.
- [ ] الاستفادة من TrackRef وMediaItem.SubtitleConfiguration الموجودين. إضافة النتائج إلى قائمة الترجمة لا تعيد prepare؛ عند اختيار external track فقط يُحدّث MediaItem بـposition/playWhenReady محفوظين، مع اختبار Media3 الحقيقي للcontinuity. لا restart على كل نتيجة.
- [ ] sheet الحالية تستخدم زر الترجمة نفسه وتفصل source عن addon؛ إصلاح نص no-soft-track دون الادعاء بhard sub. headers/cookies الفيديو لا تُرسل لsubtitle host.
- [ ] مصدر عربي soft أولًا؛ لا external default دون exact proof؛ switch يمسح source groups وgeneration القديمة ويفحص addon release compatibility.
- [ ] source track/off/hard-only/provider failure/late result/paused state/seek native tests، ثم `:app:testDebugUnitTest :app:assembleDebug`.
- [ ] اختبار APK على جهاز حقيقي قبل القول إن parity التشغيل مثبتة. النجاح المحلي/CI يوصف بدقته؛ commit عربي.

## T8 — الرجوع والنسخ والنشر والتغطية النهائية

**تعديل:** SW precache وSHELL_DIGEST، release notes، docs/addons/STATUS.md وCOVERAGE.md؛ workflow فقط إذا احتاج diagnostic حقيقي محدود ومختبر.

- [ ] root-cause source report قبل/بعد: search/season/episode/server/host/resolver/status/quality/count/latency/first Ready/all/choice/no-autoplay، وفصل removed/challenge/codec/transport.
- [ ] 100-addon scheduler、staged update في session قائمة، core بلا addons، source-mode back stack، no title merge، manga chapter isolation.
- [ ] suite Vitest كاملة، repository safety، typecheck/lint/build المناسبة، Kotlin checks عند native diff.
- [ ] المتصفح الحقيقي: install manifest، source mode، catalog/stream/frame، مصدر soft subtitle، إضافة subtitle حقيقية، switch cleanup، update من PWA السابق وما الجديد/offline/shell consistency.
- [ ] reviewer مستقل للحدود الأمنية والهوية والno-autoplay والCSS؛ تقرير شامل وحدود ما لم يُختبر.
- [ ] PRs صغيرة حسب المراحل. الدمج والنشر بعد أمر المالك، ثم التحقق من commit الإنتاج والملفات/البصمة/build/manifest، لا الاكتفاء بخروج CI.

## أمر الاختبارات المشترك

`node node_modules/vitest/vitest.mjs run`، `node --test tools/repository-safety.test.mjs`، وفحوص Kotlin عبر Gradle عند تغيّر native. اختبارات المتصفح fixtures تنفصل عن proof المواقع الحية؛ أسرار هوية CI لا تدخل stdout أو fixture commit.

## حدود اكتمال العمل

لا تعتبر المراحل كاملة بمجرد إنشاء ملفات adapters. كل مرحلة لها usable path واختبار حقيقي؛ ST-10 يمنع ادعاء ربط ترجمة قبل ظهورها في player. دعم كل قسم يعني عقود ومسارات حقيقية له، ولا يعني دعم كل إضافة من أي runtime أو ضمان 4K غير موجودة عند upstream.


## حصيلة التنفيذ قبل المراجعة

المهام نُفذت متصلة بعد «ابدأ»، مع commits foundation ثم integration. بنود الاختبار الحي عبر edge، APK على جهاز، وparity/seek/failover كاملة لم تُعلَّم ناجحة. checklist الأصلية تبقى مرجع قبول تفصيلي؛ التغطية الفعلية لا تُستنتج من إنشاء الملف، بل من COVERAGE والتقرير. لا PR دمج أو نشر حتى أمر المالك الجديد.

انحرافات الترتيب والحدود التشغيلية مسجلة في IMPLEMENTATION-REPORT تحت «قرارات التنفيذ وكلفتها». نطاق v1 لا يساوي اكتمال marketplace/genre/search aggregation/configuration schema الشاملة.
