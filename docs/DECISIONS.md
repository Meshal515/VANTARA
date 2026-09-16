# VANTARA — القرارات المثبتة

> هذه قرارات مقفلة. لا تُناقش داخل التنفيذ، تُناقش فقط بتعديل هذا الملف.
> آخر تحديث: 2026-09-16

---

## D-01 — Uchiyomi هو النظام الأساسي، وSuwayomi محرك إضافاته المدمج

**مثبت بالدليل** — `deploy/docker-compose.yml` في upstream يعرّف ثلاث خدمات:

| الخدمة | الصورة | الدور |
|---|---|---|
| `uchiyomi` | `ghcr.io/angelosha/uchiyomi:latest` | المكتبة، المستخدمون، التقدم، التنزيلات، القارئ |
| `uchiyomi-suwayomi` | `ghcr.io/suwayomi/suwayomi-server:v2.3.2243` | محرك إضافات Mihon/Tachiyomi (JVM) |
| `uchiyomi-flaresolverr` | `ghcr.io/flaresolverr/flaresolverr:latest` | حل تحديات Cloudflare |

الربط عبر `SUWAYOMI_URL` و`FLARESOLVERR_URL`. وتعليق upstream حرفيًا:

> `AUTO_DOWNLOAD_CHAPTERS: "false"` — *"Uchiyomi owns the library and does the downloading; this instance must never write into it."*

**القرار:**

```
VANTARA
  ↓
Uchiyomi            ← المكتبة/المستخدمون/التقدم/القارئ/التنزيل
  ↓
Suwayomi المدمج     ← البحث/الفصول/الصفحات فقط
  ↓
Mihon / Keiyoushi extensions
```

لا نبني تكامل Suwayomi. لا نشغّل نسخة ثانية. لا نكتب `SuwayomiAdapter` خاصًا بنا.
`SourceAdapter` عندنا يتكلم مع **Uchiyomi REST API** فقط، وUchiyomi يتكلم مع Suwayomi.

---

## D-02 — مصدر حقيقة واحد للتقدم

```
Uchiyomi  = source of truth لـ progress / library / users
VANTARA   = يقرأ منه، ويكتب فوقه Activity / Stats / Social فقط
```

ممنوع: جدول `reading_progress` خاص بـVANTARA يُكتب فيه بالتوازي.
VANTARA يخزّن `reading_sessions` (لحساب الوقت) و`activity_events` — وهذه مشتقات، لا مصدر حقيقة.

قاعدة الاختبار: امسح جداول VANTARA كلها ⇒ لا يفقد أي مستخدم فصلًا واحدًا من تقدمه.

---

## D-03 — الدمج يحتاج Snapshot وSplit قبل أن يُسمح به

أي `merge` لعملين:

1. يكتب `merge_snapshot` (progress + ratings + likes + comments لكل مستخدم قبل الدمج).
2. قابل للعكس عبر `split` يستعيد الـsnapshot.
3. `cover pHash` **لا يُستخدم للدمج التلقائي** — اقتراح فقط، يحتاج تأكيد يدوي.

الدمج التلقائي مسموح فقط عند تطابق `external_id` (MangaBaka/AniList/MAL/MangaDex).

---

## D-04 — الترجمة العربية: الرسم عندنا، لا عند المحرك

**محسوم جزئيًا بدليل بصري** — انظر
[`spike/out/arabic-typeset-basic-vs-raqm.png`](../spike/out/arabic-typeset-basic-vs-raqm.png)
ونصّ المولّد [`spike/probes/04-arabic-typeset.py`](../spike/probes/04-arabic-typeset.py).

### ما ثبت

`Pillow 12.3` يشحن **raqm 0.10.5** — أي HarfBuzz + FriBidi + libraqm — في
`pip install Pillow` واحد. بلا بناء يدوي لأي منها.

رُسمت أربع جمل من صفحة حقيقية (Nano Machine فصل 1، Azora) بمحركين:

| المحرك | النتيجة |
|---|---|
| `Layout.BASIC` | **غير قابل للاستخدام** — الاتجاه معكوس: `تحذير!` تُرسم `اريذحت!` |
| `Layout.RAQM` | **سليم تمامًا** — وصل، RTL، ترقيم في موضعه، أرقام، التفاف، تمركز |

وأربع الجمل دخلت البالون بحجم مقروء عبر wrap + autosize بسيط.

### القرار

