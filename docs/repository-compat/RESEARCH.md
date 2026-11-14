# دراسة التوافق — 28 أكتوبر 2026

## النطاق والأمانة

دُرست15 حالة مختارة مع ردودها من CloudStream ثم Aniyomi وMihon. ليست هذه مراجعة جميع Issues أو تدقيقًا أمنيًا شاملاً؛ البلاغ المفتوح لا يثبت سببًا جذريًا، وإغلاقه لا يثبت شحن الإصلاح. جُمعت الفهارس والبلاغات محليًا، ولم تُضمّن logs المستخدمين أو معرّفاتهم أو بياناتهم في المستودع. لم يُنسخ تنفيذ upstream أو تُشغّل حزم مصادر.

## مراجع مثبتة

- CloudStream: `5024ace2922a148d38df2a816b483b529789cf58`، الترخيص المعلنGPL-3.0. [واجهة API العامة](https://github.com/recloudstream/cloudstream/blob/5024ace2922a148d38df2a816b483b529789cf58/library/README.md) تنص على التوافق الثنائي وفحص `checkKotlinAbi`. ملف التواقيع العامة library/api/jvm/library.api حجمه592482 بايت وبصمتهSHA256 `359f918f07775f5852ddc8453242480d590fc263a9a7bbf470ca32b1135551cf`؛ استُخدم محليًا كمرجع عقود، لا يُنسخ تنفيذه أو ملفاته إلى المحرك.
- [التوثيق الرسمي للمطورين](https://recloudstream.github.io/csdocs/devs/gettingstarted/).
- Aniyomi: `97414446b8a95994c72dd33c41c971a89d4d25b8`، Apache-2.0.
- Mihon: `e588e04359fe1058206a2cbac1b01018ad787359`، Apache-2.0.
- المستودع العربي: تعريف `e1dc6d9bc454042e4cc9eeff26b06ce94b8fcd73`، builds `ff8028446f37776cf858b1525f534b7dd3e4518e`. الفهرس43 إضافة؛ فُحصت أربع حزم فقط، لا كل الإضافات ولا مواقعها.

## الحالات واحدةً واحدة

| الحالة | ما ورد في الدليل | القرار/اختبار فانتارا |
|---|---|---|
| [CloudStream2151](https://github.com/recloudstream/cloudstream/issues/2151) | تعذر إضافة مستودع برسالة تقترحVPN؛ لا إثبات حظرIP | فصل فشل الفهرس عن المصدر وعن VPN؛ لا استنتاج حظر من فشل إضافة مستودع |
| [1724](https://github.com/recloudstream/cloudstream/issues/1724) | بلاغ توقف تحديثات prerelease، مع خلط بين download-all والتحديث | فصل تحديث الفهرس وتثبيت الإضافة وتحديثها؛ اختبار بيانات الإصدار المثبت مقابل المتاح |
| [1767](https://github.com/recloudstream/cloudstream/issues/1767) | بلاغ مشابه، ورد يوجه لمستودع المزوّد | لا اعتماد حذف وإعادة تنزيل كل المستودعات علاجًا؛ التشخيص يسجل المرحلة والمالك |
| [2907](https://github.com/recloudstream/cloudstream/issues/2907) | النسخة الاحتياطية تعيد المستودعات دون الإضافات وإعداداتها حسب البلاغ | لاحقًا اختبار snapshot يستعيد الحزم والإعدادات والهويات؛ الدفعة الحالية لا تغيّر التخزين |
| [2728](https://github.com/recloudstream/cloudstream/issues/2728) | crash متكرر مع بقاء إضافة مزعجة؛ log غير كافٍ لإثبات السبب | عزل التنفيذ المستقبلي وموت العامل عن التطبيق؛ لا حذف بيانات المصدر لحل crash |
| [2869](https://github.com/recloudstream/cloudstream/issues/2869) | crash عند البحث، ورد يربطه بإضافة معينة؛ log ناقص | مصدر واحد لا يُسقط بحث البقية. عزل استثناءات منطقي الآن، واختبار عملية Android المنعزلة لاحقًا |
| [3280](https://github.com/recloudstream/cloudstream/issues/3280) | طلب عودة خيار تنزيل الإضافات تلقائيًا | ليس عطلًا مثبتًا؛ لا تنزيل أو تشغيل43 إضافة عند إضافة مستودع واحد |
| [Aniyomi2215](https://github.com/aniyomiorg/aniyomi/issues/2215) | بلاغ يحتوي abstract-method مع مشكلات player/serialization مختلفة | اختبار ABI منفصل عن المصدر. player خارج نطاقنا ولا يُعدّل بناءً على هذا البلاغ |
| [2372](https://github.com/aniyomiorg/aniyomi/issues/2372) | مستودع مضاف وقائمة لا تعرض غير المثبت؛ نقاش انتقالjson إلىprotobuf | تنسيقات فهارس مستقلة عن runtime. فانتارا الحالي يدعم index.pb بالفعل، فلا نعيد إصلاحًا موجودًا |
| [2390](https://github.com/aniyomiorg/aniyomi/issues/2390) | stack يشير إلى OOM داخل إضافة | الاستثناء المنطقي ليس عزل OOM. يلزم عامل فعلي محدود وعقد IPC؛ غير مثبت في هذه الدفعة |
| [Mihon4183](https://github.com/mihonapp/mihon/issues/4183) | تكرار تفضيلات بعد موت العملية | اختبار ترقية/استعادة بلا تكرار لاحقًا؛ حارس النطاق يمنع لمس التفضيلات الحالية |
| [4101](https://github.com/mihonapp/mihon/issues/4101) | إعادة الفهرسة تفقد ربط مجلدات؛ رد يذكر إصلاحdeeb9b2 | هوية المصدر لا تعتمد على العنوان/النطاق/الاسم. لا مسح قاعدة البيانات؛ لا ندعي اختبار إصدار Mihon |
| [4201](https://github.com/mihonapp/mihon/issues/4201) | لا فصول، وإغلاق بتوجيه إلى صيانة الإضافة | الإغلاق وحده لا يثبت سببًا. نحتاج أدلة القائمة/التفاصيل/الفصول بدل اتهام المصدر آليًا |
| [4188](https://github.com/mihonapp/mihon/issues/4188) | تحديثات لا تظهر؛ الرد يشرحSmart Updates لتخفيف الضغط | إظهار آخر فحص وسياسة التأجيل. لا شطب مصدر لأنه أُجّل احترامًا لميزانية الطلبات |
| [3177](https://github.com/mihonapp/mihon/issues/3177) | مقترح اختلاف ترويساتWebView؛ ليس إصلاحًا مثبتًا | session/UA/header scope بدل قيمة عالمية. لا تغيير حماية/حلCAPTCHA تلقائي بناءً على اقتراح |

## نتائج الحزم الفعلية

ملف PACKAGE_OBSERVATIONS.json يثبت الروابط بcommit وبصمة كل حزمة. لم يُضمّن أي cs3 أو مصدر خارجي في Git.

| الحزمة | Version | أصناف DEX معرفة | مراجع دوال خارجية | مراجع CloudStream/NiceHttp |
|---|---:|---:|---:|---:|
| AnimeWitcher |3|29|139|27|
| Anime4Up |1|36|190|29|
| AnimeRift |1|20|185|42|
| WitAnime |1|50|337|41|

عدد المراجع ليس عدد دوال ناقصة: يتضمنJDK/Kotlin ومكتبات قد تتوفر في host.

- الحزم الأربع تمتد من plugins.Plugin علىAndroid، ولا يكفيMainAPI أو ملف ABI الخاص بمكتبةJVM وحده.
- Anime4Up يطلبCommonActivity.getActivity؛ لا نمنحهActivity الرئيسية للمستخدم ضمن sandbox.
- AnimeRift يطلبNiceHttp.getBaseClient، مع تحذيرVPN في وصفه. لا حمايةIP مضمونة إذا سُمح بتجاوز البروكر؛ منع الشبكة المباشرة يتطلب عزلًا فعليًا.
- نقطة دخول WitAnime داخل حزمته اسمهاcom.cimanow.WitAnimePlugin؛ استنتاج نقطة الدخول من الاسم المعروض خطأ. Package Gate يقرأmanifest ويتحقق من وجود الصنف.
- أدوات التحليل تقرأ metadata وتواقيع type/method/field فقط؛ لا تُنسخ تعليمات أو أجسام دوال DEX.
- التنزيل عبرHTTPS وحسابSHA256 ليسا توقيع ناشر. تقارير البوابة تصرح publisherSignatureVerified=false، ولا تعلن source/runtime/playback success.
