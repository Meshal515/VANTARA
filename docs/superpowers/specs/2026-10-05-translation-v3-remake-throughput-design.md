# VANTARA Translation V3 — Remake Throughput & Coverage Design

التاريخ: 2026-10-05
الأساس: `ec083d9ad541fd56b6ca1cf470d3b207df660867`
الهدف: **100 صفحة جديدة غير مخزنة ≤ 120 ثانية wall-time على Galaxy S23 Ultra** مع رفع جودة الإخراج إلى مستوى remake، بلا Home Server وبلا VPS.

## 1. القيود الصلبة

- كل الرؤية/OCR/التبييض/الرسم محلي على Android.
- Luna عبر الـsync-worker الحالي فقط؛ لا خادم GPU خاص ولا VPS ولا Home Server.
- لا ادعاء لهدف 100/120 إلا بقياس جهاز فعلي S23 Ultra وcache ترجمة جديد.
- لا Full-page CTD/BubbleSeg/LaMa في المسار العادي؛ full-page يبقى debug/rescue فقط.
- لا نسمح بعربي فوق إنجليزي متبقٍ؛ mixed Arabic/English = 0 في corpus القبول.
- خارج mask المسح + bounds العربي يجب أن يبقى مطابقًا للأصل.
- لا تفعيل NNAPI/OpenCV DNN كافتراضي بلا benchmark جهاز + مقارنة ناتج.

## 2. العلل المثبتة من stable-115 والكود

1. **Queue-on-queue amplification:** القارئ يضع الصفحات في `createQueue(concurrency=4)` end-to-end، ثم Android يضعها في `PriorityGate`. لذلك صفحة textless عملها المحلي ~0.46ث أمكن أن تنتظر 53ث قبل البدء، وصفحات الحوار سجلت 42–50ث انتظار.
2. **Reader Luna batching bypass:** `priorityOf(reader)=high` و`enqueueTextPage(... interactive:true)` يرسل `/v1/translate/text` مباشرة. أهم صفحات الفصل لا تستفيد من `/text-batch`.
3. **HeavyRoi غير مفعل في production:** الإنتاج يفلتر صفوف full-width 1024 tiles فقط. `probabilitiesRoi/segmentRoi` موجودة لكنها benchmark candidate.
4. **parallelDetect يكرر RT-DETR للنصوص:** probe Pipeline يفيد textless، لكن إذا وجد نص يعاد الكشف في Pipeline الأساسي لأن النتائج ليست مشتركة.
5. **Textless gate يثق بـRT-DETR وحده:** غياب RT-DETR text box يعني `textless` مباشرة؛ نصوص قصيرة/جانبية مثل HUH?/I KNEW IT يمكن أن تضيع قبل CTD/OCR.
6. **OCR الحالي recognition-only:** `LatinOcr` يستخرج الأسطر من glyph mask؛ لا يستطيع اكتشاف نص لم يدخل أي mask.
7. **ResidualLatin محدود:** بعد التبييض يفحص OCR باستخدام glyph القديم، ثم يرقّي `residual.first()` فقط ويؤجل الإصلاح للمحاولة التالية. نص خارج glyph القديم يمكن أن يفلت، وأكثر من residual في الصفحة لا يعالج كله.
8. **BubbleSeg ثقيل رغم وجود حالات يمكن حلها هندسيًا:** RT-DETR holder + contour/flat mask يكفي لجزء كبير من الفقاعات.
9. تقرير 0.0.115 أثبت أن render.queue أصبح ~0 بعد #152؛ عنق الزجاجة انتقل إلى JS wait + analyze.queue + heavy inference/Luna.

## 3. المعمارية

### 3.1 مسارات المنطقة

- **Instant:** RT-DETR + mask هندسي + recognition. مستهدف 65–80% من الصفحات؛ .3–.8ث محلي للصفحة بعد warm-up.
- **Mixed:** Heavy ROI فقط للمناطق الصعبة؛ 15–25%.
- **Rescue:** CTD/BubbleSeg/LaMa فقط عند فشل بوابات الجودة؛ 2–8%.

KPI: full-page heavy ≈ 0 في الفصل العادي.

### 3.2 أربع lanes منطقية

1. **Detect/Probe** — قصير، bounded، يسمح باكتشاف textless مبكرًا.
2. **Heavy ROI** — serialized/bounded على النماذج الثقيلة.
3. **Luna/network** — page batches، مستقلة عن CPU المحلي.
4. **Render** — page-ready render يتقدم على heavy جديد.

الصفحة الحالية interactive؛ الصفحات المقبلة prefetch وليست interactive حتى تصبح focus.

### 3.3 Luna batching

