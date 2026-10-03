# حالة VANTARA Addon Fabric

آخر تحديث: 2026-10-03. branch البحث والخطة: `feat/addon-fabric`، أساس `ffeb20c`.

## المنجز فعليًا

- قراءة SPEC كاملة (64 بندًا) وفحص كود المشغل APK/PWA وregistry/bridges/sidebar الحالي.
- تثبيت تعديلات المالك في REQUIREMENTS: خانة SVG أحجية ثابتة، فلاتر داخلية، CSS محفوظ، no autoplay، minimal subtitle integration.
- إعداد REQUIREMENTS بمعرفات AF-01–48 وST-01–12، وخطة T0–T8 ومصفوفة تغطية كل بنود SPEC.
- بحث GitHub/Context7/Stremio/hls.js/Keiyoushi ومراجعة الفرق بين APK extensions وremote addons.
- Provider حي مع اختبار CORS من Chromium على أصل PWA: OpenSubtitles v3، The Mentalist S01E01، 87 نتيجة/4 عربية وSRT عربي قابل للتنزيل. لم يُربط بالمشغل بعد ولم يثبت على حساب المستخدم.
- baseline: 23 اختبارًا مرتبطًا ناجحًا على الكود الحالي.
- إعادة فحص EgyDead مباشرة: الموسم الصحيح،23 حلقة،4 سيرفرات؛ HGC/EarnVids استخرجا، Mixdrop حذف صريح، Dood فارغ.
- تجربة Chrome151 native/MSE مؤقتة: قراءة metadata تحسنت بـMSE، لكن التشغيل الفعلي لم يثبت؛ لا root-cause claim نهائي.

## التنفيذ

| المهمة | الحالة | دليل اكتمال المطلوب |
|---|---|---|
| T0 مشاكل PWA | فحص جارٍ؛ لا product fix بعد | frame حقيقي قبل/بعد ومقارنة direct/edge |
| T1 العقود | مخطط، ينتظر مراجعة الخطة | validation/identity tests |
| T2 registry/runtime | مخطط، ينتظر مراجعة الخطة | security/cancellation/health/stage tests |
| T3 مدير الإضافات | مخطط، ينتظر مراجعة الخطة | stable entry/filter/install/screenshots |
| T4 Source Mode | مخطط، ينتظر مراجعة الخطة | مصدر فعلي لكل قسم وBack/cache identity |
| T5 Stremio/streams | مخطط، ينتظر مراجعة الخطة | real addon→stream→frame، no wrong match |
| T6 ترجمة PWA | مخطط، provider موجود فعلًا | live subtitle داخل player دون تأخير فيديو |
| T7 APK parity | مخطط، المشغل فُحص | native tests + device proof |
| T8 مراجعة/إطلاق | لم يبدأ | all tests، مراجعة، أمر دمج، تحقق إنتاج |

لم يُغيّر product code أو CSS أو المصادر أو APK بهذا البحث. لا نشر/دمج جديد. SPEC الأصلي لم يُعدّل؛ المتطلبات تسجل التصحيحات والقيود الواقعية بدل اعتبار كل مثال قابلًا للتطبيق تلقائيًا.

## الخطوة التالية

مراجعة المالك للخطة الجديدة واختيار التنفيذ المتسلسل أو بالوكلاء بحسب مسار Superpowers. بند SPEC63 يطلب هذه المراجعة قبل بدء Fabric. فحص مشاكل المصادر مستقل ويمكن استكمال الأدلة دون تثبيت الإضافات.

المتابعة: fixture HLS محلية اشتغلت native وMSE بفيديو حقيقي؛ فرضية عطل native عام لم تثبت، ولا product fix تخميني. master منتلست الحي MIME/CORS/codecs صحيحة، وفحص segment/frame ما زال جارياً.
