# VANTARA — Backend Freeze & Independent Review Brief

> **الحالة الحالية:** `BACKEND_STABLE = ✅`
>
> **تاريخ التجميد:** 2026-09-20
>
> **Implementation freeze SHA:** `d9420388ddcfd1c41d16f211fce03698f4eebbc8`
>
> هذه الوثيقة هي نقطة الدخول للمقيّم المستقل. لا تطلب منه تصديقها؛ بل تعطيه
> الادعاءات والأدلة والمسارات التي يجب أن يحاول كسرها.

---

## 1. ما الذي نعتبره مجمّدًا؟

نطاق التجميد هو Backend/Infrastructure الحالي لـVANTARA:

- Content API: `apps/api`
- PostgreSQL + migrations: `packages/db`
- Uchiyomi client/integration: `packages/uchiyomi`
- domain contracts: `packages/domain`
- Cloudflare Sync Worker + D1: `services/sync-worker`
- operational Docker/backup/restore: `infra`
- production CI/deploy gates تحت `.github/workflows`
- العقود الضرورية مع الويب/Android التي تثبت صحة النقل والمصادقة والمزامنة

**لا يعني Backend Freeze أن VANTARA كله Release Ready.** الأداء المحلي للعميل،
إعادة التصميم، B13، Video Engine، واكتمال الترجمة خارج هذا الإعلان.

---

## 2. أدلة التجميد

كل الأدلة التالية على نفس SHA:

| الدليل | Run | النتيجة |
|---|---:|---|
| VANTARA CI | #480 · `35500443188` | ✅ SUCCESS |
| Sync Worker production deploy | #17 · `35500535440` | ✅ SUCCESS |
| Cloudflare Pages production deploy | #16 · `35500535411` | ✅ SUCCESS |
| Android debug APK | #200 · `35500443298` | ✅ SUCCESS |

### ماذا أثبت VANTARA CI #480؟

- فحص تاريخ Git بحثًا عن credential signatures
- رفض الملفات السرية المتتبعة
- repository safety invariants
- operational script validation
- clean PostgreSQL bootstrap
- logical backup + restore
- lint
- build
- typecheck
- كل اختبارات Node/Web
- تشغيل PostgreSQL وUchiyomi حقيقيين
- إنشاء مستخدم Uchiyomi مؤقت
- إثبات self-revocation لتوكن Uchiyomi
- تطبيق PostgreSQL migrations
- إقلاع API الحقيقي وhealth smoke
- restart حقيقي لـPostgreSQL مع **نفس API process** ثم recovery
- restart حقيقي لـUchiyomi مع **نفس API process** ثم recovery
- live API integration
- translation-worker test suite

### ماذا أثبت Sync Worker deploy #17؟

- D1 resolution
- تطبيق migrations حتى `0012_atomic_sync_writes.sql`
- نشر Worker الحقيقي
- رفع runtime authentication secrets
- `/health` على Worker المنشور
- وجود الحسابات المتوقعة
- `verify.mjs` على **D1 الحقيقية** باستخدام Trusted Device pairing وAccess Token v2
- idempotent ops
- monotonic progress
- pending/confirm ownership semantics
- presence/incognito
- immutable identity
- logout-all لكل الأجهزة الموثوقة
- cleanup للـfixtures المؤقتة

---

## 2.1 الإغلاق العدائي النهائي

تم دمج **PR #26 — Final backend adversarial closure** إلى `main` في
`d9420388ddcfd1c41d16f211fce03698f4eebbc8`.

بعد الدمج نفسه — وليس على فرع الإصلاح فقط — نجحت الأدلة التالية على نفس SHA:

- VANTARA CI #480: ✅
- Android debug APK #200: ✅
- Cloudflare Pages deploy #16: ✅
- Sync Worker deploy #17: ✅

وأُغلقت findings #10–#23 بعد إدخال regression coverage والإصلاحات إلى `main`.
أما #9 فأُغلق باعتباره عقدًا مقصودًا: access token صادر مسبقًا يبقى صالحًا حتى
انتهاء عمره المحدود (≤15 دقيقة)، بينما revoke يمنع إصدار توكن جديد.

الإصلاحات النهائية التي أغلقت آخر التحفظات شملت:

- **#12:** حارس D1 rollout يفشل مغلقًا لأي SQL لا يمكن إثبات توافقه مع الـWorker القديم.
- **#16:** paired recovery set مع manifest/checksums، منع backup/restore أثناء وجود
  اتصالات تطبيقية، preflight restore، وتعويض القاعدتين مع failure injection.
- **#22:** durable token-mint intent قبل POST غير idempotent ومصالحة آمنة للتوكنات
  الغامضة بلا إبطال credentials مستخدمة فعليًا.
- **#23:** اعتماد expiry الحقيقي من Uchiyomi، proactive rotation، وحالة
  `content_relink_required` صريحة عند تعذر التجديد.

---

## 3. أخطاء حقيقية اكتُشفت أثناء الإغلاق

هذه ليست قائمة افتراضية؛ كلها ظهرت أثناء adversarial closure وأضيف لها regression
coverage أو live verification:

1. **Delta pagination data loss:** حد الصفحة كان يستطيع قطع مجموعة تشترك في `rev`
   وترك صفوف لا يمكن سحبها لاحقًا.
2. **Cross-account sync leakage:** بعض فروقات الحساب الخاصة كانت قابلة للوصول
   لمستخدم آخر قبل إضافة per-table privacy scopes.
3. **False Bearer logout success:** Content API كان يستطيع إرجاع نجاح مع أنه لا
   يملك trusted-device state في D1.
