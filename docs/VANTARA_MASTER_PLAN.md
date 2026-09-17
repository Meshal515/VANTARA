# VANTARA — Master Repair, Verification & Redesign Plan

> **الحالة:** المصدر الرسمي الوحيد لخطة إصلاح VANTARA وإعادة تصميمه.
>
> **تاريخ البداية:** 2026-09-17  
> **فرع العمل:** `fix/stability-sweep-20260917`
>
> **قاعدة حاكمة:** لا تُعتبر أي مشكلة "تم إصلاحها" لمجرد أن الكود تغيّر. علامة ✅ لا توضع إلا بعد: اختبار فاشل يثبت المشكلة عندما يكون ذلك ممكنًا، تنفيذ الإصلاح، نجاح الاختبارات المستهدفة، نجاح CI، تجربة فعلية للمسار المتأثر، ثم تعقيب لاحق للتأكد أن الإصلاح لم ينكسر بسبب باتش تالٍ.

---

## 0. قواعد المشروع غير القابلة للكسر

1. **الباك إند أولًا، الفرونت إند ثانيًا.** لا تبدأ إعادة التصميم الكبيرة قبل الوصول إلى `BACKEND STABLE`.
2. أثناء مرحلة الباك إند يُسمح بلمس الفرونت فقط إذا كان ذلك ضروريًا لعقد API، الهوية، الاختبارات، التشخيص، أو التحقق من تدفق حقيقي. لا تجميل بصري في هذه المرحلة.
3. المرجع البصري الذي اختاره صاحب المشروع هو **مرجع للتكوين، المسافات، الأحجام، الكثافة، الألوان، الحركة وتجربة الاستخدام فقط**. ليس مرجعًا للمعمارية، تسجيل الدخول، المصادر، الجلسات، Cloudflare، قواعد البيانات، القارئ أو المزامنة.
4. لا يُعاد بناء نظام يعمل فقط لأن الشكل الجديد أسهل لو أُعيدت كتابته. **نحافظ على السلوك ونبني العرض حوله.**
5. أي تغيير معماري جديد يجب أن يُكتب في هذا الملف قبل تنفيذه، مع سبب واضح وتأثيره على العقود الحالية.
6. لا يوجد "إصلاح صامت". كل إصلاح يجب أن يملك Issue ID في هذا الملف، حالة، دليل تحقق، وتعقيب.
7. لا يُسمح بوضع ✅ إذا كان CI أحمر، أو لم يُجرَّب المسار الحقيقي، أو بقي جزء تابع للإصلاح غير مؤكد.
8. بعد كل Patch: تحديث هذا الملف فورًا بالحالة، commit/PR، الاختبارات، وما بقي.
9. بعد كل Patch مهم: **تعقيب قصير** على الإصلاحات السابقة التي يمكن أن يتأثر بها.
10. بعد إنهاء كل الباتشات: **لفة أخيرة إجبارية على المستودع كاملًا**: README، docs، workflows، API، Worker، DB، Web، Reader، Android، Docker، tests، secrets/config، dependencies، الملفات المتتبعة. أي شيء جديد يُكتشف يعود كIssue جديد ولا يتم تجاهله لأن الخطة "خلصت".
11. لا نعتبر CI الأخضر وحده دليلًا على سلامة المنتج. المطلوب تحقق End-to-End حقيقي.
12. `translation-worker` غير مكتمل عمدًا حاليًا؛ لا يُصنف كBug ما لم ندخله رسميًا في نطاق الإصدار.

---

## 1. مفتاح الحالات

| العلامة | المعنى |
|---|---|
| ⬜ | لم يبدأ |
| 🟡 | قيد العمل |
| 🧪 | نُفذ تغيير أو اختبار لكن لم يكتمل التحقق المطلوب |
| 🔁 | يحتاج تعقيب بعد Patch تابع |
| ✅ | تم إصلاحه والتحقق منه وتعقيبه |
| ⛔ | محجوب بسبب اعتماد أو قرار معماري |
| 💤 | خارج نطاق الإصدار الحالي عمدًا |

---

# القسم الأول — BACKEND

## 2. سجل المشاكل الرئيسي

### P0 — مشاكل مانعة للاستقرار