- current visible page قد تتجاوز التجميع لتقليل latency.
- pages ahead تُجمع حتى 4 صفحات / 64 region / حد body الحالي.
- active batches يبدأ محافظًا ثم يقاس؛ لا نرفع concurrency لمجرد الوصول للرقم النظري.
- 429/5xx لا يسبب duplicate paid work.

### 3.4 Missing Text Sweep

لا نعتمد على RT-DETR وحده لقرار textless النهائي.

المرشح الأساسي للـsecondary detector هو **PP-OCRv5_mobile_det** (نموذج PaddleOCR الرسمي المخصص للموبايل، ~4.7MB وفق وثائق PaddleOCR). يختبر كـon-device detector فقط:
- يعمل على الصفحة عندما RT-DETR يقول textless أو عندما coverage مشكوك.
- يلتقط rotated/small/free text candidates.
- candidates تُمرر recognition؛ لا تُقبل منطقة بلا OCR إنجليزي موثوق.
- يضاف للـModelStore فقط بعد pin URL/size/SHA-256.
- إذا زاد false positives أو زمن S23 فوق الميزانية، يبقى rescue sweep لا default.

### 3.5 Heavy ROI

`HeavyRoi.plan` يصبح production path بعد parity gate:
- crop = smallest RT-DETR holder containing text، وإلا text box + context.
- CTD/BubbleSeg على crop فقط.
- map masks إلى page coordinates.
- إذا parity/coverage fails لمنطقة، fallback إلى row/full-width heavy لتلك المنطقة فقط.
- benchmark يسجل ROI hit/fallback/diff.

### 3.6 BubbleSeg conditional

لا يشغل BubbleSeg إذا:
- fast/flat bubble mask موثوق، أو
- RT-DETR holder + local contour يكوّنان mask مغلقًا يحوي النص بنسبة كافية.

BubbleSeg فقط للحدود الغامضة/overlap/complex bubbles.

### 3.7 Residual & Cleaning hard gate

- افحص كل translated region، لا أول residual فقط.
- residual detector لا يعتمد على glyph mask القديم وحده.
- عند residual: أعد بناء erase mask لذلك الـROI ثم أعد erase + draw بنفس الرد العربي إن المصدر لم يتغير.
- إن كشف sweep نصًا جديدًا/أوسع يغيّر source، المنطقة تصبح incomplete وتذهب Luna مرة أخرى.
- الصفحة لا تُحسب complete إذا بقي Latin مقروء داخل translated region.

### 3.8 Luna ودور التبييض

Luna **لا تعدّل البكسلات**. يمكنها فقط إرجاع semantic hints مغلقة مثل:
`cleanModeHint = flat|bubble|art|preserve|rescue`
و`eraseStrength = low|normal|strong`.
التنفيذ والـmask deterministic محلي. لا نضيف هذه الحقول قبل أن تثبت أن local classifier غير كافٍ.

## 4. Backend race

نقيس على نفس ROI:
- ORT CPU/XNNPACK الحالي.
- NNAPI candidate.
- OpenCV DNN candidate لCTD فقط.

ONNX Runtime نفسه يحذر أن NNAPI device/model-specific وقد يبطؤ عند graph partitioning. upstream manga-image-translator وثق 4–5x لـcv2.dnn على CTD CPU، لكنه ليس إثباتًا لأندرويد. لا default بلا S23 benchmark.

## 5. Acceptance

فصل 100 صفحة جديدة:
- wall ≤ 120000ms.
- Detection recall ≥ 99%.
- untranslated English bubbles ≤ 1%.
- mixed Arabic/English = 0.
- no-op whitening = 0.
- outside-mask corruption = 0.
- Fast ≥ 70%.
- Rescue ≤ 10%، الهدف ≤5%.
- textless p50 local ≤ 800ms warm.
- current-page render queue ≈ 0.
- report يفصل jsQueue / nativeDetectQueue / heavyQueue / Luna / render.
- لا Home Server، لا VPS.

## 6. مصادر القرار

- ONNX Runtime official docs: Android CPU/XNNPACK/NNAPI؛ NNAPI device/model specific وقد يتدهور مع partitioning؛ RunOptions termination مدعوم.
- OpenCV Android official docs: OpenCV 4.9+ من Maven Central؛ DNN backend/target configurable.
- manga-image-translator #39: cv2.dnn CPU 4–5x أسرع لمسار CTD لديهم، detect_size 1024.
- PaddleOCR official docs: PP-OCRv5_mobile_det نموذج mobile text detection بحجم ~4.7MB ومخصص للـedge deployment.
- comic-translate/CTD ecosystem: RT-DETR boxes + algorithmic segmentation ممكنة؛ CTD يبقى ممتازًا للرسوم الصعبة لكنه لا يجب أن يكون default لكل نص.
