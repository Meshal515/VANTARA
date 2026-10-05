# تصميم VANTARA Translation V2 — السرعة، التبييض، والـLettering

التاريخ: 2026-10-05  
الفرع: `chatgpt/translation-v2-lettering-performance`  
الأساس: `c89a7459ff4fc79a5d1b51c8225ac7260470312d`

## 1. الهدف

تحويل ترجمة VANTARA من مسار ثقيل على مستوى الصفحة إلى محرّك هجين على مستوى كل منطقة، مع الحفاظ على جودة التبييض الصعب وإضافة Lettering عربي حقيقي بدل خط واحد للفصل كله.

مقياس النجاح الأساسي على Galaxy S23 Ultra:
- صفحة بلا نص: هدف تفاعلي أقل من 1 ثانية بعد تسخين RT-DETR، من دون انتظار CTD/LaMa لصفحات أخرى.
- الفقاعة المسطحة السهلة: لا CTD ولا BubbleSeg ولا LaMa، وهدف محلي 1–3 ثوانٍ أو أقل.
- المنطقة الصعبة فوق الرسم: تُرسل وحدها إلى المسار الثقيل، لا الصفحة كاملة.
- فصل 20–30 صفحة أغلبه حوار عادي: هدف تجريبي 30–45 ثانية مع prefetch، وليس وعدًا قبل قياس الجهاز.
- أي تسريع يفشل بوابة الجودة يعود للمسار الثقيل تلقائيًا.

## 2. العلل المؤكدة من القياس الحالي

1. تقرير 0.0.113 أظهر `fast 0 / heavy 14`: القرار الحالي «الصفحة كلها سهلة أو كلها ثقيلة» محافظ زيادة؛ منطقة صعبة واحدة تُسقط الصفحة كلها للمسار الثقيل.
2. CTD يستهلك عادة 15–30 ثانية على الجهاز. المسار المرجعي في `manga-image-translator` وثّق أن `cv2.dnn` أسرع 4–5 مرات من CPU backend السابق لنفس CTD، بينما Android الحالي يشغله عبر ORT/XNNPACK.
3. BubbleSeg يضيف عادة 16–28 ثانية حين يُشغّل على صفوف كثيرة.
4. LaMa على Android يحد القطعة عند 1024px؛ مرجع Python في المستودع يستخدم 1536px. هذا فرق فعلي يفسر تراجع تفاصيل الخلفيات المعقدة الكبيرة.
5. `fullRes` يمكن أن يحتجز الطابور طويلًا جدًا؛ ظهر outlier قدره ~6116 ثانية وأوقف الصفحات التالية.
6. بعض النص الإنجليزي المتبقي في الصور لم يُمسح أصلًا، ما يشير إلى region/detection omission لا إلى LaMa وحده.
7. Luna حاليًا لا تملك عقد Lettering؛ النتيجة كلها تقريبًا Baloo Bhaijaan 2 بنفس اللون/الوزن.
8. لا توجد قاعدة صارمة لـ`God`، لذلك قد تظهر «إله/رب/آلهة»، وهذا مرفوض حسب متطلبات المنتج.

## 3. المعمارية المختارة

### 3.1 قرار Fast / Heavy لكل Region

بعد RT-DETR:
- كل `text_bubble` يبحث عن الفقاعة المطابقة.
- إذا الخلفية داخل الفقاعة متجانسة، والنص محتوى جيدًا، وقناع الحبر الحسابي نظيف، والمنطقة ليست text_free: تُوسم `fast-flat`.
- أي منطقة لا تجتاز الشروط تُوسم `heavy`.

لا نرجع للمسار الثقيل للصفحة كلها. بدل ذلك:
- المناطق `fast-flat`: قناع محلي + OCR مباشرة.
- المناطق `heavy`: CTD/BubbleSeg فقط على صفوف/ROI المطلوبة.
- تُدمج المناطق بعدها في Analysis واحدة قبل Luna.

