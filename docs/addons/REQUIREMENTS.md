# متطلبات VANTARA Addon Fabric

التاريخ: 2026-10-03. الأساس: `ffeb20c1835f9a9db707d9e6e73d501a12ac8c22`.

المواصفة: [SPEC.md](SPEC.md). طلب المالك اللاحق هو المرجع عند التعارض: الإضافات تخدم كل الأقسام، وخانتها ثابتة بأيقونة SVG قطعة أحجية، وCSS فانتارا محفوظ، وربط الترجمة صغير ومبني على Provider حقيقي. اعتماد المواصفة في المحادثة لا يعني أن التنفيذ أو اختبارات الجهاز تمت. الخطة التنفيذية الجديدة تحتاج مراجعة بحسب بند 63 من المواصفة.

## متطلبات قابلة للتحقق

| المعرف | المتطلب ومعيار القبول | مهمة الخطة |
|---|---|---|
| AF-01 | استمرار المصادر والقارئ والمشغل الأصليين مع صفر إضافات خارجية أو تعطلها كلها؛ لا حذف Aniyomi | T1,T4,T8 |
| AF-02 | عقود منفصلة للمانجا، الفيديو، البيانات، الترجمات، المضيفات؛ الإعلان عن القدرة لا يمنح قدرات أخرى | T1 |
| AF-03 | Manifest بهوية/إصدار/بروتوكول/runtime/قدرات/صلاحيات وأنواع؛ رفض بيانات ناقصة أو معطوبة أو إصدار غير مدعوم | T1 |
| AF-04 | قبول remote API وStremio وbundled adapters فقط في PWA؛ لا eval أو script بعيد أو تحميل APK للتنفيذ في المتصفح | T1,T2 |
| AF-05 | درجات رسمي/مجتمع موثوق/مجتمع/يدوي تأتي من provenance مملوك للتطبيق؛ لا يستطيع manifest إعلان نفسه رسميًا | T1,T2 |
| AF-06 | تثبيت URL بعد معاينة الاسم والقدرات والنطاقات والصلاحيات؛ لا تثبيت إضافات المستخدم تلقائيًا | T2,T3 |
| AF-07 | مدير واحد ثابت باسم «الإضافات» وأيقونة قطعة أحجية SVG؛ لا يتبدل حسب قسم التطبيق | T3 |
| AF-08 | فلاتر واضحة: الكل/المانجا/الأنمي/السينما/الترجمات، ثم المثبتة/المتاحة/تحتاج تحقق/معطلة/تحتاج تحديث | T3 |
| AF-09 | بطاقة تعرض الاسم والمنصة واللغة والإصدار وحالة نصية وآخر نجاح؛ اللون لا يكفي؛ لا نسبة نجاح مصطنعة | T3 |
| AF-10 | تصميم البطاقات والأوراق والصف والألوان من أنماط فانتارا الحالية؛ لا تغيير CSS عام أو إعادة تصميم | T3,T6,T7 |
| AF-11 | شعار manifest أو نفس نطاق المصدر أو placeholder نصي؛ كاش الشعار؛ لا بحث عشوائي عن صورة | T2,T3 |
| AF-12 | Source Mode يعرض بيانات المصدر داخل بطاقات وتفاصيل فانتارا؛ لا iframe لموقع المصدر | T4 |
| AF-13 | home sections بحسب القدرات الفعلية، ثم latest/popular/search إن توفرت؛ لا تبويبات لا يدعمها المصدر | T4 |
| AF-14 | البحث داخل المصدر يطلب هذا المصدر فقط؛ البحث العام يجمع تدريجيًا بالهوية، ويحفظ provenance | T4,T5 |
| AF-15 | معرّفات IMDb/TMDB أو AniList/MAL/MangaDex الصريحة ونوع العمل أساس الربط؛ لا دمج بالعنوان فقط | T5 |
| AF-16 | هوية الأنمي تحفظ الموسم/Part/Format/النوع/الحلقة والرقم المطلق إن ثبت؛ لا خلط Movie/TV/Special | T5 |
| AF-17 | هوية الفصل تضم سياق العمل والمصدر والعمل بالمصدر والفصل والمجلد وmemo؛ لا تراجع لإصلاح chapter-1 | T4,T8 |
| AF-18 | Source Copy منفصلة عن العمل الأصلي؛ تثبيت/إزالة الإضافة لا يحذف العمل أو المكتبة أو التقدم | T4,T5 |
| AF-19 | Source Mode يرتب مصدره أولًا ويتيح «عرض جميع المصادر» ضمن العمل؛ الرجوع يستعيد المصدر وscroll/tab/filter | T4 |
| AF-20 | Pin وترتيب مستقر محليان للملف الشخصي الحالي؛ لا إعادة ترتيب مرئية كل ثانية | T3,T4 |
| AF-21 | عرض Streams حقيقية مع source/host/container/codec/quality/expiry وmetadata المتوفرة فقط؛ المجهول null | T5 |
| AF-22 | المحافظة على 2160p/1440p/1080p وغيرها إن ثبتت؛ لا تحويل كل جودة عالية إلى 1080p أو اختراع HDR | T0,T5 |
| AF-23 | HLS multivariant يعرض جوداته الفعلية دون انتظار فحص كل نسخة؛ وقت أول Ready منفصل عن الاكتمال | T0,T5 |
| AF-24 | أول Ready يظهر فورًا؛ الفشل والبطء لا يحجبانه؛ لا تشغيل تلقائي أو تغيير اختيار البداية | T5,T8 |
| AF-25 | ترتيب النتائج ترشيح فقط؛ تفضيلات عربي/جودة/سرعة/استهلاك لا تختار بدل المستخدم | T5 |
| AF-26 | 100 إضافة مثبتة لا تطلق 100 طلب فورًا؛ سقف توازٍ وإلغاء وbudget وrequestId وحراسة النتائج المتأخرة | T2,T5 |
| AF-27 | صحة منفصلة لكل قدرة: النجاح/الفشل/الفارغ/invalid/timeout/p50/p95 وآخر نتيجة؛ البحث ليس دليل تشغيل | T1,T2 |
| AF-28 | circuit breaker بحدود معلنة مع retry يدوي؛ verified playback وحده يثبت تشغيل المصدر؛ صفر streams = RESOLVER_EMPTY | T2,T5 |
| AF-29 | Cloudflare/CAPTCHA = NEEDS_VERIFICATION؛ لا bypass آلي؛ PWA لا يدعي نقل cookie تبويب الموقع إلى Worker | T2,T4 |
| AF-30 | جلسات وإعدادات وكاش كل إضافة معزولة؛ لا token/هوية فانتارا أو cookies إضافة أخرى في طلبها | T2,T7 |
| AF-31 | URLs عامة آمنة فقط؛ رفض IP/localhost/private/link-local/metadata/credentials/redirect escape؛ اختبار DNS rebinding قبل أي proxy جديد | T2 |
| AF-32 | لا توسيع allowlist جالب المصادر بشكل عالمي لتمكين الإضافات؛ redirects مقيدة بالنطاقات المصرح بها | T2 |
| AF-33 | حالات READY/RESOLVING/UNAVAILABLE/NEEDS_VERIFICATION/RATE_LIMITED/COOLDOWN/BROKEN/DISABLED/UPDATE_REQUIRED/UNSUPPORTED مع سبب واضح | T1,T3,T5 |
| AF-34 | طبقات TTL منفصلة للmanifest/logo/home/catalog/search/meta/chapters/episodes/streams/subtitles؛ لا Ready لرابط منتهي | T2,T5 |
| AF-35 | LKG يحفظ المسار لا رابطًا منتهيًا؛ staged update لا يبدل adapter لجلسة قائمة، وrollback عندما يدعمه نوع الإضافة | T2,T8 |
| AF-36 | domain aliases تحتاج manifest موثوقًا أو دليلًا حيًا؛ redirect إعلان لا يمنح الثقة | T2,T0 |
| AF-37 | إعدادات declarative من boolean/select/multiselect/number/text/secret؛ لا HTML خارجي؛ أسرار config URLs تُحجب من السجل | T2,T3 |
| AF-38 | Stremio adapter مستقل: catalog/meta/stream/subtitles مع types/idPrefixes/extra/config؛ Full/Partial/Unsupported صادقة | T5 |
| AF-39 | infoHash/magnet/fileIdx وlocalhost streaming server لا تُصنف Ready في PWA؛ لا تنفيذ torrent أو فتح externalUrl تلقائيًا | T5 |
| AF-40 | لا تدعي أن إضافة Stremio مانجا: لا chapters/pages في البروتوكول القياسي؛ manga remote API أو bundled adapter أو runtime أصلي | T4,T5,T7 |
| AF-41 | Host Resolver Hub الحالي يُعاد استخدامه؛ لا resolver جديد لكل مصدر | T0,T4,T5 |
| AF-42 | تشخيص مفهوم مع مضيف/قدرة/إصدار/latency/سبب؛ retry/cache/session/update/disable/remove منفصلة؛ لا URL فيديو كامل أو cookies أو أسرار | T2,T3,T8 |
| AF-43 | فشل المصدر نفسه يُفصل عن خطأ الاستخراج/التوافق/الشبكة؛ The Mentalist S01E01 حالة رجوع إلزامية لـPWA | T0,T8 |
| AF-44 | تبديل الفيديو/المصدر لا يقفز لعمل أو موسم أو حلقة مختلفة؛ failover يحافظ على قواعده المعروفة والتقدم | T5,T6,T7 |
| AF-45 | APK يبقى Kotlin/OkHttp/Media3 وAniyomi؛ PWA runtime مستقل؛ لا فرض تشغيل مصادر APK عبر JS | T7 |
| AF-46 | Worker للبيانات الحساسة لـCORS عند الضرورة فقط، وليس proxy شاملًا للفيديو؛ direct-first الحالي لا يتغير تخمينيًا | T0,T2 |
| AF-47 | Store أولي يعرض إضافات مجرّبة مع compatibility/provenance، وليس Marketplace أو أعدادًا وهمية | T3,T8 |
| AF-48 | لكل نتيجة timed metrics أول بحث/أول Ready/الكل/pending/aborted؛ فصل التحقق الآلي عن التشغيل الفعلي وجهاز المستخدم | T0,T2,T8 |