| ID | الحالة | المشكلة | الأثر | Patch |
|---|---|---|---|---|
| BE-P0-01 | ⬜ | نظاما Login منفصلان: Worker يعرف المستخدم وContent API لا يعرفه | الدخول ينجح ظاهريًا ثم المكتبة/الفصول تفشل | B2 |
| BE-P0-02 | ⬜ | `/v1/session` في Sync Worker يصدر Session بمجرد اختيار userId بلا إثبات جهاز موثوق | من يعرف Worker URL يستطيع انتحال أحد الحسابات الثلاثة | B2 |
| BE-P0-03 | ⬜ | افتراض أن Worker URL سري بينما يُحقن في الواجهة/التطبيق | ينسف الافتراض الأمني الحالي | B2 |
| BE-P0-04 | ⬜ | Pages/APK origin لا يطابق نموذج Content API الحالي المعتمد على same-origin/Cookie | طلبات API الخارجية تفشل أو تصبح هشة | B3 |
| BE-P0-05 | ⬜ | Cookie `SameSite=Lax` ليس نموذجًا مناسبًا لـAPK `https://localhost` → API خارجي | جلسة المحتوى لا تنتقل بصورة موثوقة | B3 |
| BE-P0-06 | ⬜ | صور القارئ محمية بجلسة API بينما `<img>` لا يحمل Bearer token | صور الفصول قد تفشل على APK | B3 |
| BE-P0-07 | ⬜ | حفظ التقدم في مسار مختلف عن بقية عميل API وقد ينسى credentials/auth | تقدم القراءة قد لا يُحفظ | B3/B4 |
| BE-P0-08 | ⬜ | Postgres ينشئ `vantara` بينما Uchiyomi يتصل افتراضيًا بقاعدة `uchiyomi` غير المنشأة | Clean install قد يفشل | B1 |
| BE-P0-09 | ⬜ | VANTARA Postgres migrations موجودة لكن API لا يشغلها عند الإقلاع | API قد يقلع مع Schema ناقص | B1 |
| BE-P0-10 | 🧪 | أي feature branch كان يستطيع نشر نفس Worker وتعديل D1 الإنتاجية | فرع تجريبي قد يضرب الإنتاج | B0 |
| BE-P0-11 | ⬜ | Docker/API يفترض same-origin static serving، لكن صورة الإنتاج لا تحمل `apps/web` | تناقض بين المعمارية الفعلية وما يفترضه السيرفر | B3 |
| BE-P0-12 | ⬜ | لا يوجد عقد هوية موحد يفهمه Worker وContent API | أساس أغلب أعطال التكامل | B2 |

**ملاحظة BE-P0-10:** إصلاح B0 على فرع الإصلاح يمنع النشر المباشر من feature branch: Worker/D1 لا يعملان إلا عبر `workflow_run` بعد نجاح `VANTARA CI` على `main`، ويُنشر SHA الذي اختبره CI نفسه. الفروع القديمة التي كانت تحمل Workflows مميّزة جُمّدت كذلك. تبقى الحالة 🧪 حتى تُدمج البوابة الآمنة في الفرع الافتراضي بدل إعلان حماية إنتاج غير مفعلة على `main`.

---

### P1 — مشاكل وظيفية/معمارية مهمة

| ID | الحالة | المشكلة | الأثر | Patch |
|---|---|---|---|---|
| BE-P1-01 | 🧪 | Pages production branch = `main` بينما التطوير الفعلي كان على فرع أحدث | Preview حديث وProduction قديم | B0 |
| BE-P1-02 | ⬜ | API يرجع `source.id` والواجهة تستخدم `source.sourceId` | ترتيب المصادر واللغة/fallback يتشوه | B6 |
| BE-P1-03 | ⬜ | Library route في الواجهة يرجع Home بدل شاشة مكتبة حقيقية | وظيفة ظاهرة لكنها غير موجودة | B7/F4 |
| BE-P1-04 | ⬜ | Explore route يرجع Home بدل شاشة مستقلة | استكشاف غير مكتمل | B7/F4 |
| BE-P1-05 | ⬜ | Favorites placeholder | ميزة غير مكتملة | B7/F9 |
| BE-P1-06 | ⬜ | Read Later placeholder | ميزة غير مكتملة | B7/F9 |
| BE-P1-07 | ⬜ | Downloads placeholder | ميزة غير مكتملة | B7/F9 |
| BE-P1-08 | ⬜ | Recommendations placeholder/نموذجها غير مكتمل | اجتماعي غير مكتمل | B8/F8 |
| BE-P1-09 | ⬜ | Progress موجود في Uchiyomi وD1 كمصدرين للحقيقة | يمكن أن يصبح التقدم 20 هنا و35 هناك | B4 |
| BE-P1-10 | ⬜ | Offline queue قد يسقط عمليات قديمة عند الامتلاء | فقد events/usage/reads | B5 |
| BE-P1-11 | ⬜ | Sync token طويل العمر في localStorage مع revoke غير حقيقي لكل جهاز | خطر جلسة مسروقة طويلة العمر | B2/B5 |
| BE-P1-12 | ⬜ | أخطاء push/sync تُبلع ولا يوجد Sync Health واضح | التطبيق يبدو سليمًا بينما الكتابات معلقة | B5/B10 |
| BE-P1-13 | ⬜ | توصية إلى الجميع لها state واحد مشترك | مستخدم يغيّر حالة التوصية للجميع | B8 |
| BE-P1-14 | ⬜ | Presence/Profile/Social لها نسخ ومسؤوليات متداخلة بين Postgres وD1 | ملكية بيانات غير واضحة | B4/B8 |
| BE-P1-15 | ⬜ | README/Blueprint/قرارات قديمة لا تطابق الواقع الحالي | المطور/AI يبني على معمارية خاطئة | B12 |
| BE-P1-16 | ⬜ | لا توجد ownership matrix رسمية لكل نوع بيانات | تكرار جداول/منطق مستقبلًا | B4 |
| BE-P1-17 | ⬜ | المصدر/fallback تفاصيله التقنية تتسرب إلى واجهة الفصول | UX تقني بدل "افتح واقرأ" | B6/F6 |
| BE-P1-18 | ⬜ | لا يوجد نظام تنبيهات داخل التطبيق مضبوط من البداية للنهاية | التوصيات/الأحداث لا تصل كتجربة داخلية متماسكة | B9/F8 |
| BE-P1-19 | ⬜ | لا يوجد فصل واضح بين Notification Inbox وظهور Toast داخل التطبيق | إطفاء المنبثق قد يضيع معنى الإشعار | B9 |
| BE-P1-20 | ⬜ | لا توجد اختبارات E2E لمسار: login→library→chapter→images→progress | CI لا يثبت تجربة المستخدم | B11/B12 |

