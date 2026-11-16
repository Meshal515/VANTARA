# تسليم: نظام اعتماد المصادر وأنماط صفحة المانجا — 5 نوفمبر 2026

نقطة البداية للجلسة التالية. الفرع: `claude/supernatural-addons` (فيه آخر Debug `e925b8e4` مدموجًا). لا نشر ولا دمج في main/Debug/Stable دون أمر المالك.

## ما طلبه المالك (بالترتيب)

1. **المحرك أولًا، ثم التصاميم.** كل مصدر يشتغل خارج VANTARA (CloudStream وAniyomi وMihon وStremio) يشتغل داخله: أنمي (AnimeWitcher، AnimeRift، WitAnime، Okanime «انمي اوك»، Anime4up…) وسينما.
2. **نظام اعتماد لكل مصدر:** 30 عملًا موجودة فعلًا في المصدر (10 مشهورة، 10 متوسطة، 10 نادرة). المصدر يُفضَّل أن يكون عنده أكثر من سيرفر (احتياط).
3. **«جاهز» = يشتغل.** لا سيرفر يظهر جاهزًا ثم يقول «حدث خطأ».
4. **الهدف:** صورة وإطارات، بلا سقوط إطارات في كل الإضافات. السقوط على المحاكي (فك برمجي) يُسجَّل ولا يُعتمد؛ السلاسة تُعتمد على جهاز فعلي.
5. بعد المحرك: هرمية ومحاذاة أنماط صفحة المانجا (قال إنها سيئة)، ثم أنماط السينما الأربعة (بنر بحجم ثابت).

## نظام الاعتماد (مبني، لم يُخرج نتيجة بعد)

- الفحص: `extensions/runtime-android/integration/src/androidTest/kotlin/com/vantara/runtime/SourceCertificationTest.kt`
  تثبيت بمسار التطبيق (CloudStream عبر `RuntimeHost`، Aniyomi عبر `AnimeEnginePlugin.installExtension`) ← تصفح الكتالوج (الرائج والأحدث، حتى 12 صفحة) ← طبقات الشهرة (AniList للأنمي: ≥100k مشهور، 15k–100k متوسط، أقل نادر؛ السينما بموضع العمل في قوائم المصدر) ← لكل عمل: تفاصيل/مواسم/حلقات ← `engine.prepare(probe=true)` ← يفتح حتى 3 سيرفرات جاهزة في `PlayerActivity` الأصلي: أول إطار، تقدّم الوقت، مفكوك/ساقط، خطأ، أو انتقال المشغّل لسيرفر آخر = `FALSE_READY`.
  سطور JSON بوسم `VANTARA_CERT` (سطر لكل عمل وسطر ملخص لكل مصدر).
- السير: `.github/workflows/source-certification.yml` — يبدأ **بالدفع** بعد تعديل `tools/repository-compat/certification-sources.txt` (سير جديد لا يُستدعى يدويًا قبل وجوده في main). سطر لكل مصدر `kind:name:content`، والإعدادات في `# set per_tier=… servers=… seconds=…`. مصدر لكل محاكي بالتوازي (حتى 20).
- **حصة ملفات Actions ممتلئة:** لا رفع artifacts. كل وظيفة تبني لنفسها؛ النتائج في ملخص الوظيفة وفي السجل بسطور `VANTARA_CERT_LINE` (اجمعها بـ get_job_logs).
- الجدول: `tools/repository-compat/summarize_certification.mjs` (+ اختباره). الحكم: معتمد / يعمل جزئيًا / لا يعتمد / جاهز يكذب.
- المشغّل: `run_source_certification.sh`.

### ما حدث في الجولات

| الجولة | النتيجة |
|---|---|
| 1–2 | المحاكي لم يقلع (قرص المشغّل ممتلئ بعد Gradle) → أُضيف `prepare_emulator_disk.sh` و`disk-size: 6G` كبوابات Debug |
| 3 | المحاكي أقلع (WitAnime)، والفحص رُفض: «Method certifySource() should be void» → أُضيف `Unit` في نهايته. وAnimeRift: تعثّر تنزيل NDK → ثلاث محاولات للبناء |
| 4 | دُفعت على `188a35c9` (AnimeRift وwitanime، عملان لكل طبقة). **افحص نتيجتها أولًا.** |

إن نجحت الجولة 4: وسّع القائمة (القائمة الكاملة المقترحة في تعليق رأس `source-certification.yml` سابقًا: 7 أنمي CloudStream، 8 Aniyomi عربي، 5 سينما) بـ `per_tier=10`، ثم ابدأ إصلاح أعطال المحرك نفسه (لا الإضافة المتقادمة؛ تلك تُذكر للمالك).

## مصادر للعلم

- CloudStream العربي (Abodabodd re-3arabi): 44 إضافة. أنمي: Anime3rb، Anime-Phoenix، Anime4up، Animerco، AnimeRift، AnimeWitcher، Brstej، Dima toon، Witanime، Elif، TuniflexBlog، Carateen. والباقي سينما.
- Aniyomi العربي (yuzono): anime4up، animeblkom، animeiat، animelek، animerco، arabanime، arabseed، asia2tv، cimaleek، egydead، faselhd، okanime، tuktukcinema، witanime.
- فحوص قديمة صارت تقبل خيارات: `video-repository-live-qa.yml` و`video-cinema-live-qa.yml` (only/limit) و`aniyomi-real-qa.yml` (packages). تحتاج خطوات القرص نفسها قبل أن تعمل.