## متطلبات الترجمات المحافظة

| المعرف | معيار القبول | مهمة |
|---|---|---|
| ST-01 | hard sub جزء من الصورة، لا Track ولا زر إيقاف/تحريك مزيف؛ صوت عربي لا يعني ترجمة | T6,T7 |
| ST-02 | source/embedded soft tracks تظهر فور اكتشافها وتعمل دون Subtitle Addon | T6,T7 |
| ST-03 | قسم «ترجمات إضافية» لا يوجد دون Provider Enabled ونجاح قدرة subtitles فعليًا؛ لا قائمة فارغة أو spinner دائم | T6,T7 |
| ST-04 | playback لا ينتظر subtitle discovery أو download أو provider failure؛ كل نتيجة تظهر تدريجيًا | T6,T7 |
| ST-05 | APK يستعمل زر الترجمة الحالي؛ PWA يستعمل ⋮ المزيد؛ ورقة واحدة بها إيقاف ثم من الفيديو ثم من الإضافات | T6,T7 |
| ST-06 | تطابق بالcanonical IDs/season/episode/filename/release/duration/fps/hash عند توفرها؛ العنوان وحده غير كافٍ | T5,T6,T7 |
| ST-07 | العربية الأصلية أولًا، ثم العربية الإضافية المثبتة exact، ثم البقية؛ لا تشغيل external subtitle عشوائيًا | T6,T7 |
| ST-08 | source tracks تُنظف عند تبديل السيرفر؛ addon tracks يعاد التحقق من مطابقتها للإصدار/duration؛ إلغاء late results | T6,T7 |
| ST-09 | ملفات SRT/VTT تعمل مع حدود الحجم والتوقيت؛ ASS/SSA غير المدعومة تصنف بوضوح دون ادعاء دعم styling كامل | T6,T7 |
| ST-10 | تنزيل ترجمات عامة حقيقية من OpenSubtitles v3 واختيارها في المشغل الفعلي قبل ادعاء اكتمال الربط | T6,T7,T8 |
| ST-11 | لا autoplay أو تبديل server/quality بسبب نتيجة ترجمة؛ فشل provider لا يفتح failover | T6,T7,T8 |
| ST-12 | لا AI/auto translation أو editor أو positioning أو إعادة تصميم المشغل. طلب توقيت الترجمة السابق يؤجل لمرحلة منفصلة صغيرة بعد ربط providers | T6,T7 |