الهدف: صفحة فيها 8 فقاعات عادية و2 نص فوق رسم تدفع ثمن CTD/BubbleSeg للمنطقتين فقط.

### 3.2 CTD execution

نحافظ على ORT كمسار مضمون، ونضيف تجربة Backend قابلة للقياس:
- XNNPACK/CPU الحالي.
- NNAPI على الأجهزة المدعومة، لكل نموذج مستقل، مع fallback تلقائي إذا فشل أو قسّم الرسم البياني بشكل يبطئه.
- OpenCV DNN لا يُعتمد تلقائيًا قبل قياس حجم APK والأداء على arm64. إن كان NNAPI لا يحقق مكسبًا كافيًا، يكون OpenCV DNN الخيار التالي لأنه المرجع الخارجي أثبت فرقًا 4–5x لهذا CTD.

يجب ألا نختار backend بالاسم؛ نختاره بقياس حقيقي على الجهاز ومقارنة المخرجات.

### 3.3 LaMa

على S23 Ultra وما يماثله:
- `MAX_EDGE = 1536` للخلفيات الصعبة متى كان crop تحت حد الذاكرة.
- fallback إلى 1024 عند حرارة/ذاكرة مرتفعة أو crop كبير جدًا.
- يظل LaMa على crop حول المنطقة فقط.
- لا يُستدعى للفقاعة المسطحة.

### 3.4 Full-resolution

الفصل بين «إظهار الترجمة» و«ترقية full-res»:
- نتيجة analysis-resolution تُعرض أولًا إذا كانت آمنة ومرئية.
- full-res refinement يعمل بأولوية أدنى ولا يحجز ترجمة بقية الفصل.
- حد زمني/حراسة تمنع حالة الساعات من احتجاز PriorityGate.
- عند التعليق أو تجاوز الحد، تبقى النسخة السريعة بدل إرجاع الإنجليزية.

## 4. كشف بقايا الإنجليزية

بعد التبييض والرسم:
- فحص محلي رخيص داخل الصناديق المعروفة فقط، لا OCR كامل للصفحة.
- إذا بقي حبر لاتيني واضح في منطقة supposed translated:
  - نعيد بناء القناع لتلك المنطقة فقط.
  - إن كانت fast region نرفعها إلى heavy region.
  - لا نعيد الصفحة كلها.
- التقرير يسجل `residualLatin`, `promotedToHeavy`, `secondPass`.

## 5. قاعدة God الصارمة

متطلب غير قابل للتفاوض:
- `God / god` → **حاكم** أو **ملك** فقط.
- `Gods / gods` → **حكام** أو **ملوك** فقط.
- ممنوع في الناتج لهذه المصادر: `إله، الإله، رب، الرب، آلهة، الآلهة`.

التنفيذ دفاعي على طبقتين:
1. تعليمات Luna: تختار بين حاكم/ملك حسب سياق العمل والرتبة.
2. Validator بعد الرد:
   - إذا المصدر يحوي `God(s)` والناتج يحوي لفظًا ممنوعًا، يُرفض region ويُعاد بطلب تصحيح موجّه.
   - إذا خالفت مرة ثانية، fallback حتمي إلى صياغة «حاكم/حكام» آمنة بدل عرض اللفظ الممنوع.

لا توجد قاعدة عامة تغيّر كلمات عربية من دون وجود `God(s)` في المصدر، لتفادي المساس بترجمة مستقلة.

## 6. Lettering V1 — 20 خطًا عربيًا

### 6.1 المبدأ

Luna لا تختار ملف TTF مباشرًا. ترجع **دورًا طباعيًا** من enum ثابت، والجوال يربطه بخط عربي OFL معروف.

الحزمة المقترحة، كلها من عائلات Google Fonts المفتوحة:
1. Baloo Bhaijaan 2
2. Cairo
3. Tajawal
4. Changa
5. Reem Kufi
6. Noto Sans Arabic
7. Noto Kufi Arabic
8. Noto Naskh Arabic
9. Amiri
10. Aref Ruqaa
11. Rakkas
12. Lemonada
13. El Messiri
14. Almarai
15. Beiruti
16. Playpen Sans Arabic
17. Harmattan
18. Markazi Text
19. Mada
20. Kufam