---

### P2 — Hygiene / Hardening

| ID | الحالة | المشكلة | الأثر | Patch |
|---|---|---|---|---|
| BE-P2-01 | 🧪 | `.env` متتبع في Git ولا يوجد root ignore مناسب | خطر Secrets لاحقًا | B0 |
| BE-P2-02 | 🧪 | `__pycache__/*.pyc` متتبع | Repository hygiene سيئ | B0 |
| BE-P2-03 | ⬜ | بعض صور الخدمات الاختيارية تستخدم `latest` رغم سياسة pinning | ترقيات صامتة | B1/B12 |
| BE-P2-04 | ⬜ | README يقول إن التنفيذ لم يبدأ رغم وجود نظام كامل | وثائق مضللة | B12 |
| BE-P2-05 | 🧪 | لا توجد آلية نهائية تمنع رجوع الملفات الممنوعة إلى Git | regression hygiene | B0 |

---

## 3. سجل تحقيقات تحتاج إثبات قبل تحويلها إلى Bugs

هذه البنود **ليست Bugs مؤكدة بعد** ولا يجوز إصلاحها بالتخمين. إذا ثبتت، تُنقل لسجل المشاكل الرئيسي مع ID جديد.

| ID | الحالة | التحقيق |
|---|---|---|
| INV-01 | ⬜ | مراجعة `android:allowBackup=true` وتأثيره على بيانات الجلسة/localStorage |
| INV-02 | ⬜ | مراجعة FileProvider الذي يسمح external path واسعًا وهل يوجد أي مسار مشاركة فعلي يستغله |
| INV-03 | ⬜ | مراجعة CSP النهائية بين Pages/API وعدم الاكتفاء بأن API عطّل CSP لأنه لا يقدم الواجهة |
| INV-04 | ⬜ | مراجعة session revoke في Uchiyomi: هل VANTARA revoke يلغي upstream token فعلًا أم يتركه صالحًا |
| INV-05 | ⬜ | مراجعة limits/timeouts والـrate limits لمسارات القراءة والصور والبحث تحت حمل واقعي + هامش كبير |

### قيد خارجي مؤكد في B0

`OPS-EXT-01` — GitHub repository rulesets/branch protection لهذا المستودع الخاص غير متاحة على الخطة الحالية. استدعاء GitHub Rules API أعاد `403` مع طلب **GitHub Pro أو جعل المستودع عامًا**. لذلك لا ندّعي وجود حماية منصة تمنع صاحب الصلاحية من direct push إلى `main`. نعوّض داخل المستودع ببوابات نشر لا تعمل إلا بعد CI ناجح، لكن هذا القيد يبقى موثقًا ولا يُخفى.

---

# 4. Backend Patch Workflow

كل Patch Backend يمر بالترتيب الآتي بلا اختصار:

