# VANTARA — ChatGPT × Claude Collaboration Protocol

> **الحالة:** قاعدة تشغيل إلزامية مرافقة لـ `docs/VANTARA_MASTER_PLAN.md`.
>
> **الغرض:** تقسيم العمل على VANTARA بالتوازي بدون تقسيم ثابت حسب التخصص، ومنع أي Agent من اعتماد شغله بنفسه دون مراجعة الطرف الآخر.

---

## 1. القاعدة الأساسية

لا يوجد تقسيم دائم من نوع:

- ChatGPT = Backend
- Claude = Frontend

كلاهما يعمل على **Backend وFrontend** حسب المرحلة الحالية والخطة الرئيسية.

التقسيم يكون **Patch-by-Patch**:

1. كل Agent يقرأ `VANTARA_MASTER_PLAN.md` وهذه الوثيقة قبل بدء أي Patch.
2. كل Agent يختار Patch مستقلًا غير محجوز من قائمة الأعمال الجاهزة.
3. يسجل اختياره قبل لمس الكود.
4. يعمل على Branch مستقل.
5. عند اكتمال التنفيذ لا يضع ✅ بنفسه.
6. ينتقل Patch إلى `READY_FOR_PEER_REVIEW`.
7. الـAgent الآخر يراجع Patch كاملًا.
8. إذا وجد مشكلة: `CHANGES_REQUESTED` ويعود Patch للمنفذ.
9. بعد الإصلاح، نفس المراجع يعيد التحقق.
10. لا يصبح Patch ✅ إلا بعد Peer Review + الاختبارات + CI + التحقق العملي المناسب.

**قاعدة صارمة:** لا يجوز للـAgent الذي نفذ Patch أن يكون هو المراجع النهائي له.

---

## 2. Phase Gate

الخطة الرئيسية ما زالت تحكم ترتيب المنتج:

### المرحلة الحالية

حتى الوصول إلى `BACKEND STABLE` بعد B12:

- ChatGPT يختار Backend Patch جاهزًا.
- Claude يختار Backend Patch مختلفًا وجاهزًا.
- يمكن أن يعملا بالتوازي فقط إذا لم يكن أحد الباتشين يعتمد على نتيجة الآخر أو يعدل نفس القلب المعماري في الوقت نفسه.

### بعد Backend Freeze

بعد B12 ونجاح بوابة `BACKEND STABLE`:

- ChatGPT وClaude كلاهما يختاران من F0→F14.
- لا يوجد مالك دائم للتصميم أو الفرونت إند.
- كل Patch Frontend أيضًا يخضع لمراجعة الطرف الآخر قبل ✅.

---

## 3. العدد الحالي

حسب الخطة الرئيسية بعد B0:

- Backend: `B1 → B12` = **12 Patch** متبقيًا.
- Frontend: `F0 → F14` = **15 Patch** متبقيًا.
- المجموع = **27 Patch مخططًا**.

بالإضافة إلى:

- بوابة تكامل B0 قبل إغلاقه نهائيًا.
- `FINAL_REPOSITORY_SWEEP` الإجباري بعد انتهاء جميع الباتشات.

هذا العدد ليس سقفًا مغلقًا. أي Bug أو Issue جديد يظهر أثناء التنفيذ يُضاف للخطة ويصبح عملًا رسميًا بدل تجاهله.

---

## 4. حالات التعاون

| الحالة | المعنى |
|---|---|
| `READY` | الاعتمادات مكتملة ويمكن لأي Agent اختياره |
| `CLAIMED` | Agent اختاره وسجل الملكية المؤقتة |
| `IMPLEMENTING` | التنفيذ والاختبارات قيد العمل |
| `READY_FOR_PEER_REVIEW` | المنفذ انتهى مبدئيًا وينتظر الطرف الآخر |
| `CHANGES_REQUESTED` | المراجع وجد مشكلة أو نقصًا |
| `REVERIFY` | تم إصلاح ملاحظات المراجع ويعاد التحقق |
| `PEER_APPROVED` | الطرف الآخر وافق بالدليل |
| `FOLLOW_UP` | يحتاج تعقيب بعد Patch لاحق قد يؤثر عليه |
| `DONE ✅` | تحقق كامل + مراجعة الطرف الآخر + التعقيب المطلوب |
| `BLOCKED` | اعتماد أو قرار يمنع التنفيذ الآن |

