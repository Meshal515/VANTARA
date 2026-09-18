# VANTARA — Data Ownership Matrix

> **الحالة:** وثيقة ملزمة، مخرج Patch **B4 — Data Ownership Freeze**.
>
> **مصدر الحقيقة التنفيذي:** `packages/domain/src/ownership.ts`. هذه الوثيقة تشرحه،
> ولا تحلّ محلّه. اختبار في `tools/repository-safety.test.mjs` يفشل إذا اختلف
> الجدولان، فلا يمكن أن تتعفّن الوثيقة بهدوء.

---

## 1. المشكلة التي جُمّدت هنا

VANTARA كان يخزّن نفس المعنى في مخزنين:

- **تقدم القراءة** عند Uchiyomi وفي جدول `progress` في D1. القارئ يكتب في الاثنين
  ولا شيء يصالحهما. تنجح كتابة D1 وتفشل كتابة المالك ⇒ يفتح الفصل من الصفحة
  الأولى بينما الصفحة 30 محفوظة عندنا، والإحصائيات تقول إن الفصل قُرئ.
- **البروفايل والحضور والنشاط والتعليقات والتفاعلات والتوصيات** لها جدول في
  PostgreSQL ومسار HTTP على Content API، **وأيضًا** جدول في D1 ومسار على الـWorker.
  التطبيق يستهلك D1 وحده. فالمسار الآخر كان مالكًا ثانيًا حيًّا: تعليق يُكتب
  هناك ولا يظهر لأحد، وبروفايل يُعدَّل هناك ولا يراه أي جهاز.
- **لا مصفوفة ملكية رسمية** ⇒ كل باتش جديد يستطيع خلق نسخة ثالثة بحسن نية.

هذه هي `BE-P1-09` و`BE-P1-14` و`BE-P1-16` في الخطة الرئيسية.

---

## 2. القواعد الحاكمة

1. **مالك واحد لكل نوع بيانات.** لا «مالك أساسي» ولا «مالك احتياطي».
2. **المرآة مشتقة ومُعلَّمة.** يجوز لمخزن أن يحمل نسخة للمزامنة بين الأجهزة أو
   للعمل بلا شبكة، بشرط أن تُصالح مع المالك، ولا تُقرأ كحقيقة نهائية، ولا تُرجع
   المالك للخلف.
3. **الجدول المتقاعد لا يُكتب ولا يُقرأ.** إسقاطه فيزيائيًا ملك باتش الـmigrations؛
   إلى أن يحدث، الحرس يمنع أي مسار SQL إليه.

---

## 3. المصفوفة

| النوع | المالك | مرايا مسموحة | الجداول الحيّة |
|---|---|---|---|
| `content.catalogue` | UCHIYOMI | — | — |
| `library.membership` | UCHIYOMI | D1 | `library`, `works` (D1، مرآة) |
| `reading.progress` | UCHIYOMI | D1 | `progress` (D1، صندوق صادر) |
| `reading.ratings` | D1 | — | `ratings` |
| `stats.reading` | D1 | — | `chapter_reads`, `usage_daily` |
| `social.profile` | D1 | — | `profiles` |
| `social.presence` | D1 | — | `presence` |
| `social.activity` | D1 | — | `activity` |
| `social.comments` | D1 | — | `comments`, `reactions` |
| `social.recommendations` | D1 | — | `recommendations` |
| `social.notifications` | D1 | — | `notifications` |
| `social.settings` | D1 | — | `settings` |
| `collections.membership` | D1 | — | `collections` |
| `identity.account` | IDENTITY | D1 | `accounts` (D1، ما تحتاجه شاشة الاختيار) |
| `identity.session` | IDENTITY | — | `vantara_sessions`, `vantara_users` |
| `ops.reports` | POSTGRES | — | `vantara_reports` + مرفقاتها وإجراءاتها |
| `ops.content_policy` | POSTGRES | — | `vantara_content_policy`, `vantara_deleted_works`, `vantara_merge_snapshots`, `vantara_audit_log` |
| `ops.sources` | POSTGRES | — | `vantara_source_verdicts` |
| `device.downloads` | DEVICE | — | — |

`IDENTITY` ليست مخزنًا فيزيائيًا ثالثًا: هي طبقة الهوية الموحدة التي يثبّت عقدها
Patch B2. جداولها تعيش اليوم في PostgreSQL، وملكيتها لا تعود للاجتماعي ولا للمحتوى.

---

## 4. تقدم القراءة — كيف تعمل المرآة

```
القارئ يمرّر
   ├─ عملية progress.set  ──▶ D1: يُدمج بـMAX، owner_synced = 0
   └─ PUT /v1/books/:id/progress ──▶ المالك (Uchiyomi)
                                        └─ نجحت؟ ──▶ progress.confirm ──▶ owner_synced = 1
```

- `owner_synced = 0` يعني «المالك لم يستلم هذه القيمة بعد». بلا هذا العمود لا
  يمكن التمييز بين تقدم لم يصل المالك وتقدم تجاوزه المالك.
- `GET /v1/progress/pending` يعرض الصندوق. العميل يصرّفه عند الإقلاع: يقرأ قيمة
  المالك من `GET /v1/books/:id/progress`، ولا يكتب إلا ما هو أعلى منها، ثم يُقرّ.
- الإقرار مشروط بـ`page <= ?` كي لا يُسكت إقرارٌ متأخر صفًّا تقدّم بعده.
- **النسبة (`ratio`) حقل مرآة فقط.** المالك يحفظ الصفحة و`completed` ولا يعرف
  نسبة داخل الصفحة، فمقارنتها بما لا يملكه كانت ستنتج دفعًا أبديًا عند كل إقلاع.
  القاعدة كلها في `reconcileProgress` ومعها اختباراتها.