```
الكشف + OCR + Inpainting   ← محرك جاهز (XianScan / manga-image-translator)
الرسم العربي                ← طبقتنا، Python + Pillow/RAQM
```

**لا نطلب من XianScan أن يرسم عربيًا.** typesetter عنده موصوف بأنه يتعامل مع
*"RTL manga"* وهذا **ترتيب قراءة الصفحة** لا تشكيل الحرف، وهو Rust فلا يحمل مكدّس
Pillow/RAQM. نأخذ منه `text regions + cleaned image` ونرسم نحن.

هذا يسقط أكبر مجهول في المشروع كله من "قد يحتاج أسابيع" إلى "محلول بمكتبة قياسية".

### ثلاثة قيود مُقاسة تدخل التنفيذ

1. **`direction="rtl"` و`language="ar"` يرفعان `KeyError` بلا libraqm.** أي بيئة تشغيل
   للـworker يجب أن تتحقق من `PIL.features.check("raqm")` عند الإقلاع وترفض العمل بدونه.
2. **RAQM أضيق من BASIC بـ20–23%** (‎158.6 مقابل 201.0 بكسل لنفس الجملة عند حجم 32).
   أي خوارزمية ملء بالون تُعاير على مقاسات BASIC ستكون خاطئة.
3. **لا font fallback تلقائي في Pillow.** `NotoNaskhArabic` يرسم اللاتيني مربعات فارغة
   (ظاهر في عنوان الصورة). البالونات المختلطة عربي/لاتيني (أسماء، مؤثرات صوتية) تحتاج
   تقسيم النص إلى runs واختيار خط لكل run يدويًا. **هذا بند عمل حقيقي، لا تفصيل.**

### ما يبقى للـSpike على جهاز مشعل

الزمن/الصفحة وجودة OCR والـinpainting — الخطوات 7 و8 في
[`spike/SPIKE.md`](../spike/SPIKE.md). الرسم العربي خرج من دائرة المجهول.

---

## D-05 — تعريف النجاح: Integrated Alpha، لا Production Final

المدة: **شهر** (كانت 72 ساعة).

`72h / Integrated Alpha` لم يعد تعريف النجاح. الفرق:

| ليس نجاحًا | النجاح |
|---|---|
| 49 مصدرًا "مدعومًا" | 5–10 مصادر **مختبرة فعليًا** بدليل |
| ترجمة عربية production-grade | ترجمة عربية تجريبية مُقاسة ومُعاينة |
| Agent يصلح كل شيء | Auto-repair قاعدي + بلاغ يعمل |

---

## D-06 — قاعدة البيانات: خارجية، لا مدمجة

Uchiyomi يشغّل Postgres **داخل حاويته** على unix socket في `uchiyomi_data:/data/pg`
عندما يكون `DATABASE_URL` فارغًا. ضبطه يحوّله لقاعدة خارجية
(`deploy/docker-compose.external-db.yml` جاهز في upstream).

**القرار:** VANTARA يستخدم Postgres خارجيًا من اليوم الأول، لأن جداول VANTARA
(social/activity/translation) لازم تكون في نفس القاعدة مع pg-boss، وممنوع أن تكون
داخل حاوية نُحدّثها بـ`docker compose pull`.

---

## D-07 — سقف المصادر = 25 افتراضيًا

`SUWAYOMI_MAX_SOURCES: ${SUWAYOMI_MAX_SOURCES:-25}`

قائمة الـ49 مصدرًا عربيًا **تتجاوز السقف الافتراضي**. رفعه يكلّف ذاكرة JVM.
يُقاس في الـSpike قبل أي وعد بعدد مصادر.

---

## D-08 — خط أساس العتاد

قبل XianScan، الحد الأدنى للمكدّس:

| المكوّن | الذاكرة |
|---|---:|
| Uchiyomi + Postgres مدمج | ~‎? (يُقاس) |
| Suwayomi (JVM) | ~800 MB (موثّق في upstream) |
| FlareSolverr (Chrome) | 150 MB خمول → سقف 2 GB |

FlareSolverr موثّق في upstream بأنه يتسرّب حتى 2.5 GB خلال 62 يومًا، وأنه فشل
7 مرات في 24 ساعة على تثبيت واحد. **Cloudflare محلول، لكنه مصدر أعطال مُراقَب** —
لا يُعتبر "يعمل ونسيناه".

يُملأ الرقم الحقيقي من الـSpike على جهاز مشعل، لا على أي جهاز آخر.
