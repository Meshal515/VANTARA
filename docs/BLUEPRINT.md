# VANTARA — المخطط التنفيذي

> ## ⚠ وثيقة تاريخية
>
> هذا مخطط الأسابيع الأربعة الأول، كُتب قبل قطعتين لم تكونا في الحسبان:
>
> - **المزامنة على Cloudflare Worker + D1** (`services/sync-worker`) —
>   الحسابات والأصدقاء والحضور والتقدّم، تعمل وجهازُ البيت نائم.
> - **محرّك إضافات Keiyoushi داخل الـAPK** (`android/app`) — القراءة من
>   المصادر بلا خادم إطلاقًا.
>
> فمعمارية §1 أدناه تصف **خادم المحتوى وحده**، وهي سليمة هناك. المعمارية
> الكاملة في [`README.md`](../README.md).
>
> ويبقى هذا الملف لأن ترتيب العمل وتعريف النجاح فيه ما زالا يُقرآن.

> **المدة:** 4 أسابيع · **المستخدمون:** مشعل، منصور، دحمي · **النطاق:** Manga / Manhwa / Manhua
> **الأساس:** [Uchiyomi](https://github.com/AngeloSha/uchiyomi) v0.34 (MPL-2.0)
> بديل المخطط القديم ذي الـ70 قسمًا. كل رقم هنا مُقاس في [`spike/RESULTS.md`](../spike/RESULTS.md).

---

## 1. المعمارية

```
                    Cloudflare Access → Tunnel
                              ↓
┌──────────────────────────────────────────────────┐
│ vantara-api        Presence · Social · Profiles   │
│                    Activity · Group Ratings       │
│                    Reports · Deleted Works        │
│                    Content Policy · THE ORBIT     │
└──────┬─────────────────────────┬──────────────────┘
       │ REST + uy_ token        │ pg-boss
       ▼                         ▼
   Uchiyomi                  PostgreSQL (خارجي)
   المكتبة · المستخدمون          جداول VANTARA فقط
   التقدم · القارئ · التنزيل     + queues
       ↓ SUWAYOMI_URL
   Suwayomi v2.3.2243  ←── مدمج upstream، لا نشغّل نسخة ثانية
       ↓
   Keiyoushi extensions
       ↕ FLARESOLVERR_URL
   FlareSolverr  ←── إلزامي

   translation-worker (منفصل)
   regions+OCR+inpaint من محرك جاهز → الرسم العربي عندنا (Pillow/RAQM)
```

**قواعد غير قابلة للتفاوض:**

1. VANTARA **لا يكتب تقدمًا**. `PUT /api/books/{id}/progress` ملك Uchiyomi وحده.
2. VANTARA **لا يتكلم مع Suwayomi مباشرة**. فقط Uchiyomi REST.
3. Postgres **خارجي** من اليوم الأول (`DATABASE_URL` + `docker-compose.external-db.yml`).
4. لا `latest` في أي صورة إنتاج. كلها مثبّتة بـdigest.

---

## 2. الخدمات

```
vantara-api           TypeScript/Node
vantara-web           واجهة VANTARA (Presence/Social/Profiles)
postgres              خارجي، جداولنا + pg-boss
uchiyomi              pinned
uchiyomi-suwayomi     v2.3.2243
uchiyomi-flaresolverr pinned digest، shm 1g، mem 2g
translation-worker    Python
cloudflared
uptime-kuma           اختياري
```

---

## 3. ما يُشحن جاهزًا — لا نبنيه

مُتحقَّق من `openapi.yaml` (5,430 سطرًا، محفوظ في `spike/`):

| الوظيفة | المسار |
|---|---|
| Auth + 2FA + OIDC + API tokens بنطاقات | `/auth/*` · `/api/tokens` |
| إدارة المستخدمين | `/api/admin/users` |
| بحث عبر كل المصادر **مُجمّعًا بـ`providers[]`** | `/api/sources/search-all` · `/find` |
| تفاصيل العمل · الفصول · الصفحات | `/api/series/{id}` · `/books/{id}/pages` |
| التقدم · التاريخ | `/api/books/{id}/progress` · `/api/history` |
| Ratings فردية | `/api/ratings/{seriesId}` |
| Collections (القوائم المشتركة) | `/api/collections` |
| Notes لكل عمل | `/api/notes` |
| إحصائيات + ملخص سنوي | `/api/stats` · `/api/wrapped` |
| ChapterVariant | `/api/series/{id}/versions` |
| جودة الترجمة لكل عمل (حظر + أولوية) | `/api/series/{id}/groups` · `scanlatorPrefs` |
| الفصول الناقصة | `/api/series/{id}/listing` |
| ملء الفراغات من مصدر آخر | `/api/sources/fill/scan` · `/fill` |
| مصادر متعددة للعمل | `POST /api/admin/series/{id}/sources` |
| Source health · اختبار · watchdog | `/api/admin/sources/{id}/test` · `/check` |
| إدارة الإضافات | `/api/admin/extensions/*` |
| Audit log | `/api/admin/audit` |
| Offline + downloads | `/api/offline/plan` · `/api/downloads` |
| تصنيف عمري | `users.max_age_rating` · `hiddenAdult` |
| OPDS | `/opds/*` |

---

## 4. ما نبنيه نحن

```
1.  THE ORBIT — بوابة اختيار الحساب
2.  Profiles — Avatar · Banner · Bio · Favorite 4 · Accent
3.  Presence — READING / ONLINE / IDLE / OFFLINE + ماذا يقرأ
4.  Reading sessions — حساب الوقت الفعلي (لا التبويب المفتوح)
5.  Activity Feed
6.  Send / Recommend + Inbox
7.  Comments — ردود + تفاعلات + spoiler حسب التقدم
8.  Group Ratings — تجميع فوق ratings الفردية في Uchiyomi
9.  Read Together
10. Deleted Works — soft delete للجميع + restore + hard delete
11. Content Policy — BL/GL block + بوابة البالغين
12. Reports workflow + auto-repair + تصعيد
13. Translation worker — الرسم العربي عندنا
14. Source verdict registry — بما فيه SEARCH_BROKEN
```

---

## 5. الجداول

VANTARA **لا يعيد** جداول Uchiyomi. فقط:

```sql
vantara_profiles          -- avatar, banner, bio, favorite_4, accent, theme
vantara_presence          -- user_id, status, series_ref, chapter_ref, progress, seen_at
vantara_reading_sessions  -- user_id, series_ref, started, ended, active_ms, interactions
vantara_activity_events   -- actor, verb, object_ref, payload, created_at
vantara_comments          -- + parent_id, target_type(series|chapter), min_progress
vantara_comment_reactions
vantara_recommendations   -- from_user, to_user|ALL, series_ref, message, state
vantara_group_ratings     -- مادة مُجمّعة، مشتق قابل لإعادة البناء
vantara_read_together
vantara_deleted_works     -- series_ref, deleted_by, reason, snapshot jsonb
vantara_content_policy    -- source_id|series_ref, rule, reason
vantara_user_gates        -- per-user adult opt-in, confirmed_at
vantara_reports           -- + attachments, diagnostics jsonb, actions[]
vantara_source_verdicts   -- source_id, verdict, evidence jsonb, tested_at
vantara_merge_snapshots   -- قبل أي دمج (D-03)
vantara_translation_jobs  -- series_ref, chapter_ref, state, timings
vantara_translation_pages
vantara_glossary
vantara_characters
vantara_translation_memory
```

`*_ref` = معرّف Uchiyomi. **لا نسخ لبياناته.**

---

## 6. حالات المصدر

```
REGISTERED_NOT_TESTED
SUPPORTED              ← البحث + الفصول + صفحات قديمة + صفحات حديثة + فكّ ترميز
SEARCH_BROKEN          ← حيّ لكن البحث غير صالح (مُكتشف في الـSpike)
NEEDS_FLARESOLVERR
PARSER_FAILED
TEMPORARILY_UNAVAILABLE
POLICY_BLOCKED
```

`SEARCH_BROKEN` يستخدم `POPULAR/LATEST + title match` كمسار اكتشاف بديل.

**لا يُوصف مصدر بـ`SUPPORTED` إلا بـ`evidence` مخزّن في `vantara_source_verdicts`.**

---

## 7. الترجمة

```
صفحات الفصل
    ↓
محرك جاهز: detection → OCR → inpainting      (XianScan أو manga-image-translator)
    ↓  regions + صورة منظّفة
سياق: glossary + characters + الصفحات السابقة
    ↓
LLM
    ↓
الرسم العربي — طبقتنا: Pillow + RAQM
    ↓
READY_PARTIAL → READY
```

**قيود مُقاسة:**

1. الـworker يتحقق من `PIL.features.check("raqm")` عند الإقلاع أو **يرفض العمل**.
   `direction="rtl"` يرفع `KeyError` بدونه.
2. معايرة bubble-fitting على مقاسات **RAQM** فقط — أضيق 20–23% من BASIC.
3. **font fallback يدوي.** النص يُقسّم runs عربي/لاتيني، وخط لكل run.
   `NotoNaskhArabic` يرسم اللاتيني مربعات فارغة.

**الحالات:** `QUEUED → DETECTING → OCR → CONTEXT → TRANSLATING → INPAINTING → TYPESETTING → READY_PARTIAL → READY` · `NEEDS_REVIEW` · `FAILED`

---

## 8. الخطة — 4 أسابيع

### الأسبوع 1 — الأساس يعمل خلف Cloudflare

| اليوم | العمل |
|---|---|
| 1 | Repo · monorepo · Postgres خارجي · pin كل الصور بـdigest · CI (lint+type+test) |
| 2 | Cloudflare Tunnel + Access · **حسم هوية Access مقابل حساب VANTARA** (قرار واحد لا اثنان) |
| 3 | `SourceAdapter` فوق Uchiyomi REST · API token بنطاق `read` |
| 4–5 | **اختبار 10–15 مصدرًا عربيًا** بالمعيار الخمسي · تعبئة `vantara_source_verdicts` |
| 6 | Presence + reading sessions (heartbeat 25 ث) |
| 7 | اختبار جوال/كمبيوتر · نسخة احتياطية أولى (restic) · إصلاح |

**Done:** الثلاثة يدخلون من الجوال، يبحثون، يقرأون، التقدم يتزامن، ويُعرف من متصل وماذا يقرأ. وعدد المصادر `SUPPORTED` **معروف بدليل**.

---

### الأسبوع 2 — الطبقة الاجتماعية

| اليوم | العمل |
|---|---|
| 8 | THE ORBIT + Profiles (avatar/banner/bio) |
| 9 | Favorite 4 + accent + تبويبات البروفايل |
| 10 | Comments + ردود + تفاعلات + spoiler gate |
| 11 | Group Ratings فوق `/api/ratings` + Read Together |
| 12 | Send/Recommend + Inbox |
| 13 | Activity Feed + إحصائيات فوق `/api/stats` |
| 14 | اختبار · أداء الجوال · إصلاح |

**Done:** VANTARA تجربة مشتركة لا قارئ فردي.

---

### الأسبوع 3 — الإدارة والموثوقية

| اليوم | العمل |
|---|---|
| 15 | Deleted Works: soft delete للجميع + restore + hard delete بكتابة الاسم |
| 16 | Merge snapshot + **split/unmerge** (D-03) · منع الدمج التلقائي بـpHash |
| 17 | Content Policy: BL/GL block + بوابة البالغين + **incognito session** |
| 18 | Reports + رفع صورة + diagnostics تلقائية (بلا cookies/tokens) |
| 19 | Auto-repair: retry → refresh URL → clear cache → next variant → verify |
| 20 | Admin VANTARA + Source Health مع FlareSolverr watchdog |
| 21 | Uptime Kuma · backup/restore **مُختبر فعليًا** · ntfy |

**Done:** كل خطأ له مسار، وكل حذف له رجوع، وكل نسخة احتياطية مُجرَّبة.

---

### الأسبوع 4 — الترجمة العربية

| اليوم | العمل |
|---|---|
| 22 | `translation-worker` skeleton · pg-boss · حالات الوظيفة · فحص raqm عند الإقلاع |
| 23 | تكامل المحرك الجاهز: regions + cleaned image |
| 24 | **Arabic renderer** — shaping · bidi · wrap · autosize · bubble fit · font runs |
| 25 | glossary + characters + سياق الصفحة السابقة + LLM provider abstraction |
| 26 | Benchmark EN/KR/JP/ZH → عربي · قياس الزمن · اختيار محرك لكل لغة |
| 27 | READY_PARTIAL في القارئ · re-run صفحة/منطقة · شاشة `NEEDS_REVIEW` |
| 28 | E2E · فشل مصدر · فشل ترجمة · استعادة نسخة · Docker Compose نهائي · RUNBOOK |

**Done:** فصل كامل من كل لغة يصل عربيًا مقروءًا، وglossary ثابت، وإعادة رسم منطقة تعمل.

---

## 9. Definition of Done

**الحساب** — لا لوكال كمصدر حقيقة · الجلسة تستمر بعد إغلاق المتصفح · Logout device يعمل.

**القارئ** — webtoon + paged · resume · تبديل variant عند الفشل · لا scroll jump.

**المصدر** — `SUPPORTED` فقط بـevidence مخزّن · الفشل لا يكسر الواجهة.

**الاجتماعي** — إرسال لفرد/الجميع · تقييم وإعجاب وتعليق ظاهر · Activity يتحدث.

**البلاغ** — الصورة محفوظة · diagnostics مرتبطة · المحاولات مسجّلة.

**الترجمة** — **فصل كامل** (لا صفحة) من كل لغة عربيًا مقروءًا · الفحص الثماني في
[`spike/SPIKE.md`](../spike/SPIKE.md) §C-4 ناجح · glossary ثابت · re-run يعمل.

**الحذف** — soft delete يخفي من كل المسارات · restore يرجّع التقدم والتقييمات والتعليقات.

---

## 10. المخاطر

| الخطر | المعالجة |
|---|---|
| **Uchiyomi 0.x، مطوّر واحد، 37 نجمة** | pin بـdigest · لا upgrade داخل الشهر · كل تعاملنا عبر REST لا fork للكود ⇒ نغيّر الأساس بلا هدم |
| **FlareSolverr يتسرّب ويتعطل** | mem 2g + restart + healthcheck + watchdog في Admin |
| **زمن الترجمة على CPU** | بوابة القرار في SPIKE §C-3 · ترجمة الفصل التالي مسبقًا لا بالطلب |
| **font fallback** | بند عمل مستقل يوم 24، لا تفصيل |
| **سقف 25 مصدرًا** | نفعّل `SUPPORTED` فقط؛ لن تقترب من 25 |
| **دمج خاطئ يتلف التقدم** | snapshot قبل الدمج + split + منع pHash التلقائي |
| **المصادر تتغير** | `vantara_source_verdicts` + إعادة اختبار مجدولة |

---

## 11. التكلفة

`$0/شهر` عدا: دومين إن لم يوجد · AI API اختياري · كهرباء/إنترنت الجهاز.

R2 المجاني 10 GB — **وفصل webtoon واحد ≈ 20 MB** (مُقاس). النسخ الاحتياطي يشمل
قاعدة البيانات وglossary والبروفايلات فقط. **لا نسخ لكاش الصور ولا للترجمات.**

---

## 12. قواعد العمل

```
لا تقل Supported بدون evidence مخزّن.
لا تكتب تقدمًا في VANTARA.
لا تتكلم مع Suwayomi مباشرة.
لا latest في runtime.
لا حذف بلا soft-delete أو snapshot.
لا deploy تلقائي لكود.
الجوال أولًا في الاختبار.
اختبر المصدر بعملين لا عمل واحد.
```

---

## 13. الملفات المرجعية

```
docs/DECISIONS.md    D-01…D-08 · القرارات المقفلة
spike/RESULTS.md     الأرقام المُقاسة
spike/SPIKE.md       الخطوتان 7 و8 على جهاز مشعل
spike/probes/        سكربتات الفحص
spike/out/           دليل الرسم العربي
spike/uchiyomi-openapi-v0.34.yaml
```
