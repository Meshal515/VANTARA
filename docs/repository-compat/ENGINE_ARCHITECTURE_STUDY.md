# VANTARA Runtime — دراسة المحركات نفسها

هذه دراسة لمسارات التنفيذ في نسخ مثبتة، إضافةً إلى دراسة البلاغات السابقة. ليست ادعاء قراءة كل ملفات الواجهات/المشغل في التطبيقات، ولا تدقيقًا أمنيًا شاملاً أو اختبار تشغيل upstream. قُرئت مسارات الاكتشاف والتحميل والتسجيل والعقود والشبكة والهوية والتخزين والإزالة والتعافي، مع فصل الاستنتاج من الكود عن البلاغ والاختبار الفعلي.

## النسخ ومصدر الدليل

- CloudStream: `5024ace2922a148d38df2a816b483b529789cf58`؛ جذر [app/plugins](https://github.com/recloudstream/cloudstream/tree/5024ace2922a148d38df2a816b483b529789cf58/app/src/main/java/com/lagradost/cloudstream3/plugins)، وعقود [library](https://github.com/recloudstream/cloudstream/tree/5024ace2922a148d38df2a816b483b529789cf58/library/src/commonMain/kotlin/com/lagradost/cloudstream3).
- Aniyomi: `97414446b8a95994c72dd33c41c971a89d4d25b8`؛ [تحميل الأنمي](https://github.com/aniyomiorg/aniyomi/blob/97414446b8a95994c72dd33c41c971a89d4d25b8/app/src/main/java/eu/kanade/tachiyomi/extension/anime/util/AnimeExtensionLoader.kt)، [عقود المصدر](https://github.com/aniyomiorg/aniyomi/tree/97414446b8a95994c72dd33c41c971a89d4d25b8/source-api/src/commonMain/kotlin/eu/kanade/tachiyomi).
- Mihon: `e588e04359fe1058206a2cbac1b01018ad787359`؛ [تحميل الإضافة](https://github.com/mihonapp/mihon/blob/e588e04359fe1058206a2cbac1b01018ad787359/app/src/main/java/eu/kanade/tachiyomi/extension/util/ExtensionLoader.kt)، [Source API](https://github.com/mihonapp/mihon/tree/e588e04359fe1058206a2cbac1b01018ad787359/source-api/src/main/kotlin/eu/kanade/tachiyomi/source).

## دورة العمل، لا أسماء العائلات فقط

| المرحلة | CloudStream | Aniyomi | Mihon | قرار VANTARA Runtime |
|---|---|---|---|---|
| اكتشاف المستودع | RepositoryManager يقرأ تعريف المستودع ثم قوائم SitePlugin | AnimeExtensionApi/store يفصل المتاح عن المثبت | store/ExtensionManager يفصل المتاح والثقة والمثبت | الاكتشاف ليس تنفيذًا؛ لا تثبيت كل الفهرس تلقائيًا |
| حزمة الإضافة | cs3 ZIP، manifest وDEX، نقطة دخول وأحيانًا resources | APK، metadata، مكتبة ABI ومصدر أو SourceFactory | APK، metadata، مكتبة ABI ومصدر أو SourceFactory | فحص الحزمة ثم ملف ABI ثم تشغيل؛ ليست عبارة «يدعم APK» ضمانًا لكل ABI |
| الثقة | RepositoryManager:193–238 يقارن fileHash إذا توفر؛ ليس توقيع ناشر | Loader:259–286 يفحص ABI والتوقيعات والثقة | Loader:356–375 يفحص ABI والتوقيعات وثقة المتجر | سلامة البايتات منفصلة عن هوية الناشر وعن صلاحيات التنفيذ |
| ربط الاعتماديات | PathClassLoader بوالد classloader التطبيق، Plugin/BasePlugin/MainAPI/NiceHttp/extractors | ChildFirstPathClassLoader، ثم fallback عند LinkageError | DelegateLastClassLoaderCompat | ملف توافق مُختبر؛ لا تبديل loader عشوائيًا ولا no-op APIs تخفي النقص |
| التهيئة والتسجيل | Plugin.load يسجل MainAPI وextractors في holders مشتركة | instantiate ثم Source أو AnimeSourceFactory | instantiate ثم Source أو SourceFactory، وإعادة استعمال كائن مطابق للإصدار | التهيئة مرشح غير منشور؛ النشر بعد النجاح فقط. فشل التهيئة لا يترك مصدرًا جاهزًا |
| الكتالوج والبحث | MainAPI getMainPage/search/quickSearch؛ خيارات صفحات وتوقيت وقدرات منفصلة | popular/search/latest request→parse؛ Rx وsuspend | popular/search/latest request→parse؛ Rx وsuspend | عمليات مستقلة؛ empty/not-supported/failure ليست نجاحًا شاملاً |
| تفاصيل ومحتوى | load يعيد أنواع أعمال وحلقات، loadLinks يخرج callbacks وروابط | details→episodes→hosters أو videos→resolve | details→chapters→pages→image URL | الحفاظ على opaque IDs/data والترويسات والترتيب؛ واجهة التطبيق القائمة تستهلك النتيجة لاحقًا |
| رابط التشغيل | ExtractorApi registry وhost match وcallbacks؛ الرابط يتطلب extractor مناسبًا | Video/Hoster وترويسات وربما resolver | لا يساوي صفحات القراءة رابط تشغيل فيديو | استخراج الروابط فقط ضمن نطاقنا؛ مشغل الفيديو/التورنت/الترجمة الموجودة لا تتغير |
| الشبكة والجلسات | الاعتماد على NiceHttp/OkHttp وإمكانية APIs للوصول إلى client/Activity في بعض الحزم | NetworkHelper/client مشترك؛ بعض المصادر تبني clients خاصة | NetworkHelper/client وCookieManager؛ CloudflareInterceptor يتعامل مع challenge | بروكر مملوك للمضيف وسياق جلسة ثابت؛ حدود مشتركة للنطاق؛ لا UI تحقق خلفي |
| صور وأغلفة | posterUrl وposterHeaders ضمن بيانات الاستجابة | source headers وclient مع metadata الصورة | source headers وimage request/page API | الحفاظ على منشأ الصورة وترويساتها؛ لا إعلان فحص الصورة ناجحًا من ظهور النص |
| هوية المصدر | روابط ومصادر وfilename mappings | HttpSource id مشتق من name/lang/versionId أو override | HttpSource id بنفس المبدأ وStubSource للغياب | استيراد native sourceId كما هو؛ الاسم/النطاق بيانات متغيرة لا إعادة حساب لهوية المستخدم |
| التخزين | قوائم plugin/preferences مع مصادر مسجلة بالذاكرة | مستودعات/تفضيلات/StubSources وقاعدة بيانات | preferences/listeners وStubSources وقاعدة بيانات | بيانات حساب المصدر عند المضيف وبمساحة session+source؛ لا تمرير مخزن الحسابات للعامل |
| التحديث والإزالة | download temp/hash، replace، unload/beforeUnload وإزالة التسجيل | تثبيت خاص/PackageInstaller، version/signature checks ثم reload | اختيار نسخة مشتركة/خاصة وفحص version/signature ثم reload | candidate مستقل، تحقق قبل التبديل، احتفاظ بالنسخة السابقة؛ التنفيذ الذري والتخزين مرحلتان لاحقتان |
| فشل الإضافة | catch Throwable ونتيجة false مع plugin-load toast في manager | catch أخطاء التهيئة وLinkageError حسب المسار | NotLoaded مع سبب ABI/Trust/Filtered/Failed | الخطأ حالة تشغيل محددة؛ لا حذف المصدر ولا إشعار تحقق ولا حكم «الموقع مات» |
| موت العملية | classloader وكود داخل عملية التطبيق | classloader وكود داخل عملية التطبيق | classloader وكود داخل عملية التطبيق | عامل OS isolated بUID مستقل؛ إثبات exit/timeout/restart على Android |

## نتائج قابلة للتحقق وحدود الاستنتاج

1. **التحميل داخل العملية** مثبت مباشرة من مسارات PathClassLoader/DelegateLast والنداء على كائن الإضافة. هذا قرار معماري، وليس إثبات أن كل إضافة تسبب crash. اختبار فانتارا يقتل عملية إضافة مؤلفة للاختبار ويثبت بقاء المضيف.
2. **تسجيل CloudStream قبل اكتمال load**: PluginManager:637–676 يحدّث metadata ويضع كائن الإضافة في maps ثم ينادي load؛ catch:677 لا يستدعي unload. يُظهر الكود مسار فشل غير معاملاتي، لكن لم نُشغل upstream أو نثبت بلاغ مستخدم محدد به. فانتارا تختبر عدم نشر كائن فشلت تهيئته.
3. **Mihon يحافظ على seed غير مهيأ** في AndroidSourceManager بدل بث قائمة فارغة قبل انتهاء التحميل؛ هذا حل جيد نتعلم مبدأه دون نسخه. قوائم Runtime ستُظهر loading مستقلًا عن empty عندما تُوصل بالواجهة.
4. **Aniyomi يميز LinkageError ويجرب loader آخر**؛ هذا ليس خطأ بحد ذاته. محركنا يجب أن يعرف ABI المطلوب ويقيس الوظائف بعد الربط بدل اعتبار نجاح إنشاء الكائن دليلًا على صحة المصدر.
5. **Mihon الحالي يعالج onRenderProcessGone صراحة** في CloudflareInterceptor؛ لا يصح القول إن upstream كله يهمل renderer crash. سياستنا تختلف بطلب المالك: لا WebView تلقائيًا، وتحكم المستخدم يبقى عند المضيف.
6. **CookieManager مخزن WebView مشترك** في الملفات المدروسة؛ لا نستنتج منه تسربًا مثبتًا بين حسابات تطبيق آخر. نعتمد عزل الجلسات بعقد صريح واختبار مصدرين/جلستين.
7. **RateLimitHost يركب interceptor في client**؛ تعدد clients يحتاج قرار ميزانية على مستوى host. اختبارات النواة الحالية تثبت اشتراك إضافتين في ميزانية واحدة. لا ندعي أن كل upstream يفتقد حدودًا كافية.
8. **ABI لا يُستنتج من الاسم**: Anime4Up يطلب Activity، AnimeRift/WitAnime يطلبان base OkHttp client، وتواقيع Kotlin default/suspend جزء فعلي من التوافق. هذه مطالب مثبتة من metadata الأربع. لم تُنفذ بعد في profile Android.

## حدود التغطية الحالية

قُرئ implementation loader/manager/repository/source/network/cookie/preference ذو الصلة، والعقود العامة MainAPI/ExtractorApi وHttpSource/AnimeHttpSource. ملفات الواجهة والمشغل والترجمة وتفاصيل كل scraper ليست مراجعة شاملة في هذه الدفعة. قراءة 96KB من MainAPI لا تعني تنفيذ كل API فيها؛ API_REQUIREMENTS يسجل مطالب الحزم المحددة، بينما تنفيذ العائلات ما زال بوابة قبول مستقلة.

## الترخيص والمنشأ

المحرك الجديد مؤلف لفانتارا. لا ملفات أو دوال تنفيذ upstream ولا ملفات CS3 مضمّنة في Git. CloudStream يعلن GPL-3.0؛ لم يُنقل تنفيذه. Aniyomi/Mihon يعلنان Apache-2.0، لكن لم يُنسخ تنفيذهما في هذه الدفعة أيضًا. استخدام اعتماد MIT/BSD/Apache لاحقًا يتطلب تسجيل الإصدار والرخصة وإشعاراتها؛ اسم المستودع أو كونه عامًا لا يكفي. لا ادعاء قانوني بأن فحص ABI يحسم جميع مسائل الترخيص.

نطاق الاعتماديات الجديدة: RuntimeProvider والمضيف مؤلفان لفانتارا ويستخدمان Android/JDK فقط. AndroidX Test 1.6.2 وandroidx.test.ext:junit 1.2.1 للاختبارات ويعلنان Apache-2.0؛ الأخير يجلب junit:junit:4.13.2 بترخيص **EPL-1.0** وفق POM المنشور، فلا يصح وصف جميع اعتماديات الاختبار بأنها permissive. JUnit لا يدخل runtime/حزمة المضيف؛ لم يُنسخ كوده في ملفاتنا ولم تُنشر حزمة الاختبار. Gradle/AGP أدوات بناء. لا شحن لمحرك طرف ثالث في التطبيق، ولا تغيير لتراخيص الاعتماديات القائمة لفانتارا.


## متابعة عقود الوراثة واعتماديات الشبكة

تحليل تعريفات class_data في DEX كشف أن الحزم الأربع تستدعي registerMainAPI بمرجع يملك اسم صنف الإضافة، مع أن التنفيذ موروث من Plugin. مجرد استبعاد المراجع التي يملكها صنف داخل الحزمة يفوّت مطلب ABI هذا. الفاحص الموسع يجمع تعريفات الحزمة كلها، ويميز local declaration عن inherited host lookup. تعريف محلي لا يثبت قابلية التنفيذ (قد يكون abstract)، والـhost lookup لا يحدد الصنف المعرّف فعليًا حتى يُقرأ ملف المضيف. Reflection وصحة تعليمات DEX ليستا مثبتتين هنا.

[نسخة NiceHttp0.4.18](https://github.com/Blatzar/NiceHttp/tree/f1dee9dfc5b86a24c65bf8c6e8403d336341dd3e) المحددة في libs.versions.toml لـCloudStream تعلن GPL-3.0، وليست MIT. لم تُضف إلى الاعتماديات ولم يُنسخ تنفيذها. قرارنا تنفيذ شبكة متوافقة أصلية؛ لا تحويل البصمة أو الرخصة إلى وعد بأن مستودع GitHub محصّن من كل شكوى.