---

## 5. Claim Rule — اختيار العمل

قبل بداية أي Patch، يضاف سجل بالشكل التالي:

```text
Patch:
Owner: ChatGPT | Claude
Status: CLAIMED
Branch:
Base SHA:
Dependencies:
Expected files/areas:
Regression test plan:
Runtime verification plan:
Claimed at:
```

### منع التضارب

- لا يختار الاثنان نفس Patch.
- لا يعدلان نفس الملفات الجوهرية بالتوازي إلا إذا سُجل ذلك كتنسيق مقصود.
- إذا ظهر overlap غير متوقع، يتوقف صاحب Patch الأحدث ويعيد التخطيط بدل force/overwrite.
- لا يتم نسخ تغييرات Agent آخر أو دمجها بلا مراجعة Diff.
- لا يعدل Agent ملفًا يملكه Patch قيد التنفيذ للطرف الآخر إذا كان التعديل يمكن تأجيله.

---

## 6. Ready Queue

الـAgent لا يختار عشوائيًا من كل المشروع؛ يختار من الأعمال التي تسمح بها الاعتمادات الحالية.

### Backend

- B1 وB2 يمكن بدء التحقيق/التنفيذ فيهما بالتوازي ما دام كل واحد على Branch مستقل وتُراجع مناطق التداخل قبل الدمج.
- B3 يعتمد جوهريًا على عقد الهوية الناتج من B2، فلا يُغلق قبله.
- B4 يثبت Ownership قبل الاعتماد عليه في B5/B8 وما بعدها.
- B5 يعتمد على قرارات B4 ذات الصلة بالمزامنة.
- B6 يمكن العمل على اختبارات وعقد المصادر بالتوازي إذا لم يتعارض مع B2/B3، لكن دمجه النهائي يجب أن يراعي العقود النهائية.
- B7/B8/B9 تعتمد على العقود الأساسية التي قبلها حسب الجزء المتأثر.
- B10 يمكن إضافة Observability تدريجيًا، لكن بوابته النهائية بعد استقرار الأنظمة التي سيراقبها.
- B11 بعد اكتمال الأنظمة المستهدفة.
- B12 آخر Backend Patch دائمًا.

### Frontend

لا يبدأ redesign الكبير قبل B12. بعد ذلك تُحدد Ready Queue حسب الاعتمادات الفعلية؛ F0 يسبق الأنظمة البصرية التي تعتمد على tokens، ولا نسمح بتعديل نفس shell أو الشاشة بالتوازي بلا تنسيق.

---

## 7. Peer Review الإلزامي

بعد أن ينتهي المنفذ، يكتب:

```text
Status: READY_FOR_PEER_REVIEW
Implementation SHA/PR:
Files changed:
Tests added/changed:
Targeted test result:
Full CI result:
Runtime verification:
Known limitations:
```

ثم الطرف الآخر يجب أن يفحص على الأقل:

1. الـDiff كاملًا، لا وصف المنفذ فقط.
2. هل Root Cause عولج أم تمت تغطية العرض فقط؟
3. Regression tests: هل كانت ستفشل قبل الإصلاح؟ وهل تمنع رجوعه؟
4. العقود والمعمارية وتأثير Patch على بقية الأنظمة.
5. Security/privacy عندما ينطبق.
6. أخطاء edge cases وfailure paths.
7. CI الفعلي للـSHA الصحيح.
8. Runtime/E2E/TinyFish عندما يكون للمستخدم مسار قابل للتجربة.
9. عدم كسر إصلاحات سابقة.
10. تطابق التنفيذ مع `VANTARA_MASTER_PLAN.md`.

