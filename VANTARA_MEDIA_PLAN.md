# 🔴🟥🔴 VANTARA MEDIA PLAN 🟢🟩🟢

## 1. الهدف

VANTARA ليس قارئ مانغا فقط.

VANTARA منصة Media خاصة بنا، وتتكون من ثلاثة أقسام رئيسية:

- VANTARA MANGA 🟣
- VANTARA ANIME 🔵
- VANTARA CINEMA 🟠

كل الأقسام تشترك في نفس:
- الحسابات
- الأصدقاء
- التوصيات
- التعليقات
- التقييمات
- النشاط
- المكتبة
- التقدم
- الإشعارات
- البحث العام
- الهوية الأساسية للتطبيق

لكن لكل قسم محرك محتوى وهوية Accent خاصة به.

---

# 2. أقسام VANTARA

## VANTARA MANGA 🟣

يشمل:
- Manga
- Manhwa
- Manhua
- أي محتوى قراءة مصورة مشابه

اللون الرئيسي:
Purple

الحالة:
المحرك موجود بالفعل ولا يعاد بناؤه من الصفر.

المسار الحالي أثبت نجاح تشغيل Extensions داخل APK والوصول إلى:
Search → Details → Chapters → Pages → Images.

---

## VANTARA ANIME 🔵

يشمل:
- Anime Series
- Anime Movies
- OVA
- ONA
- Specials
- المحتوى المتحرك الذي يعتمد لاحقًا ضمن هذا القسم

اللون الرئيسي:
Blue

المحتوى يعتمد على Video Engine وليس Manga Engine.

---

## VANTARA CINEMA 🟠

يشمل:
- Movies
- TV Series

اللون الرئيسي:
Orange

يستخدم نفس Video Engine المستخدم في VANTARA ANIME، لكن Metadata وProviders قد تختلف.

---

# 3. المبدأ المعماري

لا نبني ثلاثة تطبيقات.

لدينا VANTARA واحد:

VANTARA
├── Manga
├── Anime
└── Cinema

وفوقها طبقة مشتركة:

Shared VANTARA
├── Accounts
├── Friends
├── Social
├── Recommendations
├── Comments
├── Ratings
├── Activity
├── Library
├── Progress
├── Notifications
└── Search

المستخدم يستطيع مثلًا:
- ترشيح مانغا لصديق.
- ترشيح فيلم.
- التعليق على أنمي.
- مشاهدة نشاط صديقه.
- معرفة تقدمه.
- تقييم أي نوع من المحتوى.

النظام الاجتماعي لا يتكرر لكل قسم.

---

# 4. المحركات

يوجد محركان رئيسيان فقط:

## Manga Engine

مسؤول عن:
- Sources
- Extensions
- Search
- Details
- Chapters
- Pages
- Images
- Reader

ولا يتم خلطه مع Video Engine.

## Video Engine

يخدم:
- VANTARA ANIME
- VANTARA CINEMA

مسؤول عن:
- Providers
- Media mapping
- Episodes / Seasons
- Stream resolving
- Quality selection
- Audio tracks
- Subtitles
- HLS / DASH / direct streams
- Player
- Fallback بين المصادر
- Refresh للروابط المؤقتة

الهدف ليس تخزين مكتبة فيديو ضخمة على سيرفر VANTARA.

النموذج المفضل:

Metadata
→ Provider
→ Resolve Stream
→ VANTARA Player

الفيديو يذهب إلى جهاز المستخدم من المصدر المناسب بدل تخزين تيرابايتات داخل VANTARA.

---

# 5. لماذا هذا التصميم؟

المشاريع التي دُرست أثبتت نماذج مختلفة:

- Stremio يفصل Metadata عن Stream Providers.
- Seanime يستخدم Online Streaming Providers ويحل Sources عند الطلب.
- Jellyfin ممتاز للمكتبة المحلية والتشغيل من ملفات مملوكة للسيرفر.
- VANTARA Manga أثبت أن تشغيل نظام Sources على الجهاز ممكن، لكنه كان أعقد بسبب Extensions وRuntime وHeaders وصفحات الفصول.

لذلك Video Engine لا يعاد فيه اختراع Suwayomi أو Jellyfin كامل.

نأخذ الفكرة الصحيحة فقط:
Provider → Stream → Player.

---

# 6. دليل من تاريخ VANTARA Manga

رحلة Manga Engine واجهت مشاكل فعلية يجب ألا نكررها بلا سبب.

أمثلة من تاريخ المستودع:

- `607f8a6`
  إضافة Runtime dependency مطلوبة لمصادر Keiyoushi.

- `0b285d7`
  إصلاح الحفاظ على Manga URL بعد details.

- `8f0add0`
  إصلاح timeouts وعمليات المصادر البطيئة وCloudflare والحالات التي كانت تبدو كأن التطبيق عالق.