## تغييرات أخرى على الفرع (غير منشورة)

- أنماط صفحة المانجا (`#detail[data-look]`): الأساسي، «تابع القراءة»، «المجلّد»، «الغلاف الكامل»، «المصادر» — في `appearance.js` (`MANGA_STYLES`) و`shell.js` و`markup.js` و`manga.css`. أزرارها مجرّبة؛ المالك طلب ضبط الهرمية والمحاذاة. لم يُضف صف إعداد «نمط صفحة المانجا» في المظهر بعد.
- ورقة السيرفرات: سبب عدم التوفر يظهر في سطر السيرفر نفسه تحت «غير متاح الآن».
- مختبر صور صفحة العمل (محرك مصادر وهمي في المتصفح) في مجلد الجلسة المؤقت فقط، غير محفوظ في المستودع.

---

# السياق الكامل للجلسة الجديدة (اقرأه كله قبل أي عمل)

## رؤية VANTARA باختصار

- تطبيق ترفيهي **عربي** للمانجا والمانهوا والأنمي والأفلام والمسلسلات، بمكتبة شخصية وتجربة خاصة للأصدقاء (مشاهدة/قراءة معًا، توصيات، «المجلس»، «الرفيق»). ليس شبكة اجتماعية عامة.
- **المحتوى من الإضافات، والتشغيل والتنظيم والتجربة من VANTARA.** المستخدم يختار مستودعاته وإضافاته: CloudStream (أنمي/سينما)، Aniyomi (فيديو)، Mihon/Keiyoushi (مانجا)، Stremio (Torrentio وغيرها، تورنت على الجهاز).
- المنصات: Android (Capacitor/Kotlin، Media3، libtorrent)، Windows (Electron، mpv، rqbit)، PWA (قيود مصادر وتورنت).
- مجاني للمستخدم، والفيديو يُشغَّل على جهازه لا من خوادم المشروع. الاستضافة المستقلة: كل صاحب مساحة بحساب Cloudflare خاص به (Worker + D1).
- المراجع: `docs/PRODUCT_VISION.md`، `docs/ARCHITECTURE.md`، `docs/FEATURE_STATUS.md`، `docs/SOURCES_TRANSITION.md`، `docs/VANTARA_DATA_OWNERSHIP.md`، `CLAUDE.md`.

## قواعد المالك الثابتة (لا تُكسر)

- **تكلّم عربي دائمًا**، بلهجة واضحة مباشرة. أسماء الملفات والأوامر تبقى كما هي.
- لا دمج في main ولا نشر (Debug أو Stable أو ويب) إلا بأمر صريح منه. «انشر» = دفع سريع (fast-forward) إلى فرع Debug `feat/addons-v7-native-manager-20261027` فتنشر بوابة `android-debug.yml` قناة `debug-channel`.
- لا تلمس Stable/main، ولا محرك التورنت والمشغّل والترجمة والتوقيع إلا بطلب. لا تجعل المستودع خاصًا. لا تطبع أسرارًا.
- لا ادعاء نجاح دون دليل مناسب. نجاح البناء أو CI لا يثبت تشغيل الفيديو أو المصادر على جهاز حقيقي. «يشتغل» = صورة وإطارات في المشغّل الأصلي.
- لا أكواد خاصة بموقع بعينه (لا hardcoding لمصدر). الإضافة المتقادمة تُذكر للمالك ولا تُرقَّع.
- احفظ بيانات المستخدم ومكتبته وتقدّمه ومعرّفات مصادره في كل تغيير. الحذف الكبير يحتاج موافقة.
- لا تعيد تغييرات غيرك (جلسات Codex/Man/Ngm تعمل على Debug بالتوازي؛ ادمج أحدثها قبل العمل).
- المالك يكره: «AI slop»، الإبهار الفارغ، التكرار الغبي للمعلومة، الأزرار الضائعة، كلمة «الفهرس»، التصاميم على لوحة منفصلة (صمّم على الصفحات الحقيقية). يريد تجربة مستخدم محترفة وفخمة بحس VANTARA، لا استعراضًا.
- المالك يتابع من الجوال: أرسل لقطات حقيقية إطارًا إطارًا قبل أي ادعاء، وانتظر رأيه في التصميم قبل النقل.

## خريطة الفروع

| الفرع | الحالة |
|---|---|
| `main` / Stable | لم يُمس |
| `feat/addons-v7-native-manager-20261027` (Debug) | الأحدث `e925b8e4` (5 نوفمبر). آخر نشر موثّق 0.0.2558 (2 نوفمبر) ثم دفعات لاحقة من جلسات أخرى |
| `claude/supernatural-addons` (فرع عمل Claude) | = Debug `e925b8e4` + أنماط المانجا + نظام الاعتماد + تعديلات الفحص. **غير منشور** |