4. **Operational read authorization:** مسارات تشخيص/حذف كانت تدخل handler لمستخدم
   عادي بدل 403 صريح.
5. **PostgreSQL restart killed Node:** idle `pg.Pool` error بلا listener كان
   يسقط عملية الـAPI عند restart/failover.
6. **Non-idempotent token mint retry:** `mintToken()` كان يستطيع تكرار POST بعد
   network ambiguity وترك upstream credentials يتيمة.
7. **Duplicate PostgreSQL social owner:** جداول Social قديمة بقيت بعد انتقال
   الملكية إلى D1؛ أُسقطت فعليًا بـmigration.
8. **Legacy unauthenticated session contract:** `userId` وحده لم يعد إثبات هوية؛
   trusted-device proof مطلوب.
9. **Stale production verifier:** `verify.mjs` كان يستخدم عقد الجلسة القديم؛
   صار الآن يبني حساب تحقق مؤقتًا ويقرن جهازًا حقيقيًا في D1.
10. **Deployment verifier env gap:** أول deploy بعد التجميد كشف أن
    `VANTARA_DEVICE_PEPPER` لم يكن ممررًا لعملية live verification؛ أُصلح
    وأصبح deploy #17 أخضر.

---

## 4. عقود أمن/ملكية يجب على المقيّم مهاجمتها

### Identity/Auth

- Worker URL ليس سرًا ولا يجب أن يكون سرًا.
- `/v1/session` لا يصدر Access Token بمجرد `userId`.
- Trusted Device proof + revocation في D1.
- Content API يقبل Identity Token v2.
- Bearer logout لا يدعي إلغاء جهاز لا يملكه.
- token mint غير idempotent لا يعاد تلقائيًا.

### Data ownership

المصدر التنفيذي للحقيقة:
`packages/domain/src/ownership.ts`

القواعد:
- Uchiyomi يملك catalogue/library/reading progress.
- D1 يملك social/stats/settings/collections.
- PostgreSQL يملك operational reports/policy/source verdicts والجلسات التي تخص
  Content API.
- جداول PostgreSQL الاجتماعية القديمة **متقاعدة ومُسقطة فعليًا**.
- D1 progress مرآة/outbox؛ لا تصبح مالكًا ثانيًا.

### Sync

حاول كسر:
- replay لنفس `op_id`
- duplicate ops داخل batch
- large queues
- stale device progress
- page cap على نفس `rev`
- cross-account delta privacy
- future cursor
- server rev rollback
- write arriving during flush
- logout-all ثم session refresh

### Failure behavior

حاول:
- PostgreSQL restart
- Uchiyomi restart
- Content API outage
- lost response after server apply
- expired/revoked identity token
- partial discovery failure
- upstream 404 مقابل upstream outage
- rate-limit/network ambiguity في non-idempotent upstream calls

---

## 5. ما ليس ضمن Backend Freeze

هذه **ليست Bugs مخفية** في هذا الإعلان؛ هي Scope لاحق أو Product/Client work:

- B13 client performance/local-first hardening:
  - IndexedDB
  - wiring scheduler/cancellation/dedup/netpolicy
  - device performance measurements
- إعادة التصميم البصري F0–F14
- القياس النهائي على Galaxy Tab A9
- اكتمال translation OCR/detection/inpainting على عتاد حقيقي
- Anime/Cinema Video Engine
- Release-candidate UX/accessibility sweep الكامل

Android debug APK الأخضر يثبت أن المشروع يُبنى؛ لا يثبت وحده أن كل تجربة العميل
على جهاز فعلي Release Ready.

---

## 6. تعليمات للمقيّم المستقل

تعامل مع هذه الوثيقة كـ**claims to falsify**.

ابدأ من `main` واقرأ الكود قبل الاستنتاج. شغّل على الأقل:

```bash
pnpm install --frozen-lockfile
pnpm test:safety
pnpm lint
pnpm build
pnpm typecheck
pnpm test
```

ثم افحص خصوصًا:

- auth/session/trusted-device lifecycle
- authorization boundaries
- D1 per-user privacy
- idempotency/atomicity
- cursor pagination
- ownership duplication
- migrations from a clean database
- restart/failover behavior
- upstream retry semantics
- deploy gates and secret handling
- backup/restore
- error mapping: 404 vs 5xx vs auth errors

### صيغة التقرير المطلوبة

لكل مشكلة:

1. Severity: Critical / High / Medium / Low
2. الملف/المسار
3. Root cause
4. خطوات إعادة الإنتاج
5. لماذا الاختبارات الحالية لم تمسكها
6. أثرها: data loss / privacy / auth / availability / correctness
7. regression test المقترح
8. هل تكسر Backend Freeze أم هي خارج النطاق

**لا نريد تقييمًا رقميًا بلا أدلة، ولا مديحًا عامًا. نريد محاولة كسر النظام.**

---

## 7. حالة المشروع بعد التجميد

```text
BACKEND_FREEZE = ✅
BACKEND_ADVERSARIAL_CLOSURE = ✅
BACKEND_LIVE_CI = ✅  (#480)
SYNC_WORKER_PRODUCTION_VERIFY = ✅  (#17)
WEB_PRODUCTION_DEPLOY = ✅  (#16)
ANDROID_DEBUG_BUILD = ✅  (#200)

CLIENT_B13 = OPEN
FULL_PRODUCT_RELEASE_READY = NOT YET
```

أي دليل جديد من المقيّم يعيد فتح البند المتأثر فورًا. التجميد ليس حصانة؛ هو
Baseline ثابت يمكن مقارنته ومراجعته.