`Evidence → Root cause → failing regression test → minimal fix → targeted tests → full CI → preview/deploy-safe verification → TinyFish/live flow where applicable → PostHog/observability check where applicable → update this MD → follow-up mark 🔁/✅`

### شرط ✅

لا تتحول المشكلة إلى ✅ إلا إذا وُجد تحتها أو في سجل الباتش:

- commit/PR reference
- الاختبار الذي يمنع رجوعها
- نتيجة CI
- نتيجة التجربة الفعلية
- نتيجة التعقيب بعد Patch تابع واحد على الأقل إذا كان الإصلاح معماريًا أو مشتركًا

---

# 5. Backend Patches

## B0 — Safety Gate & Repository Hygiene

**الهدف:** منع أي تجربة من لمس الإنتاج قبل بدء الجراحة المعمارية.

**يشمل:**
- BE-P0-10
- BE-P1-01
- BE-P2-01
- BE-P2-02
- BE-P2-05

**بوابة النجاح:** feature branch لا يستطيع تنفيذ migration أو deploy على D1/Worker الإنتاجي؛ Pages production branch واضح؛ الملفات الحساسة/المؤقتة غير متتبعة؛ CI يثبت ذلك.

**الحالة:** 🧪 **التنفيذ والاختبارات على فرع الإصلاح مكتملة؛ التفعيل على الفرع الافتراضي ينتظر قرار التكامل.**

### ما نُفذ

- أزيل `.env` من Git، وبقي `.env.example` فقط كقالب موثق.
- أضيفت قواعد `.gitignore` لـ`.env` و`.env.*` مع استثناء `.env.example`، ولـ`__pycache__` و`*.py[cod]`.
- أزيلت ملفات Python cache المتتبعة من المستودع.
- أضيف `tools/repository-safety.test.mjs` وأُدخل في CI قبل بقية الخطوات.
- Sync Worker/D1 الإنتاجي أصبح `workflow_run` فقط بعد نجاح `VANTARA CI` على `main`، ويعمل على `head_sha` المختبر نفسه؛ لا `push` مباشر ولا `workflow_dispatch` إنتاجي.
- Cloudflare Pages الإنتاجي يتبع نفس البوابة، مع `CF_PRODUCTION_BRANCH=main` صراحة، ومسار release يتحقق من CI قبل لمس Cloudflare.
- Android signed release أصبح tag-only؛ الـtag يجب أن يكون على commit داخل `main` واجتاز `VANTARA CI` قبل قراءة مفاتيح التوقيع.
- جُمّدت Workflows النشر المميّزة في الفروع القديمة بدل ترك أبواب جانبية:
  - `chatgpt/release-current`: Pages freeze commit `1e387da1`.
  - `chatgpt/source-audit-deploy`: Pages freeze commit `249f0eec`.
  - `claude/dreamy-faraday-w9rtsp`: Pages `1567a647`، Worker/D1 `47aca43b`، Android release `f91b368e`.

### Red → Green

اختبار سلامة المستودع أُضيف أولًا وهو يفشل على الحالة القديمة بسبب `.env`، Python caches، ومسارات النشر غير المحمية. بعد الإصلاح صار أخضر. ثم شُدد الاختبار مرتين ليكشف مساري release في Pages وAndroid، وفشلا قبل إضافة تحقق CI ثم عادا للأخضر.

### الدليل الحالي

- **آخر CI كامل قبل تحديث هذا السجل:** run `35259017442` على SHA `df274e3c206330a274fb519bd63d295db6999a0e` = `success`.
- Job `node`: Repository safety invariants + install + lint + build + typecheck + tests = كلها `success`.
- Job `translation-worker`: deps + fonts + RAQM + `pytest -q` = كلها `success`.
- قائمة runs لفرع الإصلاح لا تحتوي Worker/Pages production deploy على SHA B0؛ أي أن اختبار/تعديل feature branch لم يشغّل الإنتاج.
- بعد تجميد فرع Claude القديم، أحدث pushes للتجميد شغلت CI فقط؛ سجلات Deploy الظاهرة لذلك الفرع تاريخية على SHAs أقدم وليست ناتجة عن freeze commits.
- مقارنة قاعدة الكود الفعلية التي بدأ منها B0 (`5ecbcf79...`) مع SHA B0 أظهرت أن التغييرات محصورة في workflows/hygiene/tests/plan، لا منطق تطبيق جديد.

### بوابة التكامل الباقية

`main` أقدم من قاعدة الكود التي بُني عليها B0. مقارنة `main` بفرع الإصلاح أظهرت أن فرع الإصلاح أمامه **38 commit** تشمل أصلًا Android/Web/Sync/API وتغييرات سابقة ليست من B0. لذلك **لا يجوز دمج B0 إلى main تحت وصف "باتش أمان صغير"**؛ هذا سيكون ترقية قاعدة التطبيق الحالية كاملة. قرار التكامل منفصل وصريح.