أدلة وتسليمات الجلسات الأخرى: `docs/addons/ANDROID_DELIVERY_HANDOFF.ar.md` (تسليم السيرفرات وإدارة الإضافات، 8/8 تشغيل على المحاكي)، `docs/addons/PLAYBACK_GROUP2_20261103.ar.md` (DASH، أول إطار، الصوت الخارجي، التوازي في CloudStream)، `docs/addons/DISCOVERY_GROUP1_20261103.ar.md`، `docs/addons/HANDOFF_ENGINE_20261031.md` (مصفوفة المانجا وفصل المدمجة).

## معمارية المحرك (من الكود)

- الويب: `apps/web/lib/anime-engine.js` (prepare/routes/extend/open)، `apps/web/v35/anime.js` و`cinema.js` (ورقة السيرفرات وتشغيل الحلقة)، `apps/web/v35/server-sheet.js` (ثلاث طبقات: جاهز فوق، «تُجهَّز بالخلفية» مطوي، «غير متاح الآن» مطوي بسببه)، `apps/web/lib/route-validity.js` (صالح = READY وprobed=true).
- Android: `android/app/src/main/kotlin/com/vantara/anime/AnimeEngine.kt` (prepare → launchPreparation لكل نسخة → المحوّل → `ResolveTrace` يبلّغ READY فيُفحص الرابط `probeRoute`)، `stream/Prepared.kt` (الجلسة والمسارات، `adopt` لا يفحص وحده)، `stream/StreamProbe.kt` (HLS/DASH/MP4)، `player/PlayerActivity.kt` (نجاح = `onRenderedFirstFrame`، ينتقل للسيرفر التالي عند الفشل).
- Aniyomi: `anime/adapters/Adapters.kt` (`ExtensionAdapter`، يبلّغ كل hoster). CloudStream (Debug فقط، `vantaraRuntimeDebug`): `extensions/runtime-android/` (`RuntimeHost`، `RuntimeSourceAdapter` يبلّغ المرشحين عبر trace).
- المانجا: `ExtensionEnginePlugin.kt` + `apps/web/lib/extension-engine.js`؛ المدمجة مفصولة عن Debug (تُحمّل كإضافة موثّقة).
- حراس CI: `tools/repository-compat/scope-guard.mjs` (كل ملف جديد/معدّل خارج المسموح يحتاج «seam» صريحًا)، `tools/repository-safety.test.mjs` (بصمة `SHELL_DIGEST` في `apps/web/sw.js` تُحدَّث بعد كل تغيير في ملفات الواجهة: `node --test tools/repository-safety.test.mjs` يطبع القيمة الجديدة).
- اختبارات الويب: `npx vitest run apps/web` (آخر نتيجة كاملة 2251/2251 بعد الدمج، ثم أُصلح اختبار `cinema-releases.test.js` لسبب عدم التوفر).

## التصاميم (مؤجلة حتى ينتهي المحرك)

- أنماط الأنمي الموجودة (`apps/web/v35/work-looks.js`): المحور، المنصة، البطاقة الطائرة، شاشة السينما، الحلقة أولًا. سر نجاحها: كل نمط يغيّر **ما يأتي أولًا** لا الزخرفة، نفس الوظائف في كل نمط، زر رئيسي واحد، وعمق مرتبط بالإصبع (طبقتان على خط التمرير، يتوقف مع «تقليل الحركة»).
- المانجا: هوية الورق `--paper #f2ede4` وزوايا 4px وأرقام الفصول الكبيرة كترقيم الصفحات وعناوين STORY/CHAPTERS. الغلاف أولًا والبنر إضافة (أعمال المصادر بلا بنر).
- المطلوب بعد المحرك: ضبط هرمية ومحاذاة أنماط المانجا الأربعة (المالك قال إنها سيئة)، ثم أربعة أنماط للسينما **ببنر بحجم ثابت**، على الصفحات الحقيقية، ولقطة لقطة للمالك، وتجربة كل زر قبل الادعاء، ثم صف «نمط صفحة المانجا/السينما» في المظهر.
- أفكار أكبر قالها المالك وأُجّلت: واجهة زجاجية، شريط تنقل وقائمة جانبية جديدة، تبديل الأقسام دائريًا، انتقال الغلاف المشترك، إعادة تصميم القارئ والمشغّل، «VANTARA حديث/كلاسيك».

## أول ما تفعله الجلسة الجديدة

1. `git fetch` وقارن `claude/supernatural-addons` بـ Debug؛ ادمج الأحدث إن تقدّم Debug (حل تعارض `SHELL_DIGEST` بإعادة حسابه).
2. افحص الجولة 4 من `source-certification.yml` (`188a35c9`) بسجلات الوظائف، وأكمل كما في قسم «ما حدث في الجولات».
3. أبلغ المالك بالعربي بجدول لكل مصدر قبل أي إصلاح، ثم أصلح أعطال المحرك بالترتيب الأكثر أثرًا: «جاهز يكذب» أولًا، ثم المصادر بلا احتياط، ثم التغطية.