يُثبت كل ملف بمصدر وإصدار وSHA-256، وتُضمّن تراخيص OFL. لا يُنزّل خط متغير من الإنترنت وقت القراءة.

### 6.2 الأدوار

الأدوار الأساسية:
- neutral
- soft
- whisper
- thought
- narration
- formal
- regal
- ancient
- comic
- child
- rough
- threat
- villain
- shout
- scream
- impact
- mechanical
- sign
- title
- blood

Luna تختار role، لا اسم font. mapping يمكن تغييره لاحقًا بلا كسر cache schema.

### 6.3 اللون والتأكيد

كل Region ترجع:
- `fontRole`
- `ink`: `auto | black | white | crimson | blood | gold | blue | violet | gray`
- `intensity`: `quiet | normal | strong | extreme`
- حتى 3 `emphasis` spans، كل span يجب أن يطابق كلمات كاملة موجودة حرفيًا في العربية النهائية، ويحدد role/ink/scale/weight.

قواعد الجودة:
- default = auto/normal.
- لا لون ولا خط درامي لمجرد التنويع.
- أولوية قصوى لمحاكاة المصدر: إذا الأصل غيّر اللون/الحجم/الوزن، ننقل الإشارة.
- يجوز ابتكار لمسة درامية نادرة جدًا حين تكون اللحظة مفصلية بصريًا وسرديًا.
- `blood`: أحمر داكن + stroke أغمق + خط مخصص، ويُستخدم نادرًا؛ مناسب لجملة تهديد/صدمة/لحظة هيبة، لا للحوار العادي.
- لا يزيد emphasis عادة عن 0–3 spans في الفقاعة، ولا يغطّي أغلب الجملة.

هذا يتوافق مع ممارسة letterers المحترفين: التأكيد قليل، والخط/اللون أدوات معنى لا زينة.

## 7. عقد Luna الجديد

نرفع `TEXT_PROMPT_VERSION` لأن schema والمعنى سيتغيران.

كل region ترجع:
- id
- source
- kind
- arabic
- speaker
- lettering:
  - fontRole
  - ink
  - intensity
  - emphasis[]

النموذج يرى صورة الصفحة ويُطلب منه صراحة:
- تقليد typography الأجنبية حين تحمل معنى: صراخ، همس، تهديد، تعليق، لون خاص، كلمة مكبرة.
- الحفاظ على اتساق صوت الشخصية.
- استخدام styling نادرًا وبقصد.
- تطبيق God rule حرفيًا.

الكاش القديم يبقى قابلًا للعرض فقط كترجمة legacy، لكن النسخة الجديدة تُعاد عند الحاجة لأنها لا تحمل lettering contract.

## 8. Renderer

`ArabicLayout` ينتقل من Typeface واحد إلى `FontCatalog`:
- تحميل lazy للخط المطلوب.
- cache للـTypeface.
- قياس السطر بحسب run styles.
- عدم تقسيم كلمة عربية إلى draw calls منفصلة؛ emphasis يعمل على كلمات/عبارات كاملة حتى لا ينكسر تشكيل العربية.
- stroke/color يطبقان per-run.
- fallback تلقائي إلى neutral إن فشل خط أو glyph.

التخطيط يبقى مقيدًا بقناع الفقاعة. style لا يسمح للنص بالخروج من الحدود.

## 9. مصادر التعلم الخارجي

