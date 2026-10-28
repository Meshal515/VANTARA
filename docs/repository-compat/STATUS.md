# VANTARA Runtime — حالة التنفيذ التجريبي

## ما نُفذ فعليًا

1. نواة أصلية وبوابة CS3/DEX دون تنفيذ: سلامة الأرشيف والبصمة ونقطة الدخول وميزانية metadata، وسياسات host/network مستقلة ونتائج لكل قدرة.
2. دراسة 15 بلاغًا وردوده، ثم دراسة مسارات المحركات نفسها في 27 ملفًا مثبتًا: loader/manager/repository/source API/network/cookies/preferences. ENGINE_SOURCE_EVIDENCE.json يسجل SHAs والبصمات. ENGINE_ARCHITECTURE_STUDY.md يميز الدليل من الاستنتاج وحدود التغطية؛ ليست مراجعة جميع ملفات التطبيقات أو تدقيقًا أمنيًا شاملًا.
3. تطبيق Android مستقل باسم VANTARA Runtime Lab وبالحزمة dev.vantara.runtime.lab. يحمل DEX مؤلفًا للاختبار في عملية isolatedProcess ذات UID مستقل، مع هوية مصدر/جلسة عند المضيف وIPC محدود. تهيئة المرشح تسبق نشره.
4. لا ربط بالإنتاج ولا تغيير في محرك قائم أو بيانات أو تفضيلات أو توقيع أو SDK للتطبيق الحالي. حارس النطاق يقارن جميع الملفات الأصلية بالالتزام f20723d.

## التحقق والأدلة

- Node: 26 اختبارًا؛ Python: 16 اختبارًا. فحص ذاكرة64MiB يعيد تضخيم metadata ثم يرفضه بدل OOM.
- حزم AnimeWitcher/Anime4Up/AnimeRift/WitAnime الفعلية نجحت في فحص التنسيق والبصمة فقط؛ executed=false. لم تُطلب مواقع المصادر.
- checkpoint b4987628 أعاد 12 فشلًا متوقعًا WORKER_NOT_IMPLEMENTED على API29 وAPI35. أُلغيت التشغيلات بعد اكتمال خطوات الاختبار بسبب خلل جمع logcat بعد إغلاق المحاكي؛ أُصلح الالتقاط داخل جلسة المحاكي ولم تُحسب الإلغاءات نجاحًا.
- 7227f2d8 نجح بـ16 اختبار تنفيذ فعلي على كل من Android10/API29 وAndroid15/API35؛ XML artifacts نُزّلت وفُحصت: صفر فشل/أخطاء/تجاوز. تشغيل push: https://github.com/Meshal515/VANTARA/actions/runs/40674717719 ؛ PR: https://github.com/Meshal515/VANTARA/actions/runs/40674724662 .
- المراجعة المستقلة التقطت ثلاث فجوات إغلاق/تعافٍ، وcheckpoint 3821038e ثم31d52b91 أعاداها فعليًا: سبعة اختبارات فشلت قبل الإصلاح على كل API، منها retained broker وblocked callbacks وblocked main looper. تشغيل RED: https://github.com/Meshal515/VANTARA/actions/runs/40676400197 . مجموعة القبول الموسعة 20 اختبارًا لكل API. نتيجة الإصلاح النهائي وروابط CI الأخيرة تسجل في PR#301؛ نجاح النسخة السابقة لا يُستخدم لإعلان نجاح اختبارات الانحدار الجديدة.
- لا اختبار جهاز حقيقي ولا تشغيل حزمة CS3 خارجية ولا مصدر حي في هذه الدفعة. صور/كتالوج/روابط fixtures بيانات اختبار صريحة.

## إصلاحات مراجعة التعافي — تنتظر نتيجة CI النهائية في PR

- التهيئة قد تبدأ thread ثم تفشل قبل النشر؛ فشل المرشح الأول يغلق العامل ويسحب broker. رفض إعادة تحميل مرشح فوق عامل سليم لا يوقف العامل السليم.
- يبدأ control cleanup قبل نشر فشل futures. الإلغاء له hook مستقل قبل dependent callbacks، والمهلة مربوطة بالعملية الفعلية لا بإكمال promise من المستدعي.
- CLOSE يقتل العملية من Binder control thread مباشرة حتى لو عُلّق main Looper؛ يرسل المضيف CLOSE دون انتظار جواب ثم يفك الربط.
- اختبار timeout يجب أن يثبت أن العملية بدأت فعلًا بواسطة hang-start، لا نجاح قتل عملية لم تبدأ العمل.

## ما لم يُنفذ بعد

- Worker ينفذ **العقد الأصلي VANTARA RuntimeProvider فقط**. لا CloudStream Plugin/MainAPI/NiceHttp ABI implementations ولا APK ABI adapter للعامل بعد. تسجيل backend مؤلف للاختبار لا يعني توافق إضافة منشورة.
- لا HTTP production broker أو DNS/TLS/redirect enforcement أو مخزن cookies/تفضيلات/كاش خاص بالعامل. النقل الحالي capability صريحة باختبارات fixture؛ لا ضمان منع حظرIP.
- لا تشغيل DEX فيWindows/PWA؛ ولا مسار allocation معزول مجرب لـAndroid26–28 في هذا المختبر.
- لا تثبيت/تحديث ذري أو فصل للمصادر المدمجة أو نقل بيانات مستخدم في هذه الدفعة. لا ربط بمحركات Aniyomi/Mihon القائمة بعد.
- إثبات distinct UID وحجب ملف/socket وموت العملية لا يثبت احتواء كل native exploit أو استنزاف النظام أو إغراق جميع Binder threads.
- لا main merge أو نشر Stable. لا تعديل في التورنت أو المشغل أو subtitles/الترجمة أو الحسابات والمزامنة.

## بوابة الخطوة التالية

ملفات ABI محددة للحزم الأربع بدلالات فعلية وليست no-op، مع اختبار تسجيل MainAPI وتشغيل catalogue/search/details/episodes/videoLinks على حزمة فعلية. Activity فيAnime4Up وgetBaseClient فيAnimeRift/WitAnime واعتماديات Kotlin/default/suspend تحتاج معالجة صريحة. ربط Debug يأتي بعد إثبات هذه الوظائف، مع حماية المحركات الحالية.
