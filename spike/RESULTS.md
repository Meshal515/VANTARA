# VANTARA Spike — نتائج حقيقية مُقاسة

> **البيئة:** حاوية سحابية، 4 vCPU، 15 GB RAM، لا GPU، Docker storage-driver = `vfs`،
> وخلفها وسيط TLS يعترض الشهادات (MITM).
> **تحذير:** كل رقم زمني هنا **غير صالح** كمرجع لجهاز مشعل. الأرقام الوظيفية (يعمل/لا يعمل) صالحة.
> **التاريخ:** 2026-09-16

---

## 0. ملخص الحكم

| الخطوة | الحالة |
|---|---|
| 1. تشغيل Uchiyomi كما هو | ✅ **نجح** — 9 ثوانٍ حتى healthy |
| 2. Suwayomi المدمج | ✅ **نجح** — `suwayomi: connected on retry` |
| 3. الحسابات الثلاثة من النظام | ✅ **نجح** — بأسماء عربية |
| 4. مصادر عربية حقيقية | ⚠️ **جزئي** — 2 من 5 كاملة، والتفاصيل أدناه |
| 5. دمج نفس العمل من مصدرين | ✅ **موجود upstream** — `search-all` يجمّع تلقائيًا |
| 6. مصدر حقيقة التقدم | ✅ محسوم بالـAPI — انظر §5 |
| 7–9. XianScan + العربية | ⏳ **لم يُنفّذ هنا** — يحتاج جهاز مشعل (§7) |

---

## 1. الإقلاع

```
[entrypoint] first start: initialising embedded Postgres 16 in /data/pg
[migrate] applied 0001-noop … 0004-read-progress-book-restrict
[sources] suwayomi: could not list sources (fetch failed)
[sources] 1 source(s) available (1 built-in, 0 pack, 0 custom, 0 extension (engine still starting))
[sources] suwayomi: connected on retry (0 extension source(s))
Server listening at http://127.0.0.1:3000
```

- `uchiyomi` healthy بعد **9 ثوانٍ**. `uchiyomi-suwayomi` (JVM) بعد **~9 ثوانٍ** من إعادة التشغيل.
- أحجام الصور: `uchiyomi` **274 MB**، `suwayomi-server` **1.4 GB**.
- **تأكيد D-01 حيًّا:** Uchiyomi يتصل بـSuwayomi من نفسه. لم نكتب سطرًا واحدًا.

---

## 2. الحسابات — الخطوة 3 ✅

المسار الرسمي (وليس `INSERT` يدويًا في Postgres):

```bash
GET  /api/setup/status         → {"needsSetup":true}
POST /api/setup                → أول admin + accessToken فورًا
POST /api/admin/users          → بقية الحسابات
```

| username | display_name | role |
|---|---|---|
| mishal | mishal | admin |
| mansour | **منصور** | user |
| dahmi | **دحمي** | user |

**ملاحظتان:**
1. `POST /api/setup` **يتجاهل `displayName`** — رجع `"mishal"` بدل `"مشعل"`. الإصلاح: `PATCH /api/admin/users/{id}` بعده. (خلل صغير في upstream يستحق issue.)
2. المصادقة **Bearer JWT قصير العمر (900 ثانية)** + refresh. الكوكيز لا تعمل مع `/auth/me`.
   → `SourceAdapter` عندنا يحتاج **API token** (`uy_…`) بنطاق، لا جلسة مستخدم.

---

## 3. المصادر — الخطوة 4 ⚠️

### الكتالوج

```
POST /api/admin/extensions/repos   ← keiyoushi/extensions/repo/index.min.json
POST /api/admin/extensions/refresh → {"ok":true,"count":1392}
```

**1,392 إضافة، منها 38 عربية.** قائمتك في §9 من المخطط القديم كانت 49 اسمًا؛ الكتالوج يغطي
منها ~36، ويضيف اسمين لم تكونا في قائمتك: **EShadow** و**Oduto**.

الـ38 المتاحة فعلًا:

```
3asq · Anyone Manga · Area Manga · AriaToon · Azora · Comic Verse · Despair Manga
Detective Conan Ar · Dilar · EShadow · Hijala · HizoManga · Kawii Manga · Lava Scans
Loner Translations · Manga Ai Land · Manga Starz · Manga Tales · MangaCloud · MangaDar
Mangalek · Mangalink · MangaLionz · MangaSpark · MangaSwat · MangaTek · MangaTime
Manhatok · Murim · NeverScans · Oduto · Onma · Orca Manga · Rocks Manga · StellarSaber
Team X · XSano Manga · Yokai
```

غير موجودة في الكتالوج من قائمتك: `MangaTuk، Manhatic، Arab Manhwa، Arab Toons، Area Scans،
Empire Webtoon، ArbxComix، Brown Manga، Duskory Vile، Goon Scans، Yonabar، Yuri Moon Sub`.