نستفيد من مشاريع الترجمة الأجنبية كمراجع تصميم لا كنسخ كود:
- dmMaze/comic-text-detector: تدريب ~13k صورة، وقناع text segmentation.
- zyddnys/manga-image-translator: توثيق أن cv2.dnn أعطى 4–5x على CTD CPU.
- ogkalu2/comic-translate: RT-DETR bubble/text detection + manga/anime LaMa + wrapped lettering.
- BallonsTranslator: فصل واضح بين detection / OCR / inpainting / typesetting.
- إرشادات letterers المحترفين مثل Todd Klein وBlambot: emphasis قليل، الخط واللون تابعان للمعنى، وتوجد فئات مستقلة للحوار/SFX/العناوين.

## 10. الاختبارات

### Android
- fast + heavy في الصفحة نفسها.
- text_free واحد لا يسقط الفقاعات السهلة.
- ROI يطابق نتيجة heavy القديمة داخل المنطقة.
- LaMa 1536 مقابل 1024: لا تغيّر خارج القناع، وقياس زمن/ذاكرة.
- NNAPI fallback.
- full-res timeout لا يحجز gate.
- residual Latin promotion.
- 20 fonts تفتح وتغطي مجموعة glyphs عربية ثابتة.
- emphasis لا يكسر تشكيل الكلمة ولا يخرج من mask.
- blood style snapshot/pixel bounds.

### Worker/JS
- God validator: عشرات الصيغ، singular/plural/case.
- ممنوع عرض إله/رب/آلهة إذا source يحوي God(s).
- lettering schema clamps invalid role/color/scale.
- emphasis substring exactness.
- legacy cache/version migration.
- التقرير يوضح fast/heavy regions لا الصفحات فقط.

### Real pages
- الـ11 صفحة الحالية تبقى mandatory.
- إضافة corpus خاص بالخلفيات الصعبة والصور التي أرسلها المستخدم إن أصبحت fixtures متاحة.
- المقارنة لا تكون «نفس البكسلات فقط»؛ نحتاج أيضًا residual Latin + outside-mask exactness + changed pixels + زمن كل stage.

## 11. النشر

التغيير Android-native + worker/web bundle داخل APK، لكن **لا يوجد نشر PWA** ضمن هذا العمل.

الـstable workflow الحالي أصلًا لا ينشر Cloudflare Pages؛ هو:
- يبني APK موقّع.
- يضم web bundle داخل APK.
- ينشر GitHub Release فيه APK + manifest + web zip للتحديث الداخلي.

لأن native fingerprint سيتغير، updater سيطلب **APK** لا web-only update. لا نغيّر PWA ولا نشغل مسار نشر PWA.

إذا أمكن حذف `VANTARA-web.zip` من release من دون كسر updater القديم نفعل ذلك باختبار توافق؛ وإلا يبقى asset داخليًا في GitHub Release فقط، لكن مسار التحديث الفعلي سيكون APK حصريًا.

## 12. شروط الدمج

لا دمج إلى main إلا بعد:
1. Android debug build + Kotlin tests خضراء.
2. VANTARA CI كامل أخضر.
3. 11 real pages خضراء.
4. God validator tests خضراء.
5. font coverage tests خضراء.
6. لا regression في updater/safety.
7. تقرير benchmark يبيّن أن fast/heavy per-region يعمل فعليًا في fixture، لا `fast 0`.
8. مراجعة code review قبل الدمج.
9. بعد الدمج: ننتظر stable workflow ونراجع توقيع APK وrelease قبل القول «نزل».

## 13. مراجع البحث

- ONNX Runtime Android: NNAPI وXNNPACK مدعومان؛ NNAPI أداءه device/model-specific وقد يبطؤ إذا حصل partitioning.
- OpenCV Android: `readNetFromONNX` وDNN backend متاحان، وOpenCV Android يمكن إضافته من Maven.
- manga-image-translator issue/PR #39: cv2.dnn CPU كان 4–5x أسرع لمسار CTD مع detect_size=1024.
- Todd Klein lettering guidance: emphasis يُستخدم sparingly؛ Heavy Italic للكلمات المؤكدة، والألوان/الطبقات أدوات Lettering.
- Google Fonts Arabic families: خطوط متعددة مفتوحة ومتنوعة الأوزان/الشخصيات.

