# VANTARA Spike — الخطوات الباقية على جهاز مشعل

> الخطوات 1–6 نُفّذت ونتائجها في [`RESULTS.md`](./RESULTS.md).
> هذا الملف للخطوات التي **لا يمكن تفويضها**: 7، 8، 9.
> لا يُكتب سطر في `translation-worker` قبل أن يُملأ جدول §C هنا.

---

## لماذا على جهازك تحديدًا

| السبب | التفصيل |
|---|---|
| **الزمن هو الهدف** | الخطوة 8 كلها قياس زمن/صفحة. بيئة 4 vCPU بلا GPU تعطي رقمًا مضلّلًا. |
| **MITM TLS** | البيئة السحابية تعترض الشهادات. XianScan (Rust) وChromium يحملان truststores مستقلة وسيفشلان عند تنزيل موديلات ONNX. على جهازك لا توجد المشكلة. |
| **القرار بصري** | جودة الحرف العربي داخل البالون يحكمها إنسان ينظر، لا اختبار آلي. |

---

## A. الأساس — أعِد إنتاج النتائج على جهازك (30 دقيقة)

```bash
mkdir -p ~/vantara-spike && cd ~/vantara-spike
curl -O https://raw.githubusercontent.com/AngeloSha/uchiyomi/main/deploy/docker-compose.yml
docker compose up -d                      # الثلاث خدمات، FlareSolverr معها هذه المرة
docker compose ps                         # انتظر uchiyomi-suwayomi healthy (~90 ثانية، JVM)
```

افتح `http://localhost:8080` → أنشئ حساب المدير من المتصفح.
ثم الحسابين الآخرين من Admin → Users (وليس بـ`INSERT` في Postgres).

> ⚠️ `POST /api/setup` يتجاهل `displayName`. اضبط الاسم العربي من شاشة Admin بعد الإنشاء.

**سجّل:**

```
زمن الإقلاع حتى healthy       : ______ ثانية
RAM المستهلكة للمكدّس كاملًا   : ______ GB   (docker stats --no-stream)
```

---

## B. المصادر — وسّع جدول الحكم (ساعتان)

أضف Keiyoushi ثم ثبّت **10 مصادر عربية** (لا 38 — السقف 25 والذاكرة تكلف):

```bash
TOK=<admin accessToken>
A="Authorization: Bearer $TOK"
curl -X POST -H "$A" -H 'Content-Type: application/json' \
  localhost:8080/api/admin/extensions/repos \
  -d '{"url":"https://raw.githubusercontent.com/keiyoushi/extensions/repo/index.min.json"}'
curl -X POST -H "$A" localhost:8080/api/admin/extensions/refresh
```

ثم شغّل الفحص الآلي على المصادر التي ثبّتها:

```bash
docker cp probes/01-source-verdict.js uchiyomi:/tmp/
docker exec uchiyomi node /tmp/01-source-verdict.js
```

عدّل مصفوفة `SOURCES` في السكربت بمعرّفاتك (من `GET /api/sources`).

**املأ:** عمود الحكم يأخذ إحدى:
`SUPPORTED` · `NEEDS_FLARESOLVERR` · `SEARCH_BROKEN` · `PARSER_FAILED`

| المصدر | POPULAR | search AR | search EN | الفصول | الصفحات | الحكم |
|---|---|---|---|---|---|---|
| | | | | | | |

**اختبر بعملين لا عمل واحد** — واحد مشهور (Nano Machine) وواحد أقل شهرة. المصدر قد ينجح
في الأول ويفشل في الثاني.

**السؤال الحاسم:** كم مصدرًا وصل `SUPPORTED`؟ هذا الرقم — لا الـ38 ولا الـ49 — هو ما
يُكتب في المخطط الجديد.

---

## C. الترجمة العربية — الخطوات 7 و8 و9

### C-1. شغّل XianScan

```bash
docker run -d --name xianscan -p 8000:8000 \
  -v ~/vantara-spike/xianscan-config:/config \
  ghcr.io/arbenapura/xianscan-rust:latest
docker logs -f xianscan     # راقب تنزيل موديلات ONNX — أول تشغيل يأخذ وقتًا
```