أي تقدم يُكتب عبر `PUT` بلا جواب (مسار `sendBeacon` عند إغلاق التبويب) يبقى بلا
إقرار بقصد: الإقلاع القادم يصرّفه بدل أن نفترض نجاحًا لم نتحقق منه.

---

## 5. ما تقاعد في B4

| الجدول (PostgreSQL) | حلّ محلّه |
|---|---|
| `vantara_profiles` | `profiles` في D1 |
| `vantara_presence` | `presence` في D1 |
| `vantara_reading_sessions` | `usage_daily` + `chapter_reads` في D1 |
| `vantara_activity_events` | `activity` في D1 |
| `vantara_comments` | `comments` في D1 |
| `vantara_comment_reactions` | `reactions` في D1 |
| `vantara_recommendations` | `recommendations` في D1 |
| `vantara_user_gates` | حقول في `settings` في D1 |

### المسارات التي أُلغيت من Content API

`PATCH /v1/profiles/me` · `GET /v1/profiles` · `PUT /v1/profiles/me/adult` ·
`POST /v1/presence/beat` · `GET /v1/presence` · `POST /v1/presence/leave` ·
`PUT /v1/presence/incognito` · `POST /v1/comments` · `GET /v1/comments/:seriesRef` ·
`DELETE /v1/comments/:id` · `PUT|DELETE /v1/comments/:id/reactions/:emoji` ·
`POST /v1/recommendations` · `GET /v1/recommendations/inbox` ·
`PUT /v1/recommendations/:id/state` · `PUT /v1/ratings/:seriesRef` ·
`GET /v1/activity` · `GET /v1/read-together/:seriesRef` · `GET /v1/stats/me`

ومهمة `presence.sweep` الخلفية حُذفت: حالة الحضور تُشتق من `beat_at` عند القراءة،
فلا يوجد صفّ عالق يحتاج مكنسة.

### قدرة نُقلت ولم تُفقد

**الإخفاء (incognito).** كان يُقرأ من `vantara_user_gates` على مسار لا يستهلكه
التطبيق. صار يُقرأ من `settings.incognitoUntil` في نفس المخزن الذي يملك الحضور،
ويُطبَّق بنفس دالة المجال `redactForViewers` على مسار الحضور **وعلى شاشة اختيار
الحساب** — حالتان مختلفتان لنفس المستخدم على شاشتين كانت تعني إخفاءً يعمل في
مكان ولا يعمل في آخر.

---

## 5.1 وصف العمل — لماذا جدول واحد (B7)

العنوان والغلاف كانا مخزَّنين في `library` وفي `recommendations` وداخل
`activity.payload`، وغائبين تمامًا عن `collections`. النتيجة: عمل يُضاف للمفضلة
من صفحته لا يملك عنوانًا في أي مكان، فشاشة المفضلة تعرض معرّفًا خامًا.

`works` هو الوصف الواحد: `series_ref → title, cover_url, source_id`. بلا
`user_id` بقصد — الأصدقاء الثلاثة يرون نفس الأعمال. وهو **مرآة**: مالك هوية
العمل يبقى Uchiyomi، والصفّ يُكتب فقط كأثر جانبي لعملية تشير إلى العمل
(`favorite.set`, `readLater.set`, `library.add`, `recommendation.send`)، والقيمة
الفارغة لا تمحو قيمة قائمة (`COALESCE`).

و`cover_url` يحمل رابط المصدر لا رابط البروكسي عندنا: تخزين رابط مبني على
`VANTARA_API_URL` كان سيكسر كل الأغلفة عند تغيير العنوان.

---

## 6. ما بقي مفتوحًا — handoff معلن

| البند | المالك المقصود |
|---|---|
| إسقاط جداول PostgreSQL المتقاعدة فيزيائيًا | B1 (آلية الـmigrations) |
| حذف تهيئة `vantara_profiles` و`vantara_user_gates` من `lib/sessions.ts`، وقائمة الحسابات في `routes/auth.ts` | B2 (الهوية الموحدة) — الملفان قيد إعادة بناء الآن، فتعديلهما من B4 تعارض مقصود ممنوع. مستثنيان في الحرس باسمهما. |
| حجب الحارق (spoiler masking) عند العرض | B8 + باتش واجهة التعليقات. المرآة كاملة عند العميل بطبيعة سجل الفروقات، فالحجب قرار عرض لا قرار نقل. الصف يحمل `spoiler_after` ودالة `maskSpoilers` جاهزة ومُختبرة في طبقة المجال. |
| «من وصل أي فصل» (Read Together) | B8، من `presence` + `progress` عند مالكهما |
| واجهة تفعيل الإخفاء وبوابة محتوى البالغين | F10 (الإعدادات). المسار جاهز: `settings.patch` بحقل `incognitoUntil`. |
| فرض بوابة محتوى البالغين على الاستكشاف | B7 (عقود المكتبة والاستكشاف) |

---

## 7. الحرس

ثلاثة مستويات، كلها في CI:

1. `assertSingleOwner()` في `packages/domain/src/ownership.test.ts` — يفشل على نوع
   بمالكين، أو مخزن مالك ومرآة لنفس النوع، أو جدول واحد تحت نوعين، أو جدول حيّ
   ومتقاعد معًا.
2. `no code writes or reads a retired table` في `tools/repository-safety.test.mjs` —
   يقرأ قائمة المتقاعد من المصفوفة نفسها ويمسح كل ملفات المستودع.
3. `data ownership freeze` في `apps/api/src/app.test.ts` — يثبت أن كل مسار مُلغى
   يرجع 404 فعلًا على تطبيق حقيقي.
