# بحث التكامل: المستودع والبروتوكولات والأدلة الحية

التاريخ: 2026-10-03. هذا بحث وخطة، وليس ادعاء تنفيذ Addon Fabric.

## المشغل الموجود فعلًا

- APK: `android/app/src/main/kotlin/com/vantara/anime/stream/Streams.kt` يحتوي `Candidate.subtitles: List<TrackRef>`. `PlayerActivity.kt:start` يمررها إلى `MediaItem.SubtitleConfiguration`، و`showSubtitles` يختار مجموعات `C.TRACK_TYPE_TEXT`. يوجد زر ترجمة مستقل في صف الأدوات وزر المزيد. لا يحتاج إعادة بناء المشغل.
- رسالة APK الحالية عند غياب text groups تقول «الترجمة مدمجة في الفيديو». هذا استنتاج غير مضمون من غياب track؛ المطلوب عند الحاجة «لا توجد ترجمة منفصلة لهذا الفيديو».
- PWA: `pwa/player/player.js:showMore` لا يملك مدخل ترجمة. بناء المرشح في `pwa/bridges/anime.js` لا ينقل `subtitles` رغم أن APK يحفظها. توجد أوراق `openSheet/sheetRow` مناسبة لإعادة الاستخدام دون تغيير صف الأدوات أو CSS.
- مكتبة الويب الحالية `vendor/hls.light.min.js` هي hls.js 1.6.15 light. البناء الخفيف يستبعد alternate audio/subtitles؛ قائمة وهمية فوقه لن تضيف دعم HLS soft subtitles. يلزم full build من **نفس الإصدار** فقط عند تنفيذ الربط، مع الرخصة والبصمة واختبار تشغيل.

## المصادر الخارجية المستعملة

