# VANTARA — Failure Matrix

> **الحالة:** مخرج Patch **B11 — Adversarial & Failure Testing**.
>
> **القاعدة:** الفشل المتوقع يجب أن يعطي تدهورًا مفهومًا، ولا يسبب فقد بيانات
> صامتًا. كل سيناريو في الخطة الرئيسية مذكور هنا بحالة واحدة من اثنتين:
> `COVERED` بمرجع الاختبار، أو `DEFERRED` **مع ما يحتاجه بالضبط**. لا صف بلا
> حالة، ولا حالة بلا دليل. اختبار في `tools/repository-safety.test.mjs` يفشل
> إذا ظهر صف ناقص.

---

## 1. المصفوفة

| # | السيناريو | الحالة | الدليل / ما يحتاجه |
|---|---|---|---|
| 1 | Content API ساقط والـWorker يعمل | `COVERED` | `apps/web/lib/failure.test.js` — التقدم يبقى في الصندوق بلا إقرار · `apps/api/src/failure.test.ts` — 502 صريح لا مكتبة فارغة |
| 2 | انقطاع الإنترنت ثم عودته | `COVERED` | `apps/web/lib/failure.test.js` — 80 كتابة أثناء الانقطاع تصل كلها مرة واحدة بعد العودة |
| 3 | جواب ضائع بعد أن طبّق الخادم | `COVERED` | `apps/web/lib/failure.test.js` — نفس `op_id` لا يُحتسب مرتين · `services/sync-worker/src/ops.test.ts` — حرس `NOT EXISTS` |
| 4 | جلسة منتهية أو مُبطلة في منتصف الدفعة | `COVERED` | `apps/web/lib/failure.test.js` — لا عزل، والكتابات تُعاد بنفس المعرّفات تحت جلسة جديدة |
| 5 | طابور ضخم (260 عملية) | `COVERED` | `apps/web/lib/failure.test.js` — دفعات ≤100، وكل عملية تراكمية تصل مرة واحدة |
| 6 | طابور يتجاوز السقف (600 قراءة) | `COVERED` | `apps/web/lib/failure.test.js` — لا قراءة تُسقط، والصحة تقول `blocked` |
| 7 | شبكة بطيئة وكتابة تصل أثناء الإرسال | `COVERED` | `apps/web/lib/failure.test.js` — الكتابة الجديدة لا تُهمل، تُرسل بعد الدفعة الجارية |
| 8 | عميل قديم وعدّاد خادم رجع للخلف | `COVERED` | `apps/web/lib/failure.test.js` — المرآة تُبنى من جديد والطابور لا يُمسّ |
| 9 | تقدم من جهاز قديم | `COVERED` | `apps/web/lib/failure.test.js` + `packages/domain/src/sync.test.ts` — الدمج بـMAX لا يرجع للخلف |
| 10 | PostgreSQL ساقط | `COVERED` | `apps/api/src/failure.test.ts` — `/healthz` يقول أي تبعية سقطت · المسار الذي يحتاج سياسة الحذف يفشل **آمنًا** لا متساهلًا |
| 11 | Uchiyomi ساقط | `COVERED` | `apps/api/src/failure.test.ts` — 502 على المسار، وتدهور قسم بقسم في الاستكشاف |
| 12 | قسم استكشاف واحد يتعثّر | `COVERED` | `apps/api/src/discovery.test.ts` — `available: false` والباقي يُعرض |
| 13 | فصل ناقص لا يوجد في أي مصدر | `COVERED` | `packages/domain/src/chapters.test.ts` — تدقيق التغطية يسمّي الأرقام الغائبة صراحةً |
| 14 | نسخة فصل محجوبة أو فاشلة | `COVERED` | `packages/domain/src/chapters.test.ts` — `pickCopy` يستثني النسخ الفاشلة |
| 15 | إعادة تشغيل PostgreSQL فعليًا (pool reconnect) | `DEFERRED` | يحتاج PostgreSQL حقيقيًا: `docker compose restart postgres` ثم طلب مباشرة بعده. مسجَّل لـB11 بعد أن تتوفر البيئة، أو لـB12 داخل بوابة E2E |
| 16 | إعادة تشغيل Uchiyomi فعليًا | `DEFERRED` | يحتاج نسخة Uchiyomi حيّة. `spike/uchiyomi-openapi-v0.34.yaml` هو العقد المستخدم في المحاكاة، والحقيقي لم يُشغَّل من هذه البيئة |
| 17 | مصدر أول يسقط ومصدر ثانٍ ينجح | `DEFERRED` | ملك **B6** (`apps/api/src/lib/chapter-fallback.test.ts` على فرعه). لا أكتب تغطية ثانية لنفس المنطق في ملف يملكه باتش قيد التنفيذ |
| 18 | فحوص D1 الحقيقية (الصندوق الصادر، الإخفاء، الإشعارات) | `DEFERRED` | `services/sync-worker/verify.mjs` مكتوب وجاهز، ويحتاج Worker منشورًا وD1 حقيقية. لم يُشغَّل، ولا أدّعي أنه شُغّل |

---

## 2. ما يعنيه «فقد بيانات صامت»

أخطر ما وجدناه ليس خطأً يظهر، بل نجاحًا كاذبًا:

1. **كتابة تُحفظ محليًا ولا تُحفظ فعلًا** — `localStorage` ممتلئ يرفض الكتابة،
   والقيمة المرجعة كانت مُهملة. صار الحفظ يُفرّغ المرآة ليُفسح مكانًا، وإن فشل
   تُعلن الصحة `degraded`.
2. **كتابة تُعلَّم «وصلت المالك» ولم تصل** — `fetch` لا يرمي على 401/502، فجواب
   فاشل كان يُعتبر نجاحًا. صار الإقرار مشروطًا بـ`response.ok`.
3. **الطابور الممتلئ يأكل الأقدم** — والأقدم هو القراءة والوقت، أي ما لا يُستعاد.
4. **استعادة الخادم تمسح كتابات العميل** — لسبب لا علاقة له بها.
5. **توصية للجميع لا تُشعر أحدًا** — تُسجَّل ولا يعرف بها أحد.

الخمسة كانت تبدو من الخارج «التطبيق يعمل».

---

## 3. كيف يُشغَّل

```bash
pnpm test:safety     # حرس المستودع
pnpm test            # كل الحزم + الواجهة
npx vitest run apps/web/lib/failure.test.js   # سيناريوهات العميل المعادية
npx vitest run apps/api/src/failure.test.ts   # تدهور التبعيات
```

وما يحتاج بيئة حقيقية:

```bash
node services/sync-worker/verify.mjs <worker-url>   # D1 حقيقية — لم يُشغَّل بعد
```