**سقف مؤكد:** `"cap": 25` — لا يمكن تفعيل 38 معًا بالإعداد الافتراضي.

### جدول الحكم لكل مصدر — `Nano Machine`

| المصدر | POPULAR | search (EN) | search (AR) | الفصول | الصفحات | الحكم |
|---|---|---|---|---|---|---|
| **Azora** | — | ✅ 1 | — | ✅ **332** | ✅ **40** | `SUPPORTED` |
| **MangaSwat** | — | ✅ 1 | — | ✅ **330** | ✅ **14** | `SUPPORTED` |
| Mangalek | — | ✅ 3 | — | ❌ Cloudflare | — | `NEEDS_FLARESOLVERR` |
| Team X | ✅ 10 | ⚠️ 11 **غير ذات صلة** | ❌ 0 | — | — | `SEARCH_BROKEN` |
| 3asq | ✅ 21 | ❌ 0 | ⚠️ 3 **غير ذات صلة** | — | — | `SEARCH_BROKEN` |

**معدل النجاح الكامل من أول محاولة: 2 من 5 = 40%.**
بإسقاط هذه النسبة على 38 إضافة ⇒ توقع واقعي **12–20 مصدرًا صالحًا**، وكل واحد يحتاج اختبارًا فرديًا.

### ثلاثة اكتشافات تغيّر المخطط

**أ) Cloudflare إلزامي لا اختياري.**
خطأ Suwayomi الحرفي:

```
java.io.IOException: Cloudflare bypass currently disabled
```

المهم: **البحث نجح والفصول فشلت على نفس المصدر.** أي أن مصدرًا يمكن أن يبدو سليمًا في
البحث ويسقط عند الفصول. أي اختبار صحة يكتفي بالبحث = اختبار كاذب.

**ب) حالة غير موجودة في نموذج §7: `SEARCH_BROKEN`.**
Team X و3asq **حيّان تمامًا** — POPULAR يرجّع One Piece وBerserk وKingdom — لكن بحثهما
يرجّع نتائج غير ذات صلة أو صفرًا. `Source Registry` في المخطط فيه `PARSER_FAILED` و
`LIMITED` لكن ليس فيه "حيّ والبحث معطوب"، وSmart Reader يعتمد على البحث لإيجاد الـvariants.

**القرار المطلوب:** إضافة `SEARCH_BROKEN` للحالات، والتحول إلى `POPULAR/LATEST + title match`
كمسار بديل لاكتشاف العمل عند هذه المصادر.

**ج) الدمج التلقائي موجود upstream.**
`GET /api/sources/search-all?q=…` يرجّع **مُجمّعًا بالعنوان مع `providers[]`**:

```json
{ "title": "Mao",
  "providers": [ { "source": "sw:1073624495230267708", "name": "مانجا العاشق (AR)", "sourceId": "25" } ],
  "inLibrary": false }
```

و`GET /api/sources/find?q=nano machine` أرجع **Nano Machine من 3 مصادر عربية** في استجابة واحدة.
⇒ طبقة `CanonicalWork` عندنا **ليست بناءً من الصفر**، بل إثراء فوق تجميع قائم.

---

## 4. الصور — تحقق فعلي بالبايتات

تنزيل مباشر لصفحات الفصل 1، مع sniff للـmagic bytes (لا ثقة بـContent-Type):

| المصدر | HTTP | النوع | الأبعاد | الحجم |
|---|---|---|---|---|
| MangaSwat p0–p2 | 200 | **WEBP** | — | 436 / 392 / 437 KB |
| Azora p0–p2 | 200 | **JPEG** | **900 × 3613** | 550 / 499 / 584 KB |

- **لا HTML، لا challenge، لا placeholder.** صور حقيقية تُفكّ.
- Azora = شرائح webtoon طويلة (‎900 عرض × 3613 طول).
- عُوينت `Azora-p0` بصريًا: صفحة Nano Machine فصل 1، **نص عربي داخل البالونات سليم ومقروء**،
  وعليها ترويسة علامة الموقع `azorafly.com`.

**أثر على المخطط:** شريحة واحدة نصف ميغابايت. فصل 40 شريحة ≈ **20 MB**. هذا هو الرقم
الذي تُحسب عليه سياسة `/data/translations` والنسخ الاحتياطي على R2، لا التقدير القديم.

---

## 5. مصدر حقيقة التقدم — الخطوة 6 ✅ محسوم

الـAPI الموجود يحكم القضية:

```
PUT /api/books/{id}/progress      ← Uchiyomi يملك التقدم
GET /api/history                  ← تاريخ القراءة
GET /api/stats  ·  /api/wrapped   ← إحصائيات + ملخص سنوي
```