1. [بروتوكول Stremio الرسمي](https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/protocol.md): JSON resources عبر HTTPS، CORS، manifest، catalogs/meta/stream/subtitles. لا يحدد عقد manga chapters/pages.
2. [عقد الترجمة الرسمي](https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/api/responses/subtitles.md): id/url/lang، label اختياري. URLs `127.0.0.1:11470` تعتمد streaming server خاص Stremio؛ لا تعمل بمجرد قبول manifest في PWA.
3. [طلب الترجمة الرسمي](https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/api/requests/defineSubtitlesHandler.md): video ID، extra filename/videoHash/videoSize. هذا المرجع أكثر تحديدًا من شرح protocol العام القديم الذي يذكر hash كـid؛ نتبع الطلب الحالي ونختبر endpoint حقيقية.
4. [مثال Stremio الرسمي](https://github.com/Stremio/addon-helloworld/blob/master/addon.js): streams بعضها URL وبعضها infoHash/fileIdx. وجود stream في JSON لا يعني browser playback.
5. [Keiyoushi extensions](https://github.com/keiyoushi/extensions-source) و[مثال MangaDex](https://github.com/keiyoushi/extensions-source/blob/main/src/all/mangadex/src/eu/kanade/tachiyomi/extension/all/mangadex/MangaDex.kt): Kotlin/Android/OkHttp وإعدادات native. لا ننسخ APK أو ننفذ كوده داخل صفحة PWA. محركات VANTARA الحالية هي baseline ويب صالح؛ remote manga API عقد آخر.
6. [Stremio Community Subtitles](https://github.com/skoruppa/stremio-community-subtitles): OpenSubtitles/SubDL/Subsource تحتاج إعداد/مفاتيح في هذا المشروع. ذكر الاسم لا يثبت أنه Provider جاهز تلقائيًا؛ لا استعمال لمفاتيح المستخدم أو أسرار الآخرين.
7. [hls.js 1.6.15](https://github.com/video-dev/hls.js/blob/v1.6.15/README.md): light يستبعد subtitles وalternate audio.
8. [إرشادات hls.js الحالية](https://github.com/video-dev/hls.js#embedding-hlsjs): Chrome قد يعيد `canPlayType('application/vnd.apple.mpegurl') == 'maybe'` ثم لا يشغل بعض streams؛ التوصية Hls.isSupported أولًا، مع الحفاظ على native عندما يلزم. يلزم إثبات قبل تغيير transport.

راجعت هذه المراجع مباشرة من GitHub واستعملت Context7 لبروتوكول Stremio وhls.js، وFirecrawl للعثور على مستودعات providers. لا product dependency جديدة في مرحلة البحث. أي كود خارجي يُختار لاحقًا يراجع الإصدار والرخصة ولا يُنسخ من مقتطف بحث وحده.

## Provider حقيقي اختُبر

`https://opensubtitles-v3.strem.io/manifest.json` أعاد `org.stremio.opensubtitlesv3`، الإصدار 1.0.0، resource subtitles، movie/series، idPrefixes tt.

طلب `series` بمعرف **`tt1196946:1:1`** لـThe Mentalist S01E01 أعاد **87 نتيجة**، منها **4 بالعربية**. تنزيل ملف عربي من `subs5.strem.io` نجح: **58,797 بايتًا**، وتوقيت SRT صالح مبدئيًا (`00:00:09,660 --> 00:00:12,040`). SHA-256: `5fbba9f34112fb1381be89e4e89f841784106a62335369121ba6e65bfb356c57`.

هذا دليل provider وملف حقيقي، وليس إثبات exact release match أو توقيته مع فيديو المضيف، ولا إثبات ظهور الترجمة في مشغل VANTARA بعد. لم يثبت شيء تلقائيًا على حساب المستخدم. URLs الفردية الموقعة لا تدخل التقرير أو السجلات العامة.

## The Mentalist S01E01: مواضع الاختبار

الفحص المباشر المحدث عبر محركات PWA الحالية: EgyDead وجد الموسم الأول و23 حلقة و4 سيرفرات. StreamHG استخرج HLS في 1073ms؛ EarnVids في 721ms؛ Mixdrop رسالة حذف صريحة؛ DoodStream صفر streams. الأخيرة فشل وليست نجاحًا.

فحص سابق لـStreamHG master أثبت جودات 480/720/1080، لكن مرشح المصدر يعرض جودة غير محددة. هذا نقص metadata يمكن إصلاحه باستخراج multivariant مؤكد، دون اختراع جودة.

في Chromium 151 من بيئة التطوير عبر proxy: النقل الأصلي يعلن `maybe` لكن بعد 19 ثانية لم يصل metadata؛ تجربة مؤقتة تستخدم MSE/hls.js قرأت مدة 2709.133 ثانية، لكنها لم تثبت frame أو تشغيلًا فعليًا خلال نافذة الفحص. لذلك لم يُغيّر كود المشغل، ولم يُعلن أن هذه وحدها سبب مشكلة المستخدم. يلزم controlled fixture ثم اختبار إنتاج عبر الجالب ومقارنة direct/edge، وتسجيل المرحلة الفاشلة دون signed URLs.

الفحوص الحية من هذه البيئة لا تعادل شبكة المستخدم أو Cloudflare Worker. مشكلة المضيف المحذوف لا تُعالج بتغيير استخراج تخميني؛ أما transport أو proxy أو headers أو إسقاط tracks عندنا فيحتاج regression واختبار قبل/بعد.

## baseline محفوظ

23 اختبارًا ناجحًا: player، chapter cache، PWA update، progressive resolution. لم يتغير product code بهذا البحث. APK known-good: Akwam/WitAnime؛ PWA known-good: Akwam/EgyDead StreamHG/EarnVids تحتاج إعادة اختبار تشغيل فعلية عند تنفيذ T0/T6.

## أدلة إضافية بعد كتابة الخطة

- Chromium على أصل الإنتاج `https://vantara-bcf.pages.dev` جلب manifest ونتائج OpenSubtitles وملف SRT العربي بـ`credentials: omit`: 87 نتيجة،4 عربية،HTTP200 للملف. CORS صالح لهذا Provider دون جالب فيديو أو token فانتارا. بقي اختبار اختيار الترجمة داخل player شرطًا قبل ادعاء تنفيذ الربط.
- fixture HLS حقيقية مولدة بـffmpeg (H.264/AAC،320×180،48 ثانية) اشتغلت بالطريقين في Chromium151: native وصل readyState4 وcurrentTime17.66، وMSE وصل readyState4 وcurrentTime4.60 ضمن نافذتيهما. لا دليل أن native HLS معطل بالكامل؛ لا تعديل transport من هذه الفرضية وحدها.
- master StreamHG الحي أعاد HTTP200 و`application/vnd.apple.mpegurl` وCORS `*`، وثلاثة streams H.264/AAC بدقات480/720/1080. قراءة master تبقى أقل من إثبات تنزيل segment وتشغيل frame.