المراجع يكتب واحدًا من:

```text
Peer review: APPROVED
Reviewer: ChatGPT | Claude
Reviewed SHA:
Evidence:
Follow-up risks:
```

أو:

```text
Peer review: CHANGES_REQUESTED
Reviewer: ChatGPT | Claude
Blocking findings:
Non-blocking findings:
Required re-verification:
```

---

## 8. التعقيب بعد الإغلاق

Peer Review الأول لا يلغي قاعدة التعقيب اللاحق.

بعد Patch لاحق يمكن أن يؤثر على إصلاح سابق:

- الطرف الذي **لم ينفذ الإصلاح الأصلي** يأخذ لفة سريعة عليه.
- يشغل Regression tests المتعلقة به أو يراجع نتيجتها في CI.
- إذا كان runtime flow متأثرًا يعاد اختباره.
- يسجل `FOLLOW_UP: PASS` أو يعيد فتحه `REOPENED`.

لا يبقى ✅ إذا أثبت Patch لاحق أن الإصلاح انكسر.

---

## 9. قاعدة عدم الثقة بالملخصات

ChatGPT لا يعتمد على عبارة Claude: "تم الإصلاح".
Claude لا يعتمد على عبارة ChatGPT: "تم الإصلاح".

كل طرف يراجع:

- commit/PR الحقيقي
- diff الحقيقي
- الاختبارات الحقيقية
- CI الحقيقي
- runtime الحقيقي عند الحاجة

الملخص يساعد على التوجيه فقط، وليس دليلًا.

---

## 10. لوحة العمل الحالية

| Patch | الحالة | المالك | المراجع الإلزامي | ملاحظة |
|---|---|---|---|---|
| B0 | `PEER_REVIEW / INTEGRATION PENDING` | ChatGPT | Claude | التنفيذ مختبر؛ التكامل مع الفرع الأساسي لم يُغلق بعد |
| B1 | `CLAIMED` | ChatGPT | Claude | اختيار ChatGPT الحالي: Clean Install / DB Bootstrap / Migrations |
| Next independent backend patch | `READY` | **Claude يختاره بنفسه** | ChatGPT | Claude يقرأ الخطة والاعتمادات ثم يسجل اختياره بدل أن يختاره ChatGPT عنه |

**مهم:** Claude ليس ملزمًا بـB2 إذا وجد Patch آخر `READY` وأكثر استقلالًا؛ هو يختار بنفسه بعد قراءة الخطة، ثم يسجل Claim قبل التنفيذ.

---

## 11. Final Sweep — مراجعتان مستقلتان

عند نهاية B0→B12 وF0→F14:

1. ChatGPT يعمل Sweep كاملًا للمستودع ويسجل المشاكل دون رؤية/نسخ استنتاجات Claude كبديل للفحص.
2. Claude يعمل Sweep كاملًا مستقلًا ويسجل مشاكله.
3. نقارن القائمتين.
4. Union لكل المشاكل يصبح قائمة الإغلاق النهائية.
5. كل مشكلة جديدة تُصلح وتخضع لنفس Peer Review المتبادل.
6. لا يصبح `FINAL_REPOSITORY_SWEEP = ✅` إلا بعد إغلاق نتائج الفحصين.

---

## 12. قاعدة التنفيذ المختصرة

`Choose independent patch → Claim → Branch → Evidence/Red test → Implement → Targeted tests → Full CI → Runtime verification when applicable → READY_FOR_PEER_REVIEW → Other AI reviews → Fix findings → Re-review → Follow-up → ✅`

هذه القاعدة تنطبق على **كل Backend Patch وكل Frontend Patch** بلا استثناء.