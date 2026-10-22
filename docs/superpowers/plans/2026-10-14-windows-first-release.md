# خطة إخراج أول نسخة VANTARA لويندوز

> **للتنفيذ:** تستخدم مهارة تنفيذ الخطط أو مهارة توزيع المهام المتوازية في الأجزاء المستقلة. طلب المالك الأخير يجعل إخراج الحزمة أولوية قبل توسيع إصلاحات الغرف.

**الهدف:** تسليم حزمة ويندوز x64 قابلة للتنزيل، مع واجهة VANTARA وإضافات Stremio/Torrentio ومحرك تورنت ومشغل مرفقين.

**المعمارية:** Electron بدل خيار Tauri الأولي بسبب قابلية إنتاج حزمة ويندوز مباشرة من بيئة Linux الحالية. الواجهة المحلية على أصل `vantara://app` ثابت، ومنطق الإضافات الحالي يعاد استعماله. يعمل rqbit وmpv في عمليات محلية يديرها العميل.

**المكونات:** Electron 44.7.2، rqbit 9.0.1، mpv بناء 20261014/x86_64، JavaScript/Node، وواجهة VANTARA الحالية.

**المواصفة السابقة:** [تصميم ويندوز](../specs/2026-10-14-windows-torrentio-design.md). هذه الخطة تعدل اختيار قشرة Tauri إلى Electron وآلية IPC، وتؤجل إصلاحات Android والغرف الأوسع وفق توجيه المالك. نافذة المشاهدة الأصلية المرفقة ونقل الإضافات والهوية الدقيقة يبقيان كما في التصميم.

## القيود

- لا دمج أو نشر إنتاجي؛ الحزمة تُسلَّم محليًا للمراجعة والتجربة.
- لا Android أو Kotlin جديد في هذا الإصدار؛ اختبارات إصلاح الصور غير المكتملة محفوظة خارج المستودع.
- الملف التنفيذي وملفات المحرك والمشغل x64، مع manifest توثيق hashes والتراخيص والمصادر.
- سياق renderer معزول وsandbox، دون Node integration أو shell عام.
- لا ادعاء تشغيل على جهاز ويندوز قبل دليل فعلي. fixture يثبت المحرك، لا توفر مصدر Torrentio بعينه.
- تقدم تحميل السرب مستقل عن ready/إطار الفيديو؛ لا نسبة وهمية.
- الإضافات العامة يمكن تصفحها دون حساب؛ الحسابات القائمة لا تُنشأ أو تُنتحل لتجاوز الاقتران.

## العقود بين الأجزاء

الجسر `window.VantaraDesktop`:

- `requestResource({url, json, limit, timeout}) → Promise<{text, status}>`.
- `startPlayback({session, candidate, title, position}) → Promise<{started: true}>`.
- `stopPlayback({session}) → Promise<void>`.
- `playbackCommand({session, command, value}) → Promise<void>`؛ أوامر pause/seek فقط.
- `openExternal({url}) → Promise<void>`؛ HTTPS عام أو configured stremio link يلتقط داخل التطبيق.
- `onEvent(fn) → unsubscribe`؛ الأحداث `{type, session, position?, duration?, message?, downloadSpeed?, peers?}`.
- `platform: 'windows'`، `version: '0.1.0-preview.1'`.

`candidate` هو normalized Stream الحالي من `addons/streams.js`، لا عنوان أو hash مخمّن. `position/duration` بالمللي ثانية. الأحداث: `playback/preparing`, `playback/ready`, `playback/progress`, `playback/closed`, `playback/error`, `addon/install`.

## مواضع المراجعة

- ملف تورنت له fileIdx صفر أو غير صالح أو ملفات فيديو متعددة دون اختيار.
- فتح إعداد خدمة خارجية يطلق `stremio://` بدل تسليم manifest للعميل.
- رابط معدّ يحتوي secrets/query parameters، لا يفقدها ولا يسجلها.
- إغلاق المشغّل أو التطبيق أثناء metadata/تحميل/seek، لا يترك عمليات أو جلسة قديمة.
- حفظ الإضافات بعد إعادة تشغيل التطبيق لا يتغير بسبب أصل محلي بمنفذ عشوائي.