> لو فشل التنزيل بخطأ شهادة أو شبكة، هذه مشكلة بيئتك لا المشروع. راجع وثائقه:
> <https://xianscan.arbenger.com/docs/>

### C-2. حضّر صفحات الاختبار

أربع صفحات حقيقية، واحدة لكل لغة مصدر. اسحبها من المصادر العاملة عندك:

```bash
docker cp probes/03-image-validation.js uchiyomi:/tmp/
docker exec uchiyomi node /tmp/03-image-validation.js     # عدّل الأهداف أولًا
docker cp uchiyomi:/tmp/pages ./pages
```

| اللغة | العمل | المصدر |
|---|---|---|
| إنجليزي | | MangaDex |
| كوري | | |
| ياباني | | |
| صيني | | |

اختر صفحات فيها **بالونات صغيرة وضيقة** لا بالونات كبيرة فقط. البالون الضيق هو الذي
يفضح typesetting العربي.

### C-3. الجدول الحاكم — الخطوة 8

| اللغة | ثانية/صفحة | RAM ذروة | CPU% | الحالة |
|---|---:|---:|---:|---|
| EN → AR | | | | |
| KR → AR | | | | |
| JP → AR | | | | |
| ZH → AR | | | | |

**بوابة القرار:**

```
> 60 ثانية/صفحة  ⇒ وعد READY_PARTIAL أثناء القراءة ساقط. إما GPU أو API أو ترجمة مسبقة بالخلفية.
10–60 ثانية      ⇒ يعمل بترجمة مسبقة للفصل التالي، لا بالطلب الفوري.
< 10 ثانية       ⇒ READY_PARTIAL واقعي.
```

### C-4. الفحص البصري — الخطوة 9 (الأهم)

افتح الصفحة المترجمة وكبّرها. **لكل بند: نعم / لا / جزئي.**

| # | الفحص | ماذا تعني النتيجة السلبية |
|---|---|---|
| 1 | **اتصال الحروف** (`مـحـمـد` لا `م ح م د`) | لا Arabic shaping — يحتاج HarfBuzz. **قاتل** |
| 2 | **اتجاه RTL** (الجملة تبدأ يمينًا) | لا bidi — يحتاج FriBidi. **قاتل** |
| 3 | **الترقيم** (`؟` `،` في الموضع الصحيح) | bidi ناقص عند الحدود |
| 4 | **التفاف الأسطر** (لا كلمة مقطوعة) | line-breaking غير عربي |
| 5 | **الحجم** (النص ليس أصغر/أكبر من البالون) | لا bubble fitting |
| 6 | **التمركز** (داخل البالون لا خارجه) | إحداثيات الـregion خاطئة |
| 7 | **التشكيل الرباعي** (بداية/وسط/نهاية/منفرد) | الخط ناقص glyphs |
| 8 | **لا نص قديم ظاهر** | inpainting فشل |

**احتفظ بلقطة شاشة لكل لغة.** هذه هي المخرجات الحقيقية للـSpike.

### C-5. القرار — يُكتب في `docs/DECISIONS.md` تحت D-04

```
[ ] renderer XianScan يكفي            ← بندان 1 و2 ناجحان
[ ] يحتاج HarfBuzz+FriBidi+libraqm    ← بند 1 أو 2 فاشل
[ ] نبني طبقة typesetting عربية خاصة  ← 1 و2 ناجحان و5 و6 فاشلان بشكل غير قابل للضبط
```

**للسياق:** وصف XianScan لـtypesetter عنده هو *"RTL manga, vertical columns, or
horizontal webtoons"* — وهذا **ترتيب قراءة الصفحة**، لا تشكيل الحرف العربي.
البندان 1 و2 هما الاحتمال الأكبر للفشل. توقّعه ولا تتفاجأ.

---

## D. ما ينتج عن الـSpike

1. `RESULTS.md` محدّثًا بأرقام جهازك.
2. جدول حكم المصادر مملوءًا — العدد الحقيقي لا المتوقع.
3. أربع لقطات شاشة للترجمة العربية.
4. D-04 محسومًا.
5. **ثم** — ومن بعدها فقط — يُعاد كتابة المخطط الرئيسي لمدة شهر.
