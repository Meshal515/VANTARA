# VANTARA — Failure Matrix

> **الحالة:** B11 مغلق ضمن Backend Freeze بتاريخ 2026-09-20.  
> baseline: `f7c27df61a2423026c794eac0eeba8d175fa7682`.
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
| 15 | إعادة تشغيل PostgreSQL فعليًا (pool reconnect) | `COVERED` | CI #316 — خطوة `Exercise live dependency restarts`: نفس API process نجا من `docker compose restart postgres` وأعاد readiness؛ regression في `packages/db/src/index.test.ts` |
| 16 | إعادة تشغيل Uchiyomi فعليًا | `COVERED` | CI #316 — نفس API process بقي حيًا بعد restart Uchiyomi ثم نجح live API integration |
| 17 | مصدر أول يسقط ومصدر ثانٍ ينجح | `COVERED` | `apps/api/src/lib/chapter-fallback.test.ts` + B6 source contract tests ضمن CI #316 |
| 19 | صور القارئ على الـAPK (الكوكي عبر الأصول) | `COVERED` | `apps/api/src/media.test.ts` — الرابط الموقَّع يُفتح بلا أي اعتماد، ورقم صفحة مُعدَّل يُرفض 403، والمنتهي 401 لا 403 · `apps/web/reader.test.js` — التجديد عند الانتهاء والسقوط لمسار الكوكي عند تعذّر التوقيع |
| 20 | خادم بلا `UCHIYOMI_SERVICE_TOKEN` | `COVERED` | `apps/api/src/media.test.ts` — يُقال عند **التوقيع** (503 على `POST`) لا عند كل صورة، فيسقط العميل لمسار الكوكي مرة واحدة بدل فصل من 503 |
| 21 | فصل أطول من سقف التوقيع (640 صفحة) | `COVERED` | `apps/web/reader.test.js` — العميل يجزّئ الطلب بدل أن يُرفض ويسقط لمسار لا يعمل على الـAPK |
| 22 | توكن الهوية ينتهي في منتصف القراءة | `COVERED` | `apps/web/lib/content-api.test.js` — تجديد واحد ثم إعادة **نفس** الطلب بالتوكن الجديد · `sync.test.js` — التجديد لا يمسح المرآة ولا يطلب من المستخدم شيئًا |
| 23 | توكن ميت والتجديد نفسه يفشل | `COVERED` | `apps/web/lib/content-api.test.js` — محاولتان بلا ثالثة (التجديد المتكرر حلقة تُغرق الخادم)، والخطأ المُبلَّغ هو 401 الأصلي لا خطأ التجديد |
| 24 | زائر بلا هوية على الويب (مسار الكوكي) | `COVERED` | `apps/web/lib/content-api.test.js` — لا ترويسة تُرسل، ولا إعادة محاولة على 401: الويب لا يدفع ثمن إصلاح الـAPK |
| 18 | فحوص D1 الحقيقية (الصندوق الصادر، الإخفاء، الإشعارات) | `COVERED` | Sync Worker deploy #15 — `verify.mjs` شُغّل على Worker منشور وD1 حقيقية باستخدام Trusted Device pairing وAccess Token v2، ثم نظّف fixtures |

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

والتحقق الحي الذي تنفذه بوابة النشر:

```bash
node services/sync-worker/verify.mjs <worker-url>
```

شُغّل فعليًا بنجاح في Sync Worker deploy #15 (run `35490094232`) على D1 الحقيقية.
