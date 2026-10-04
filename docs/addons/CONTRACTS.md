# عقود Addon Fabric v1

الإضافة بيانات HTTP JSON وليست كودًا. لا eval/iframe ولا تنفيذ APK داخل PWA.

## Manifest

Remote VANTARA v1: `id,name,version,protocolVersion:1,minVantaraVersion,runtime:remote,contentTypes,capabilities,permissions,baseUrl,resources`.
`baseUrl` HTTPS من أصل manifest نفسه. `resources` capability→مسار يبدأ `/`؛ المتغيرات المسموحة فقط `{workId,chapterId,page,query}` وتُرمّز كقيم. لا wildcard hosts. التحقق التفاعلي قدرة غير مدعومة في v1، وليس نجاحًا مزيفًا.
Stremio: `id,name,version,types,resources,catalogs`؛ resource نص أو `{name,types,idPrefixes}`. يحافظ adapter على configured URL وextraArgs وفق البروتوكول.
الأصل+manifest id يحددان الإضافة؛ trust الرسمي يأتي من التطبيق، لا من manifest.

## الموارد

- home/search: `{mangas:[{id,url,title,thumbnail}],hasNextPage}` للمانجا؛ `{items:[{id,title,url,thumbnail,type,externalIds}],hasNextPage}` للفيديو.
- details: `{manga,chapters}` أو `{item,episodes}`؛ الهوية الخارجية الصريحة فقط تربط النسخ، ولا دمج بالعنوان.
- chapters: `{chapters:[{url,name,number,memo,volume}]}`. pages: `{pages:[{index,url,imageUrl}]}`. يحفظ memo/source work الهوية دون تغيير تقدم القراءة.
- episodes: `{episodes:[{id,url,name,number,season}]}`.
- streams: `{streams:[{url,type,quality,headers,subtitles,audio,expiresAt,filename,duration,fps}]}`. جودة غير معلنة `null`؛ لا تورنت أو localhost جاهز في PWA.
- subtitles: `{subtitles:[{id,url,lang,label,format,release,match}]}`. subtitle match المعلن ليس إثباتًا exact؛ الترجمة المحروقة والصوت ليسا Text Tracks.
- Stremio يحافظ على `metas/meta/videos/streams/subtitles` القياسية ثم يطبّع عند الحد فقط.

## الحدود والهوية

1000 عنصر لكل response، manifest256KiB، resource/file2MiB. namespace مستقل movie/series/anime/manga مع الموسم وPart؛ provider-local عندما لا توجد external ID موثقة.
Configured URL قد تحتوي سرًا؛ تحفظ محليًا ولا تعرض في label/log. لا إرسال token/cookies VANTARA للإضافة. الطلب direct CORS وGET فقط؛ redirect يُرفض في نقل الإضافة؛ لا follow تلقائي ولا proxy جديد.
الكاش منفصل بإضافة+capability+هوية input، والstream المنتهي لا يبقى Ready. snapshot جلسة يعزل تحديث manifest حتى release.


## حدود runtime v1

PWA: الملفات العامة direct CORS فقط، بلا auth/cookies فانتارا ولا edge allowlist خاصة المصادر. HTTP headers المطلوبة/Torrent/localhost/externalUrl/DASH لا تُصنّف Ready. MIME/type المعلن محفوظ، HLS جوداته من RESOLUTION الحقيقية، لا رفع جودة وهمي.

APK: مصادر Kotlin/Aniyomi باقية في محركها؛ مدير الإضافات يشغل حاليًا Stremio subtitles فقط عبر AddonEnginePlugin، وشبكته مشتقة من native DoH/IPv4+IPv6 بلا source cookies/interceptors. بقية remote capabilities ظاهرة كغير مدعومة في APK، دون fallback لتنفيذ JS native sources.

الفصل remote يحمل memo JSON فيه addonWorkId وproviderMemo؛ cache version/input يميز work+season+episode. Source Mode وقارئه والمشغل يحتفظون بقفل snapshot إلى نهاية الجلسة، فلا activate/reinstall أثناء الاستخدام. تثبيت providers لا ينشئ تغييرًا في library/progress schemas.

Provider subtitles مجهول الصحة يُفحص في الخلفية بعد اختيار stream؛ UI إضافية لا تصبح مرئية بسبب manifest وحده. result فعلية أو provider ذو نجاح سابق يسمح بقائمة finite؛ فشل provider لا يستدعي failover/play. source soft tracks مستقلة، hardcoded/audio لا ينتجان tracks.