كذلك لا توجد GitHub Rulesets متاحة للمستودع الخاص على الخطة الحالية (`OPS-EXT-01`). هذا لا يلغي بوابات CI داخل الكود، لكنه يمنع الادعاء أن direct push إلى `main` محظور من GitHub نفسه.

### ما لا يدخل B0

اختبار/تنفيذ CORS نُقل بالكامل إلى **B3**. لا يوجد failing CORS test متروك في B0، ولا نصلح Transport ضمن Safety Gate.

---

## B1 — Clean Install, DB Bootstrap & Migrations

**الهدف:** بيئة جديدة تقلع بدون خطوات يدوية مخفية.

**يشمل:** BE-P0-08, BE-P0-09, BE-P2-03.

**المطلوب:**
- إنشاء قاعدة Uchiyomi أو توحيد قاعدة Postgres بطريقة مقصودة ومختبرة.
- تشغيل VANTARA migrations قبل فتح API للطلبات.
- readiness يثبت DB + schema + Uchiyomi.
- تجربة backup/restore.
- مراجعة image pinning.

**بوابة النجاح:** clean environment → `docker compose up` → health/readiness خضراء → الجداول موجودة → الخدمات تعيد التشغيل بدون تدخل.

**الحالة:** ⬜.

---

## B2 — Unified Identity & Session Model

**الهدف:** اختيار الحساب يبقى UX الحالي، لكن ينتج هوية واحدة يفهمها Worker وContent API بأمان.

**يشمل:** BE-P0-01, 02, 03, 12 + BE-P1-11 + INV-04.

**ثوابت UX:**
- ثلاثة حسابات.
- اختيار الحساب = دخول مباشر.
- لا Password.
- لا PIN.
- لا form.

**المطلوب معماريًا:** جهاز موثوق + جلسة VANTARA موحدة، access token قصير، refresh/device session قابلة للإلغاء، logout device، logout all، عدم الاعتماد على URL سري كحماية.

**بوابة النجاح:** اختيار مستخدم واحد يجعل Worker وContent API يرونه نفس المستخدم دون Login ثانٍ؛ انتحال userId وحده لا يصدر جلسة؛ revoke يُختبر.

**الحالة:** ⬜.

---

## B3 — Pages/APK ↔ Content API Transport

**الهدف:** مسار شبكة واحد صحيح للمتصفح وAPK.

**يشمل:** BE-P0-04, 05, 06, 07, 11 + INV-03.

**التوجه:** Bearer auth لطلبات JSON بدل الاعتماد على cross-site cookies، CORS allowlist مضبوط، وروابط صور موقعة قصيرة العمر للقارئ إذا ثبت أنها أفضل عقد للصور.

**بوابة النجاح:** APK حقيقي يفتح مكتبة، فصل، كل الصور، ويحفظ progress بدون Cookie assumptions مخفية.

**الحالة:** ⬜. يبدأ Red→Green الخاص بـCORS/Transport داخل B3 نفسه، وليس داخل B0.

---

## B4 — Data Ownership Freeze

**الهدف:** كل نوع بيانات له Source of Truth واحد فقط.

**يشمل:** BE-P1-09, 14, 16.

**الملكية المستهدفة مبدئيًا:**
- Content/library/chapters/source discovery/final reading progress → Uchiyomi/Home Content stack.
- Friends/presence/activity/recommendations/internal notifications/shared social settings → D1.
- VANTARA identity/session → طبقة هوية موحدة.
- Local downloaded pages/cache → الجهاز/Home storage حسب نوعها.

D1 progress إن بقي، يكون mirror/outbox مشتقًا وليس حقيقة ثانية.

**بوابة النجاح:** Ownership Matrix موثقة + لا يوجد مساران يملكان نفس الحقيقة.

**الحالة:** ⬜.

---

## B5 — Offline Queue & Sync Reliability

**الهدف:** لا تضيع عمليات حتى مع انقطاع طويل.

**يشمل:** BE-P1-10, 11, 12.

**المطلوب:** تصنيف العمليات إلى state replacement مقابل cumulative/events، compaction آمن، idempotency، retry/backoff، quarantine للعملية الفاسدة، resync واضح، sync health قابل للرصد.

**بوابة النجاح:** سيناريو offline طويل ثم online لا يفقد chapter completion/usage/activity، ولا يعلق queue كله بسبب عملية واحدة.

**الحالة:** ⬜.

---

## B6 — Source Engine & Chapter Contract