## المهمة 1: واجهة desktop وعقود الإضافات

**الملفات:** `apps/web/desktop/{index.html,boot.js,runtime.js,engine.js,desktop.css}` واختباراتها، `pwa/platform.js` و`pwa/boot.js`، `addons/runtime.js` و`addons/streams.js` و`addons/assessment.js`، `lib/anime-engine.js` و`lib/capabilities.js` و`lib/release.js` عند الضرورة.

- [ ] إثبات فشل اختبار منصة desktop وقبول normalized torrent بقدرتها دون تغيير PWA.
- [ ] تركيب جسر AnimeEngine وAddonFabric مستقليْن، مع جلسات route/prepare/select يختارها المستخدم.
- [ ] إعادة استعمال مدير الإضافات وعرض السينما/الأنمي الموجودين، ومدخل إلى واجهة الحسابات الحالية.
- [ ] عرض بدء المحرك/انتظار البيانات/جاهزية المشغل وحالات الفشل، وحفظ الإضافات محليًا.
- [ ] اجتياز اختبارات desktop وعقود الإضافات وانحدارات المنصتين الحاليتين.

## المهمة 2: خدمات التورنت والمشغل

**الملفات:** `apps/desktop/src/services.mjs` واختبارات Node المرتبطة.

- [ ] اختبار حدود الروابط والـhash وfileIdx والترويسات، مع خطأ جلسة قديمة والإغلاق.
- [ ] نقل JSON HTTPS محدود ومحمي من أهداف داخلية، دون إرسال توكنات VANTARA للإضافات.
- [ ] إقلاع rqbit على loopback مع basic auth سري ومنفذ خاص، واستعمال CLI الحقيقي المثبت؛ اختيار الملف المحدد ودعم Range.
- [ ] إقلاع mpv بلا config خارجي، وربط named pipe على ويندوز وUnix socket للاختبار؛ تقدم حقيقي وتنظيف.
- [ ] تشغيل fixture مملوك على Linux عند توفره للتحقق من عقد المحرك، مع إبقاء حد ويندوز واضحًا.

## المهمة 3: قشرة Electron والحزمة

**الملفات:** `apps/desktop/{package.json,main.cjs,preload.cjs}`، `tools/build-windows.mjs`، `apps/desktop/windows.nsi` وملفات التبعيات/التراخيص.

- [ ] تقديم assets محلية بأصل ثابت، وIPC من origin العميل فقط، مع إيقاف المحركات عند الخروج.
- [ ] نافذة إعداد معزولة تلتقط `stremio://` وتعيد رابطها إلى مدير الإضافات.
- [ ] جلب توزيعات x64 مثبتة وفحص SHA-256 قبل فكها؛ mpv دون requirement تعليمات CPU-v3.
- [ ] بناء portable ZIP، وبناء NSIS EXE إن توفر compiler؛ فحص نوع PE x64 ووجود assets والمحرك والمشغل.
- [ ] تحديث digest وأصول الواجهة وإجراء suite الويب/سلامة المستودع، ثم مراجعة مستقلة للفرق.
- [ ] توثيق artifact/hashes والتحقق الفعلي، وتسليم رابط تحميل الحزمة دون ادعاء اختبار ويندوز غير منفذ.

## حالة الإذن والأسلوب

المالك وجّه صراحةً: «الأولوية الآن طلع نسخة ويندوز». التنفيذ هنا محلي في النسخة المسحوبة، دون دفع إلى GitHub أو دمج. العمل يقسم إلى واجهة وخدمات وقشرة/حزمة ذات عقود محددة، ثم مراجعة مستقلة قبل التسليم.