**القرار (D-02):** Uchiyomi هو المصدر الوحيد. VANTARA لا يكتب تقدمًا أبدًا.

---

## 6. ما وجدناه جاهزًا وكان المخطط ينوي بناءه

فحص `openapi.yaml` (5,430 سطرًا) كشف أن اليوم الثاني في المخطط القديم **مبنيّ جزئيًا مسبقًا**:

| المخطط ينوي بناءه | موجود upstream |
|---|---|
| Ratings | `PUT/DELETE /api/ratings/{seriesId}` |
| القوائم المشتركة | `/api/collections` + `/items/bulk` |
| التعليقات (جزئيًا) | `/api/notes` لكل عمل |
| الإحصائيات | `/api/stats` + `/api/wrapped` |
| Source Health + Registry | `/api/admin/sources/{id}/test` · `/sources/check` · `status` · `blockedUntil` |
| ChapterVariant | `/api/series/{id}/versions` |
| جودة المصدر لكل عمل | `/api/series/{id}/groups` + `scanlatorPrefs` (حظر + أولوية) |
| الفصول الناقصة | `/api/series/{id}/listing` (**"ghosts"**) |
| أفضل نسخة لكل فصل | `/api/sources/fill/scan` + `/api/sources/fill` |
| مصادر متعددة للعمل | `POST /api/admin/series/{id}/sources` |
| Audit log | `/api/admin/audit` |
| Offline | `/api/offline/plan` + `/api/downloads` |
| سياسة المحتوى | حقل `max_age_rating` في المستخدم + `hiddenAdult` في الكتالوج |
| Admin Dashboard | `/api/admin/*` كامل + `/api/admin/health` |

**⇒ الذي يبقى حصريًا لـVANTARA:**
Presence · Send/Recommend · Activity Feed · تعليقات بردود وتفاعلات · بروفايلات اجتماعية
(Avatar/Banner/Favorite 4) · تقييم جماعي مُجمّع · THE ORBIT · Deleted Works للجميع ·
سياسة BL/GL · **الترجمة العربية** · Reports workflow.

هذه قائمة **أصغر بكثير** من §49 في المخطط القديم — وهذا أفضل خبر في الـSpike.

---

## 7. ما لم يُنفَّذ هنا ولماذا — الخطوات 7 إلى 9

**XianScan لم يُشغَّل.** السبب ليس فنيًا في XianScan، بل بيئي:

1. **MITM TLS.** ظهر أولًا كـ`PKIX path building failed` في الـJVM؛ أُصلح بحقن 152 شهادة
   في `cacerts`. XianScan (Rust/reqwest) وChromium الخاص بـFlareSolverr يحملان
   truststores مستقلة وسيفشلان بنفس الطريقة عند تنزيل موديلات ONNX.
2. **لا GPU + 4 vCPU + `vfs`** — أي زمن نقيسه هنا مضلّل، وقياس الزمن هو **كامل الهدف**
   من الخطوة 8.

**الخطوات 7–9 تُنفَّذ على جهاز مشعل، ولا تُفوَّض.** انظر `SPIKE.md`.

---

## 8. خط أساس الذاكرة (D-08)

| المكوّن | المقياس |
|---|---|
| صورة `uchiyomi` | 274 MB قرص |
| صورة `suwayomi-server` | 1.4 GB قرص |
| Suwayomi JVM | ~800 MB ذاكرة (موثّق upstream) |
| FlareSolverr | 150 MB خمول → سقف 2 GB |

FlareSolverr موثّق في upstream: تسرّب حتى **2.5 GB في 62 يومًا**، و**7 أعطال في 24 ساعة**
على تثبيت واحد. Cloudflare **مُعالَج بالتصميم، ومصدر أعطال مُراقَب** — وقد ثبت هنا أنه
الفرق بين `SUPPORTED` و`FAILED` لمصدر عربي حقيقي.

---

## 9. الأوامر لإعادة إنتاج كل ما سبق

```bash
curl -O https://raw.githubusercontent.com/AngeloSha/uchiyomi/main/deploy/docker-compose.yml
docker compose up -d
# افتح http://localhost:8080 وأنشئ حساب المدير
TOK=$(curl -s -X POST localhost:8080/auth/login -H 'Content-Type: application/json' \
  -d '{"username":"mishal","password":"..."}' | jq -r .accessToken)
A="Authorization: Bearer $TOK"
curl -X POST -H "$A" -H 'Content-Type: application/json' localhost:8080/api/admin/extensions/repos \
  -d '{"url":"https://raw.githubusercontent.com/keiyoushi/extensions/repo/index.min.json"}'
curl -X POST -H "$A" localhost:8080/api/admin/extensions/refresh
curl -H "$A" "localhost:8080/api/admin/extensions/catalog?lang=ar" | jq '.content[].name'
```

سكربتات الفحص محفوظة في [`probes/`](./probes/).