**الهدف:** المستخدم يضغط الفصل ويقرأ؛ إدارة المصادر تبقى خلف الكواليس.

**يشمل:** BE-P1-02, 17.

**المطلوب:** عقد source ثابت (`id/name/language/health/capabilities`)، ranking/fallback/recovery server-side، الفصل يعرض حالة مستخدم مفهومة لا `MISSING/HELD/BLOCKED/...`.

**بوابة النجاح:** إسقاط المصدر الأول أثناء الاختبار يجعل النظام ينتقل للثاني تلقائيًا؛ واجهة المستخدم لا تحتاج معرفة السبب التقني.

**الحالة:** ⬜.

---

## B7 — Library/Search/Explore/Favorites/Read Later/Downloads Contracts

**الهدف:** كل وجهة موجودة في المنتج تملك Backend contract حقيقيًا قبل تصميم الشاشة.

**يشمل:** BE-P1-03, 04, 05, 06, 07.

**بوابة النجاح:** كل ميزة لها endpoint/data contract واختبارات حقيقية، حتى لو واجهتها ما زالت تشخيصية مؤقتة.

**الحالة:** ⬜.

---

## B8 — Social & Recommendations

**الهدف:** Friends/Activity/Recommendations تكون أنظمة مكتملة لا placeholders.

**يشمل:** BE-P1-08, 13, 14.

**المطلوب:** recommendation state per-recipient، presence/privacy، activity events واضحة، profile contract نهائي.

**بوابة النجاح:** توصية جماعية يستطيع كل مستخدم قراءتها/رفضها مستقلًا عن الآخرين.

**الحالة:** ⬜.

---

## B9 — Internal Notifications Only

**الهدف:** تنبيهات داخل VANTARA أثناء فتح التطبيق، **بدون Push للجوال خارج التطبيق**.

**يشمل:** BE-P1-18, 19.

**المتطلبات:**
- Notification Inbox دائم.
- حالات `created / seen / read` أو نموذج مكافئ واضح.
- Toast/side notification داخل التطبيق منفصل عن Inbox state.
- إعداد لتعطيل **التنبيهات المنبثقة داخل التطبيق** دون حذف الإشعارات من الصندوق.
- أنواع يمكن التحكم فيها: توصيات، ردود/تعليقات، تفاعلات، أحداث مهمة.
- لا Firebase/FCM، لا Android push permission، لا تنبيه والجوال مغلق.

**مثال قبول:** دحمي يرسل توصية → إذا VANTARA مفتوح عند مشعل يظهر تنبيه جانبي صغير → إذا تعطلت التنبيهات المنبثقة لا يظهر Toast لكن يبقى العنصر في Inbox.

**الحالة:** ⬜.

---

## B10 — Observability, Error Tracking & Report-a-Problem Backend

**الهدف:** الأعطال الحقيقية تصبح قابلة للرؤية بدل "التطبيق ما اشتغل".

**الأدوات:** PostHog عند الحاجة + logs آمنة.

**نراقب:** auth/session failures، API errors، source fallback failure، reader/image failure، sync backlog، search/chapter latency، unhandled JS errors.

**ممنوع الإرسال:** passwords، access/refresh tokens، signed page URLs، cookies، محتوى حساس غير ضروري.

**بوابة النجاح:** كل خطأ رئيسي له correlation/error ID ويمكن ربط بلاغ المستخدم به.

**الحالة:** ⬜.

---

## B11 — Adversarial & Failure Testing

**الهدف:** نحاول كسر VANTARA بدل اختبار happy path فقط.

**سيناريوهات إلزامية:** Home API down، Worker up، internet offline/online، source 1 down/source 2 succeeds، missing chapter، expired/revoked session، Postgres restart، Uchiyomi restart، duplicate op، queue كبير، slow network، stale client.

**بوابة النجاح:** الفشل المتوقع يعطينا degradation مفهوم ولا يسبب فقد بيانات صامت.

**الحالة:** ⬜.

---

## B12 — Backend Freeze & Documentation Truth

**الهدف:** إعلان `BACKEND STABLE` فقط بعد إثبات المسار الحقيقي.

**يشمل:** BE-P1-15, BE-P2-04, BE-P1-20 + كل 🔁 المتبقية.

**E2E Gate الإجباري:**

`اختيار الحساب → الرئيسية → المكتبة → البحث → إضافة عمل → الفصول → source fallback → الصور → القراءة → progress → إغلاق/فتح → sync → صديق يرسل توصية → internal notification → read → offline → online`

**ثم:** تحديث README/BLUEPRINT/DECISIONS/DEPLOY بحيث تصف النظام الفعلي، وليس تاريخًا قديمًا.