- `cce5ae7`
  معالجة catalog pagination والوصول إلى نهاية حقيقية للمصدر.

- `961f232`
  إنشاء Capacitor bridge بين JavaScript ومحرك Android.

- `ac04bd5`
  نقل Extension Engine الحقيقي إلى تطبيق VANTARA:
  search → chapters → pages → image.

هذا التاريخ سبب مباشر لفصل Manga Engine عن Video Engine وعدم تكرار التعقيد بلا حاجة.

---

# 7. المستودعات

## VANTARA — PRIVATE

هذا هو المنتج الحقيقي.

يحتوي على:
- التطبيق
- الحسابات الحقيقية
- Social
- Sync
- Backend
- Manga
- Anime
- Cinema
- Integration
- أي إعدادات أو أسرار إنتاجية

التجارب الخطرة لا تبدأ هنا.

---

## PUBLIC LABS

تستخدم لبناء واختبار المحركات والأجزاء التي يمكن نشرها بدون أي أسرار.

أهم قاعدة:

PUBLIC MUST BE SECRETLESS BY DESIGN.

ممنوع تمامًا:
- API secrets
- Tokens
- Private URLs
- Signing keys
- Production credentials
- `.env`
- بيانات المستخدمين
- أي Secret داخل تاريخ Git

الاختبارات العامة تعتمد على:
- Mocks
- Fake providers
- Test fixtures
- Public test data
- Local test servers

---

# 8. Workflow التطوير

## المرحلة 1 — Public Lab

نبني الميزة أو المحرك في المستودع العام.

يتم تشغيل:
- Build
- Typecheck
- Lint
- Unit tests
- Integration tests
- Provider contract tests
- Player tests
- Android build
- APK smoke tests
- Health tests

يمكن التجربة والكسر والتعديل بحرية هنا.

---

## المرحلة 2 — Stable Version

عندما ينجح كل شيء:

يتم تثبيت نسخة واضحة مثل:

`video-v1.0.0`

ولا نعتمد على "آخر كود موجود" بدون نسخة محددة.

---

## المرحلة 3 — Private Integration

تنقل النسخة المستقرة إلى VANTARA Private.

لا تدخل مباشرة إلى النسخة النهائية.

تدخل إلى Integration Branch.

مثال:

`integration/video`

ثم نختبرها مع:

- Accounts
- Friends
- Social
- Recommendations
- Progress
- Library
- Real UI
- Real APK
- Backend
- Sync

بعد نجاح التكامل فقط يتم دمجها في المسار المستقر.

---

# 9. قاعدة مهمة للـAI

وجود Monorepo كبير لا يعني أن الـAI يعمل في كل شيء.

كل مهمة يجب أن تحدد Scope واضحًا.

مثال:

"اعمل فقط على Video Engine وVANTARA Anime.
لا تعدل Manga Engine أو Social أو Sync."

كل Module يجب أن يملك:
- README قصير
- Purpose
- Boundaries
- Public API
- Tests
- Ownership

ممنوع إنشاء ملفات ضخمة تجمع كل شيء.

---

# 10. نظام الإبلاغ

لدينا Report System منفصل عن Auto Checking.

## User Report

عندما يبلغ المستخدم عن مشكلة:

1. يسجل البلاغ.
2. يحفظ معلومات تشخيص آمنة.
3. لا يرسل Secrets.
4. AI يحاول إعادة إنتاج المشكلة.
5. يصنفها:

- Verified
- Unverified
- Duplicate
- User/Error condition
- Temporary failure

إذا كانت Verified:

### Low Risk

مثال:
- UI bug
- mapping صغير
- isolated provider bug
- typo
- logic bug واضح ومعزول

المسار:

Report
→ Reproduce
→ Branch
→ Fix
→ Tests
→ CI
→ PR
→ Notify owner

لا يوجد دمج مباشر إلى Stable.

### High Risk

مثل:
- Authentication
- Database
- Sync
- Social contracts
- Security
- Architecture
- Cross-module changes
- Migration
- تغيير يحتمل كسر أجزاء أخرى

AI:
- يشخص المشكلة
- يجمع الأدلة
- يحدد الملفات المتأثرة
- يقترح خطة
- يبلغ المالك

ولا يعدل تلقائيًا.

---

# 11. Auto Checking

الفحص الدوري مختلف عن البلاغات.

مهمته مراقبة صحة VANTARA.

يفحص مثلًا:

## Manga
- Source alive
- Search
- Details
- Chapters
- Pages
- Images

## Anime / Cinema
- Provider alive
- Metadata mapping
- Episodes
- Stream resolve
- HLS/DASH
- Audio
- Subtitles
- Playback compatibility
- Latency

