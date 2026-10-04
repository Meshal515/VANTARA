# التغطية الفعلية — Addon Fabric 0.2.0

هذه مصفوفة تنفيذ واختبار، وليست إعلان اكتمال كل بنود SPEC. المواصفة وطلبات المالك محفوظة؛ «جزئي» يعني أن النتيجة المحددة أدناه فقط متوفرة.

| المتطلبات | الحالة والدليل |
|---|---|
| AF-01,02,04,18,40,41,45 | مسارات المصدر/القارئ الأصلية محفوظة؛ bundled/remote/Stremio عقود منفصلة. Kotlin/Aniyomi باقية؛ لا تشغيل APK داخل الويب. APK remote subtitles فقط. |
| AF-03,05,06,30–32,36,39 | اختبارات manifest المتداخل المعطوب، URL العام، configured secrets، credentials omit، رفض redirects، حدود parsing، منع torrents/localhost. لم تتوسع allowlist. |
| AF-07–10 | مدير ثابت بأيقونة puzzle وفلاتر محتوى/حالة، cards/details نصية، لا CSS عام؛ browser narrow/wide + tests. |
| AF-11 | placeholder نصي آمن وشعار المصدر الحالي في بطاقاته؛ تحميل وكاش logo خاص للإضافة مؤجل. |
| AF-12,13,17,20 | Source Mode المصدر وحده، capabilities/pagination/Back، Pin محلي للprofile؛ memo work identity يمنع خلط الفصل؛ tests. Genre عام غير مبني. |
| AF-14 | البحث داخل المصدر فقط مثبت. تجميع البحث العام لكل الإضافات بالهوية لم ينفذ. |
| AF-15,16 | IDs صريحة/namespace/provider copy/S/E محفوظة؛ لا title-only addon merge. mapping الأنمي الخارجي غير المخمّن؛ metadata غير المتاحة تبقى null. |
| AF-19 | Source Copy مقصودة والرجوع لنفس المصدر/scroll. زر «عرض جميع المصادر» من المصدر المقصود لم ينفذ. |
| AF-21–25,28,38,44 | stream normalization/4K/1440/HLS مستويات، progressive Ready/no autoplay/user choice، invalid/empty/expiry. browser controlled frame مثبت؛ upstream compatibility headers/CORS/torrent/DASH ليست مضمونة. |
| AF-26,27,33 | scheduler3→6/per-origin3، cancel/late guards، health per capability/runtime وp50/p95 وcooldown/retry، أسباب الفشل. الصحة تعني response فعلية وليس frame مؤكدة لكل مصدر. |
| AF-29 | تحقق/حظر المضيف لا يحول إلى Ready؛ Remote v1 verification غير مدعوم؛ لا تجاوز Cloudflare أو نقل cookies عبر Worker. |
| AF-34,35 | version/input cache TTL، expiry معروف فقط للstreams، snapshot يمنع activation أثناء browser/reader/playback؛ staged permission preview/rollback. لا offline video proxy ولا LKG URL قديمة. |
| AF-37 | configured URL محفوظ محليًا ومخفي في القائمة/الرسائل. نموذج boolean/select/secret declarative عام لم ينفذ؛ يثبت المستخدم URL المزود المهيأة. |
| AF-42,43,46,47 | تشخيص capability/host/latency/reason، live8source audit وMentalist S01E01؛ متجر أولي built-ins وOpenSubtitles غير المثبت تلقائيًا، direct external media دون token/proxy عام. |
| AF-48 | أزمنة كل host وhealth مقاسة؛ فصل first Ready/all في fixtures. schema شاملة للpending/aborted/cold TTFR لكل جلسة في UI لم تنفذ؛ audit التسلسلي ليس TTFR. |
| ST-01–09,11,12 | PWA source/addon/off/Arabic/generation/failure/no-auto tests + ملف عربي حقيقي ظاهر. APK نفس التصميم الوظيفي عبر native؛ Continuity الفعلية وembedded captions على الجهاز غير مختبرتين. لا AI/editor/delay الآن. |
| ST-10 | Provider OpenSubtitles حقيقي وملفه ظهر في PWA. APK compile/unit فقط؛ لم يُثبت تنزيله وتشغيله على هاتف. |

T1/T2/T3/T4/T5/T6 مسارات usable ضمن حدود v1 أعلاه. T0 وT7 وT8 بها حدود تحقق معلنة. تفاصيل الاختبارات والمصادر والقرارات في [التقرير](IMPLEMENTATION-REPORT.md).
