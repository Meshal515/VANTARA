# تدقيق الإضافات — 15 نوفمبر 2026

> طلب المالك: فحص الإضافات واحدة واحدة، جمع مشاكلها، وتقرير. الفحص حي على محاكي Android في CI
> (`runtime-live-sweep.yml`) وعلى Stremio مباشرة، وعلى ويندوز الحقيقي لمصادر المانجا.
> نجاح المحاكي لا يثبت سلوك الجوال: كل «يشغّل» هنا يحتاج تجربة المالك على الجهاز.

## الخلاصة

| | النتيجة |
|---|---|
| إضافات CloudStream المفحوصة حيًّا | 43 من 44 (الدفعة الثالثة أُعيدت 15 نوفمبر، تشغيل 43706826777) |
| تشغّل حلقة حتى الرابط | 12 |
| تطلب تحقق متصفح (المتصفح المخفي يعالج أغلبها الآن) | 7 |
| أعطال من جهة الموقع (Cloudflare، 404، 403، DNS) | أغلب الباقي |
| Stremio | Torrentio 281 سيرفرًا، OpenSubtitles 89 ترجمة، Arabic Subs 30 |
| مصادر المانجا في ويندوز | 6 من 7 على ويندوز حقيقي (بعضها عبر المتصفح المخفي)، ومصفوفة المانجا 19/19 |

## CloudStream: كل إضافة

| الحالة | الإضافات |
|---|---|
| ✅ تشغّل | Aflaam، Akwam (6 روابط، كان «فشلًا» من أداة الفحص)، Asia2tv، Alooytv، Anime4up، AnimeRift، AnimeWitcher، Dima toon، EgyWatch (5 من 10)، Eshek، TopCinema، Tuniflix |
| 🟠 تحقق متصفح | 5TV، Animerco، Brstej، Cimalight، Shahidwbas، Tuktukcima، Witanime |
| 🔴 التفاصيل تفشل | 3isk، Cee، Mycima، FullMatchShows، Shahid4u، VIU، YouTube |
| 🔴 لا كتالوج | Anime3rb، Anime-Phoenix، Cimatn، Egydead |
| 🔴 لا روابط | CimaClub، Krmzy، LodyNet |
| 🔴 فشل داخلي في الإضافة | Elif، Faselhd، OscarTv، Yacintv |
| 🔴 أخرى | Carateen (إصدار مكتبة غير متوافق ABI_MISMATCH)، Syrialive (نقل)، TVgarden (تحليل)، WeCima (DNS)، TuniflexBlog (حد معدل) |
| ⏳ لم يُطابق اسمها | Shabakaty Cinemana |

## ما أُصلح في هذه الجولة

- **المتصفح المخفي (WebViewResolver)** لإضافات CloudStream: صفحات تحتاج JavaScript أو تحققًا تُفتح في WebView مخفي معزول (http/https فقط، بلا ملفات، مهلة 3–30 ث، حد للحجم والأنماط).
- **التحقق**: سبب الفشل يظهر بالعربي بدل الرجوع الصامت.
- **ويندوز**: متصفح مصادر مخفي (جلسة معزولة) يعبر Cloudflare و«One moment, please»؛ هوية MangaDex الخاصة؛ ستارز مانجا على عنوانها الجديد؛ فصول Madara كلها (بيرسيرك 404 بدل 50).
- **ورقة التحميل**: تسأل الإضافات والتورنت بهوية العمل كالتشغيل (كانت ترفض العمل قبل سؤالها)، وكل سيرفر يظهر لحظة جاهزيته.

- **أداة الفحص** تمرّر روابط CloudStream كالمشغّل (`plainMedia`): Akwam ظهر فاشلًا بسببها وهو يشغّل.
- **مستخرج iplayerhls** (Eshek): JW Player مضغوط، قائمة HLS رئيسية 1080p حية.

## باقٍ ومعروف

- 🟠 مستضيفات EgyWatch الناقصة (d0o0d وstreamwish.fun وuqload.vc وearnvids وvidtube وupdown وmzfi): تحقق Cloudflare أو صفحة تحميل من عنوان مركز البيانات؛ لا تُسجَّل قبل دليل MEDIA.
- 🟡 Comet وMediaFusion وSubSense وWyzie تحتاج إعدادًا من المستخدم قبل أن ترد.
- 🟡 أعطال المواقع نفسها (DNS، 404، Cloudflare صارم) لا تُصلح من التطبيق.