**الحالة:** ⬜.

---

# القسم الثاني — FRONTEND

> لا يبدأ التنفيذ الفعلي لهذا القسم قبل B12، باستثناء تغييرات التكامل الضرورية للباك إند.

## 6. عقد التصميم

المرجع البصري يحدد: التكوين، المسافات، الأحجام، الأغلفة، الخطوط، التسلسل البصري، كثافة المعلومات، القوائم، الفصول، التبويبات، الأزرار، البانرات، التنقل السفلي، الداكن، البساطة والحركة.

ولا يحدد: login، الحسابات الثلاثة، sessions، sync، Cloudflare، Content API، DB، sources، chapter discovery، fallback، reader behavior، progress، friends، activity، notifications architecture.

**الفلسفة:** لو نفس المصمم الذي صمم المرجع صمم VANTARA بكل ميزاته الحالية، كيف سيخفي التعقيد ويعرضه بهدوء؟

---

## F0 — Design Tokens & Visual System

⬜ استخراج spacing/type/cover/radius/navigation/motion/dark/accent tokens من المرجع النهائي. البنفسجي Accent فقط، والأسود/الرمادي أساس، والصور هي اللون الأساسي.

## F1 — App Shell, Bottom Nav & Sidebar

⬜ بناء Topbar/Bottom navigation/Page shell/Transitions/Safe areas/Sidebar.

**Sidebar إلزامي ومهم** ومقسم بصريًا:
- الأساسي: الرئيسية، مكتبتي، استكشف.
- الاجتماعي: الأصدقاء، النشاط، الإشعارات، التوصيات.
- مكتبتي: المفضلة، أقرأ لاحقًا، التنزيلات.
- الحساب: ملفي، تغيير الحساب.
- النظام: الإعدادات، الإبلاغ عن مشكلة.
- الإصدار في الأسفل بخفة.

لا Cards كبيرة لكل مجموعة، ولا badges ضخمة.

## F2 — Account Picker Polish

⬜ تحسين النظافة والحركة والخلفية المستخرجة من الحساب دون تغيير سلوك اختيار الحساب = دخول.

## F3 — Home

⬜ `VANTARA` + tagline + search/bell/avatar صغير، Hero بصري، shortcuts قليلة، Rails لأعمال تتابعها/مقترحة/يقرأها أصدقاؤك. لا cards داخل cards.

## F4 — Library & Explore

⬜ شاشتان حقيقيتان منفصلتان عن Home، مبنيتان فوق عقود B7.

## F5 — Series Page

⬜ قريبة جدًا من المرجع: back/favorite/⋮، cover، title/alt title/genres/rating، Primary CTA واحد، tabs `نبذة/الفصول/معلومات`، Secondary actions داخل ⋮.

## F6 — Chapters

⬜ صفوف هادئة: الفصل/التاريخ/حالة القراءة/تنزيل خفيف. لا مصطلحات المصادر التقنية. تغيير المصدر Secondary action عند الحاجة فقط.

## F7 — Friends/Profile

⬜ Home يعرض friends strip صغير؛ Profile يعرض banner/avatar/name/username/presence/reading/stats/recent activity/favorites حسب الخصوصية، بأقسام واضحة.

## F8 — Notifications, Recommendations & Share

⬜ Bell صغير + purple dot، قائمة إشعارات بسيطة، internal toast، Share bottom sheet مع صور الأصدقاء ورسالة اختيارية.

## F9 — Favorites / Read Later / Downloads

⬜ تحويل placeholders إلى شاشات حقيقية بنفس لغة التصميم.

## F10 — Settings

⬜ إعدادات user-facing أولًا: الحساب، القراءة، التنبيهات داخل التطبيق، الخصوصية، التخزين، حول VANTARA، الإبلاغ عن مشكلة. التقنية العميقة داخل Advanced/Diagnostics فقط.

## F11 — Reader Presentation

⬜ لا إعادة كتابة منطق القارئ. فقط HUD/controls/loading/error/source sheet/motion فوق النظام المختبر.

## F12 — Anti-AI Cleanup

⬜ حذف أي card/pill/border/glow/gradient/icon/text لا يملك سببًا واضحًا. Primary action واحد حيث يمكن.

## F13 — UX / Accessibility / Responsive Verification

⬜ Mobile/Desktop/RTL/scroll/focus/keyboard/tap targets/safe area/loading/errors/empty states/slow network/animations/screenshots.

## F14 — Release Candidate

⬜ Bugs/performance/accessibility/visual consistency/regressions فقط، بلا Features جديدة.

---

# 7. الأدوات المطلوبة في كل مرحلة

