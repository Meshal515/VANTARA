# تسليم محرك الإضافات — 31 أكتوبر 2026

يُحدَّث مع كل دفعة. نقطة البداية لأي وكيل يكمل العمل؛ لا تكرر ما فيه.

## الفروع والحالة

| الفرع | ما فيه |
|---|---|
| `feat/addons-v7-native-manager-20261027` (Debug، PR #298) | آخر عمل Codex (PRs 302–305: تشغيل CloudStream المعزول، Witcher، Pixeldrain، فهرس ARB) ثم دفعة Claude حتى `35da6719` (نُشرت بأمر المالك 30 أكتوبر). |
| `claude/supernatural-addons` | عمل لاحق **غير منشور**: أقسام الكتالوج، مستخرجا ok.ru وMixdrop، حل Cloudflare الصامت لـCloudStream، فحص المانجا الحي، الفحوص التشخيصية. لا يُدفع إلى Debug إلا بأمر المالك. |
| `main` / Stable | لم يُمس. |

Codex لم يدفع شيئًا بعد 29 أكتوبر؛ عمله كله داخل Debug أعلاه. بواباته المفتوحة (docs/ADDONS_ACCEPTANCE_STATUS_20261028.md): التحقق اليدوي الحي، Team X (كتالوج Debug فارغ مقابل 218 فصلًا في Stable)، MangaSwat وأغلفتها، ترقية Stable.

## أدوات الإثبات الحي (CI على محاكي API35 بشبكة GitHub)

`runtime-live-sweep.yml` (تشغيل يدوي على الفرع):
- `LiveRepositorySweepTest`: كل إضافات مستودع CloudStream العربي (43): تثبيت ← كتالوج ← تفاصيل ← حلقات ← روابط. الكتالوج الفارغ يسجّل أقسام جواب المزوّد الخام.
- `MangaLiveSweepTest`: كل مصدر مانجا مضمّن + كل إضافة عربية من Keiyoushi غير مضمّنة: تحميل ← رائج/أحدث ← فصول ← صفحات ← **تنزيل أول صورة والتحقق أنها صورة**.
- `LiveExtractorProbeTest` (JVM): كل رابط سيرفر حقيقي في `tools/repository-compat/extractor-samples.txt` وما جمعه الفحص، ويطلب أول بايتات كل رابط؛ المستخرج الذي يفشل يُسجَّل سبب فشله.
- الأدلة: Artifact `live-repository-sweep` (live-sweep.jsonl، manga-sweep.jsonl، extractor-probe.txt) وجدول في ملخص التشغيل.

ما ليس دليلًا: نجاح البناء، اختبارات المحاكاة (fixtures)، استخراج رابط دون طلب بايتاته.

## المثبت حيًا

- ok.ru: كل الجودات (144–1080 + HLS) أعادت فيديو فعليًا (تشغيل 41128928632).
- DoodStream/playmogo: فيديو فعلي.
- أقسام الكتالوج: EgyWatch من «لا كتالوج» إلى 213 عملًا وروابط؛ Eshek من 0 إلى 30 وروابط.
- رحلات CloudStream كاملة حتى روابط تشغيل: Aflaam وAsia2tv 2 وAnimeRift وAnimeWitcher وDima toon وEgyWatch وEshek وTVgarden.

## معروف ومفتوح

- Mixdrop: يعمل محليًا ويفشل حيًا: الصفحة 200 من mxdrop.click والمستخرج يعيد false (الصفحة الحية تختلف عن نسختنا المحلية).
- عشرة مصادر CloudStream بكتالوج فارغ «ناجح»: الفحص صار يسجّل الجواب الخام.
- ثمانية مصادر CloudStream تقف عند Cloudflare: الحل الصامت مكتوب ولم يُثبت (يحتاج نافذة أمامية؛ المحاكي في الفحص بلا نشاط ظاهر).
- MangaRose: غير موجود في Keiyoushi (59 إضافة عربية فيه)؛ يحتاج مستودعًا آخر من المالك.
- مستخرجات ناقصة كثيرة الطلب: voe، vk، uqload، streamwish، savefiles، byse*، megamax، gofile (mp4upload وanafast وvidspeed أُضيفت بدليل حي).

## إصلاحات مثبتة بأدلة الفحص (31 أكتوبر)

| العطل | السبب الجذري | الإصلاح |
|---|---|---|
| إضافة تُسقط التطبيق كله (Manga Million) | إضافات Keiyoushi الحديثة تنادي `BuildersKt.runBlockingK` (من coroutines 1.11.0 فقط؛ التطبيق كان 1.8.1)، والخطأ في نداء OkHttp غير متزامن، و`UncaughtExceptionInterceptor` يمسك `Exception` فقط | coroutines 1.11.0 (يبقى `runBlocking` القديم)، والاعتراض يمسك `LinkageError` → فشل المصدر وحده. `UncaughtLinkageTest` |
| المدمجة مجمّدة على إصدار قديم | التحديث الرسمي يُطلب فقط إن فشل التحميل نفسه | تحديث ذاتي موثّق عند عطل يملكه كود الإضافة (`refreshBuiltin`)، مرة كل 6 ساعات |
| Dilar | الموقع صار ببروتوكول تشفير 17، وإصلاحنا (10–12) مفروض على كل إصدار | مسار الإضافة أولًا؛ **ما زال فاشلًا حتى بالإصدار الرسمي 1.6.20** |
| AsgardScans | روابط http ترفضها سياسة التطبيق | `HttpsUpgradeInterceptor` |
| كتالوج CloudStream فارغ/معطوب | القسم 0 وحده كان يُطلب | `SourceOperations.home` |

## مصفوفة المانجا (تشغيل 41162877481، PASS = صورة صفحة فعلية نزلت وتحقق أنها صورة)

الأولوية الأربع عشرة: Team X وAzora وMangalek وManga Link وMangaCloud وManga Starz وMangaLionz و3asq **PASS**.
MangaSwat وHijala: Cloudflare تفاعلي من شبكة المحاكي (يحتاج جهازًا حقيقيًا أو التحقق اليدوي). Dilar: بروتوكول 17.
MangaTime: JSON لا تفهمه الإضافة حتى بأحدث إصدار. MangaTek: 403 من الموقع. MangaRose: غير موجود في Keiyoushi.

PASS أيضًا: AriaToon وHizoManga وManga Tales وMangaSpark وMangaDex وMangaTik وMangaTuk وRocks Manga وYokai
وXSano وLava Scans وKawii وManga Ai Land وDespair وProComic وOduto وLoner وSayManhwa وNamiComi وXCOMIC وYSK
وGlobalComix وDragon Ball Multiverse وThe Library of Ohara، والإنجليزية Weeb Central وAsura وMangaFire وMangakakalot.

مفتوح: Mangahere (NPE داخل QuickJS عند الصفحات)، Manga Million (`NoClassDefFoundError q1` بعد ترقية coroutines)،
EShadow/Orca/MangaDot (أعمال بلا فصول — الفحص صار يجرب ثلاثة أعمال)، Manhatok/Niji (فصل بلا صفحات — يجرب ثلاثة فصول)،
Mangalek/Link/Lionz/Spark/Starz (عائلة موقع واحد: الفصل الأحدث بصفحتين — الفحص يعدّ صفحات فصول أخرى).

## الأنمي (CloudStream) — المعيار: تشغيل فعلي لا رابط

روابط مستخرجة: AnimeRift (9) وAnime4up (10) وAnimeWitcher (3) وDima toon (1). الفحص صار يتحقق من تشغيل كل رابط
(بايتات فيديو أو أول مقطع HLS). Cloudflare: Anime3rb وAnime-Phoenix (تبتلعه الإضافة فيظهر NO_CATALOGUE) وWitanime
وAnimerco. أقسام بصفر عناصر: Brstej وMycima وYouTube وEgydead (سجل VantaraRuntimeHttp يحسم السبب).

## أحكام بالدليل (تشغيل 41168900235)

- **التشغيل الفعلي** (بايتات فيديو أو أول مقطع HLS): AnimeRift 6/6، AnimeWitcher 3/3، Anime4up 4/7 (mp4upload
  وMixdrop المضافان يعملان داخل التطبيق)، Dima toon، Aflaam، Asia2tv (ok.ru 144–1080)، EgyWatch، Eshek، TVgarden.
- مقاطع acek-cdn ترد 403 حتى مع Origin: فرضية Origin مرفوضة؛ قيد من الخادم (رمز أو عنوان).
- Mixdrop: يعمل في مسار التطبيق؛ فشله في LiveExtractorProbeTest كان لأن الفحص يرسل UA «okhttp» (أُصلح).
- أقسام بلا عناصر — **الإضافة متقادمة لا المحرك**: Alooytv تطلب fitnur.com/alooytv وصارت صفحة اختصار روابط؛
  Brstej تبحث عن `div.caption h3 a` والموقع (200، عشرون عملًا بـ`pm-video-thumb`) غيّر تصميمه. لا إصلاح دون كود
  خاص بالموقع (مرفوض بقرار المالك)؛ يحتاج تحديثًا من ناشر الإضافة.
- Dilar الرسمي 1.6.20: PASS حتى صورة (126 فصلًا، 36 صفحة). AsgardScans: PASS بعد ترقية التحويلات.

## فصل المدمجة في Debug (31 أكتوبر، بأمر المالك)

- نسخ المانجا المدمجة نُقلت كما هي إلى بناء Stable وحده (`android/app/src/release/assets/extensions/`)؛ Debug بلا أي نسخة.
- Debug يحمّل المدمجة كأي إضافة بالمعرّفات نفسها: مخزن الجهاز ← الرابط المثبّت بالبصمة ← آخر سليم ← Keiyoushi الرسمي بمفتاحه المثبّت.
- الظاهر للحساب بلا نسخة على الجهاز يُجهَّز في الخلفية عند تبليغ الواجهة (`stageVisible`).
- التفاصيل وبوابات القبول: `docs/repository-compat/BUNDLED_SOURCE_SEPARATION.md`. فحص المانجا الحي صار يمر بالسلسلة نفسها حين تغيب النسخة.

## تدقيق عقد المضيف وأحكام بالدليل (31 أكتوبر)

- `tools/repository-compat/host_abi_audit.py <VANTARA.apk> <ext.apk>...`: كل صنف ودالة وحقل تطلبه إضافة Mihon يُطابَق
  بما داخل APK التطبيق نفسه. على Debug 0.0.2348 و70 إضافة (كل عربي Keiyoushi والمدمجة): **نقص واحد فقط**،
  `tachiyomi.decoder.ImageDecoder` لـProComic (يمر بالفحص الحي دونه). أعطال الربط وقت التشغيل تُكشف الآن قبل الجهاز.
- Manga Million (`NoClassDefFoundError q1`): التدقيق لا يجد نقصًا في العقد، و`q1` صنف المصدر نفسه داخل الإضافة.
  العطل وقت التشغيل لا في الربط؛ فحص المانجا صار يسجّل سلسلة الأسباب (`trace`) لأعطال المحرك ليُحسم.
- Mangahere (NPE عند الصفحات): **الإضافة متقادمة**. الموقع الحي صار يترك `.pager-list-left` فارغًا ولا `data-page`
  (يملؤه JavaScript)، والإضافة تفترض `selectFirst(".pager-list-left > span")!!`؛ QuickJS سليم.