## Backend
- API
- Sync
- Worker
- Database
- Authentication health
- Build status

---

# 12. Auto Checking لا يعدل تلقائيًا افتراضيًا

الفحص الدوري:

Detect
→ Confirm
→ Issue
→ Notify

ولا يصبح:

Detect
→ Edit production automatically

لأن المشكلة قد تكون:
- Temporary outage
- Rate limit
- DNS
- CDN failure
- Cloudflare challenge
- Maintenance

يفضل تأكيد المشكلة بعد أكثر من فشل.

مثال:

08:00 FAIL
12:00 FAIL
16:00 FAIL

→ Confirmed degradation
→ Issue
→ Notify owner

أما:

08:00 FAIL
12:00 PASS

→ Temporary incident
→ Log only

---

# 13. ما يسمح للـAuto System بفعله تلقائيًا

مسموح:
- Retry
- Refresh expired URL
- Re-resolve stream
- Clear safe cache
- Change health status
- Fallback to another provider
- إعادة تشغيل test/job آمن

غير مسموح تلقائيًا:
- DB migration
- Auth changes
- Sync contract changes
- Security changes
- Player architecture changes
- Provider parser rewrite داخل المنتج الحقيقي
- Merge إلى production

---

# 14. VANTARA HEALTH

كل أنظمة المراقبة تدخل تحت:

VANTARA HEALTH

ويحتوي على:

- Reports
- Auto Checks
- Provider Health
- Source Health
- Backend Health
- Build Health
- Client Errors
- Regression History

واجهة الإدارة يمكن أن تعرض مثلًا:

VANTARA HEALTH

Manga       Healthy
Anime       Healthy
Cinema      Degraded
Social      Healthy
Sync        Healthy

New reports: 2
Broken providers: 1
Critical: 0

---

# 15. التقرير الآلي

الاختبارات تنتج بيانات قابلة للقياس.

مثال:

{
  "provider": "provider-x",
  "streamResolve": false,
  "httpStatus": 403,
  "latencyMs": 820,
  "timestamp": "..."
}

ثم AI يفسر البيانات.

AI ليس مصدر الحقيقة.

Scripts / CI / Logs هي الأدلة.
AI يحللها ويربطها بالتاريخ ويقترح الإجراء.

---

# 16. Correlation IDs

كل خطأ مهم يجب أن يحمل معرفًا يمكن تتبعه.

Report:
→ correlationId
→ request
→ backend log
→ provider attempt
→ failure

هذا موجود أصلًا كاتجاه داخل VANTARA ويجب الاستمرار عليه.

الهدف:

بدل:
"الحلقة ما اشتغلت"

نصل إلى:

"Provider X فشل في resolveStream
HTTP 403
correlationId: ...
بدأ بعد الإصدار ...
Fallback Y نجح."

---

# 17. هوية الأقسام

الهوية الأساسية لـVANTARA ثابتة.

الذي يتغير هو Accent.

## Manga
Purple

## Anime
Blue

## Cinema
Orange

لا نصنع Design System جديد لكل قسم.

نفس:
- Navigation
- Typography
- Profiles
- Friends
- Cards
- Motion
- Social UI
- Settings

لكن:

`--section-accent`

يتغير حسب المجال.

---

# 18. قاعدة البيانات والموديل

الأنظمة المشتركة لا تربط نفسها بنوع واحد.

بدل:

`mangaId`

نستخدم مفهومًا عامًا مثل:

`mediaId`
`mediaDomain`

مثال:

mediaDomain:
- manga
- anime
- cinema

Subtypes:

Manga:
- manga
- manhwa
- manhua

Anime:
- series
- movie
- ova
- ona
- special

Cinema:
- movie
- series

Social لا يحتاج أن يعرف تفاصيل المحرك.

---

# 19. قاعدة أساسية

Metadata ≠ Playback Source.

Metadata يعرف:
- الاسم
- الغلاف
- الوصف
- النوع
- السنة
- الحلقات أو الفصول

Playback Source يعرف:
- أين يتم تشغيل المحتوى الآن؟

عدم الفصل بين الاثنين خطأ معماري.

---

# 20. القاعدة النهائية

VANTARA Private:
المنتج الحقيقي ومكان التكامل.

Public Labs:
المصنع ومكان التجارب والـCI.

Manga Engine:
مستقل ومستقر.

Video Engine:
مشترك بين Anime وCinema.

Social:
واحد لجميع أنواع Media.

Reports:
قد يصلح Low Risk عبر Branch + CI + PR.

Periodic Checks:
تكتشف وتؤكد وتبلغ، ولا تغير المنتج تلقائيًا افتراضيًا.

Public:
لا أسرار أبدًا.

Production:
لا Auto Merge من AI.

كل تغيير كبير:
Evidence → Test → Review → Integrate.