| الأداة | الاستخدام |
|---|---|
| Superpowers | systematic debugging، TDD، خطط، code review، verification قبل إعلان النجاح |
| GitHub | source of truth للكود والفروع والـCI والـPRs والـcommits |
| Context7 | توثيق حديث للمكتبات/APIs عند تغيير سلوك تقني |
| Firecrawl | بحث أعمق في upstream docs والمشاريع الخارجية عند الحاجة |
| TinyFish | اختبار حي للنسخ المنشورة وتدفقات المستخدم الفعلية أمامنا |
| PostHog | أخطاء/analytics/observability بعد ربطه بطريقة آمنة |
| Product Design | تدقيق UX/Accessibility خصوصًا بعد Backend Freeze |
| Mobbin | مراجع أنماط UX عند تصميم شاشات، وليس نسخ وظائف تطبيقات أخرى |
| Figma | فقط إذا احتجنا prototype/design canvas فعلي قبل التنفيذ |

**قاعدة:** لا نستخدم Plugin لمجرد أنه موجود. يُستخدم عندما يضيف دليلًا أو قدرة حقيقية للباتش.

---

# 8. سجل التحقق والتعقيب

يُضاف لكل Issue عند إغلاقه:

```text
Fix commit/PR:
Regression test:
Targeted tests:
Full CI:
Runtime/TinyFish verification:
PostHog/log verification (إن انطبق):
Follow-up patch checked:
Final status: ✅
```

إذا فشل أحد البنود، تبقى الحالة 🧪 أو 🔁.

### B0 — سجل التحقق الحالي

```text
Fix branch: fix/stability-sweep-20260917
Base code SHA: 5ecbcf79c96aa66d67f2278a1c8aa8158512d6b7
Verified implementation SHA before this documentation commit: df274e3c206330a274fb519bd63d295db6999a0e
Regression test: tools/repository-safety.test.mjs (Red→Green مثبت)
Targeted tests: pnpm test:safety = success داخل CI
Full CI: run 35259017442 = success (node + translation-worker)
Deploy-safe verification: no Worker/Pages production run on B0 feature SHA; legacy deployment workflows frozen
Runtime/TinyFish verification: غير منطبق على B0؛ لا نغيّر user runtime flow
PostHog/log verification: غير منطبق على B0
Follow-up: عدة commits لاحقة أعادت تشغيل safety/full CI؛ بقي أخضر حتى SHA أعلاه
Integration: PENDING — main متأخر 38 commit عن هذا الفرع؛ لا دمج صامت
Final status: 🧪 حتى قرار التكامل والتحقق بعده
```

---

# 9. Mandatory Final Repository Sweep — شرط الإنهاء النهائي

بعد انتهاء B0→B12 وF0→F14، لا يُعلن VANTARA جاهزًا مباشرة.

يجب تنفيذ Sweep جديد من الصفر وكأننا لم نر المشروع من قبل، ويشمل:

- root files وGit hygiene
- README + كل docs والقرارات
- كل GitHub Actions وproduction gates
- Docker/Compose/health/readiness/backups
- Postgres migrations/schema/ownership
- API auth/session/security/rate limits/errors
- Cloudflare Worker/D1/migrations/ops/sync
- Web app/router/state/network layer
- account picker
- library/search/explore/social/notifications/settings
- reader/images/progress/offline/resume
- Android/Capacitor permissions/storage/backup/FileProvider
- dependencies/pinning/dead code/placeholders
- logs/analytics/privacy/secrets
- جميع tests وE2E

**القاعدة:** أي مشكلة تظهر في هذه اللفة تُضاف إلى هذا الملف بـID جديد، وتُصلح وتُعقّب قبل Release. لا يسمح بعبارة "هذه بسيطة نخليها بعدين" إلا إذا نُقلت صراحة إلى Future Scope مع سبب مقبول.

بعد Sweep النهائي فقط يمكن كتابة:

`FINAL_REPOSITORY_SWEEP = ✅`

`VANTARA_RELEASE_READY = ✅`

حاليًا:

`FINAL_REPOSITORY_SWEEP = ⬜`

`VANTARA_RELEASE_READY = ⬜`

---

# 10. Current Next Step

**التالي مباشرة:** تشغيل CI جديد على commit توثيق B0، ثم مراجعة diff النهائية نسبةً إلى قاعدة الكود `5ecbcf79...`. إذا بقيت خضراء ومحصورة في B0، يصبح تنفيذ B0 جاهزًا لقرار التكامل. بعد قرار التكامل والتحقق من النتيجة، يبدأ B1. **CORS/Transport يبدأ فقط في B3.**