## قرارات تنفيذية مقترحة، قابلة للتصحيح من المالك

- احترام تعديل المالك للبندين 7 و9: خانة إضافات عالمية واحدة؛ المصادر والفلاتر داخل صفحة الإضافات وSource Mode، دون sidebar ثاني أو rail جديد في كل قسم.
- فتح بطاقة الإضافة يعرض تفاصيلها؛ زر «فتح المصدر» يدخل Source Mode. اسم الإضافة الأصلي محفوظ ووسم البروتوكول ثانوي.
- شاشة المستخدم تعرض السبب وآخر نجاح وحالة نصية؛ الأزمنة والتفاصيل داخل التشخيص.
- الترتيب اليدوي والـPin مستقران؛ health يؤثر على scheduler الداخلي فقط. Pin محلي للـprofile، لا تعديل جدول تفضيلات المزامنة.
- تثبيت URL يدوي متاح مع معاينة وصلاحيات، وتسمية ثقة «يدوي». لا ترقية إلى موثوق لمجرد نجاح manifest.
- لا إضافة remote JS أو محرك torrent أو عملية AI، ولا تغيير الحسابات أو schema المكتبة/التقدم.

## ملاحظة تقنية لازمة للمواصفة

حل تحقق Cloudflare في تبويب مصدر على PWA لا يمنح Worker cookie المستخدم ولا يغير IP/بيئة التحقق. لا نبني زرًا يعد بهذا التحويل. إذا لم توفر جهة المصدر API أو مسار browser-compatible، الحالة Browser-dependent/NEEDS_VERIFICATION أو PLATFORM_UNSUPPORTED مع سبب واضح. APK يحتفظ بWebView ومساره الأصلي. بروتوكول Stremio وحده لا يضمن 4K ولا فك DRM/codec/torrent على الجهاز.
