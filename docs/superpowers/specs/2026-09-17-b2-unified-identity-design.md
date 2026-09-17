# B2 — Unified Identity & Trusted Device Design

## الهدف

اختيار أحد حسابات VANTARA الثلاثة يبقى هو تسجيل الدخول الطبيعي: لمسة واحدة، بلا Password أو PIN أو ID أو Form. تحت الواجهة تصبح الهوية واحدة يفهمها Sync Worker وContent API، ولا يكفي معرفة Worker URL أو userId لانتحال حساب.

## الهوية الأساسية

المعرّفات الثلاثة الموجودة أصلًا في D1 هي `vantara_identity_id` الثابتة. Postgres يضيف ربطًا صريحًا من كل هوية VANTARA إلى مستخدم Uchiyomi المقابل بدل اعتبار `uchiyomi_user_id` هو هوية المنتج.

لا ننشئ مستخدمين جدد من الشبكة، ولا ننقل كلمات مرور إلى D1.

## الجهاز الموثوق

كل تثبيت VANTARA يملك credential عشوائيًا عالي الإنتروبيا. D1 يخزن hash فقط مع `device_id`, created/revoked/last_used. الجهاز يحصل على credential مرة واحدة عبر pairing token قصير العمر يجهزه الـOwner؛ هذا pairing منفصل عن شاشة اختيار الحساب ولا يضيف PIN/Password إلى UX اليومي.

بعد pairing:

1. شاشة الحسابات تبقى عامة وتعرض الحسابات الثلاثة فقط.
2. لمس حساب يرسل `userId` مع device credential.
3. Worker يتحقق أن الجهاز غير مبطل.
4. Worker يصدر VANTARA access token قصير العمر ومربوطًا بـ`uid` و`did`.
5. نفس access token يُستخدم مع Worker وContent API.

## Access token

HMAC-SHA256 بسر مشترك بين Worker وContent API (`VANTARA_IDENTITY_SECRET`). Payload إصدار v2:

- `v: 2`
- `uid`: VANTARA identity UUID
- `did`: device UUID
- `iat`
- `exp`

العمر المستهدف 15 دقيقة. لا refresh token مستقل في العميل؛ device credential الموثوق هو الذي يسمح بإصدار access token جديد. إبطال الجهاز يمنع التجديد فورًا، وأقصى بقاء لتوكن صادر مسبقًا 15 دقيقة.

## Content API وربط Uchiyomi

Postgres يحتفظ بربط `vantara_identity_id -> uchiyomi_user_id` وبـUchiyomi token مشفر على الخادم. لا يخرج upstream token للعميل.

تجهيز الربط عملية Owner/Admin خارج UX اليومي: يُستخدم حساب Uchiyomi مرة واحدة لإصدار token طويل العمر ثم يخزن مشفرًا، مع identity UUID الصحيح. التطبيق نفسه لا يعرض password form لهذا الغرض.

`requireSession` يصبح قادرًا على قبول `Authorization: Bearer <VANTARA access token>` والتحقق من نفس توقيع الهوية، ثم يحل identity إلى upstream session/token. دعم cookie القديم يبقى مؤقتًا فقط لتسهيل migration واختبارات الإدارة إلى أن يحذفه B3 بعد تثبيت النقل.

## الإبطال

- `logout device`: يبطل device row في D1 ويحذف credential من الجهاز. التوكن الحالي ينتهي خلال 15 دقيقة كحد أقصى.
- `logout all`: يبطل كل devices للهوية.
- تدوير `VANTARA_IDENTITY_SECRET` يبطل كل access tokens فورًا كإجراء طوارئ.
- Upstream Uchiyomi token revoke يُعالج عند حذف/إعادة ربط الهوية، ولا نعتمد فقط على `revoked_at` المحلي.

## حدود B2

B2 يبني عقد الهوية والجهاز والربط. CORS وBearer transport الكامل للـAPK والصور الموقعة تخص B3. لا تغيير بصري لشاشة الحسابات في B2.

## الاختبارات الإلزامية

- `userId` بلا device proof لا يصدر session.
- device credential خاطئ أو revoked يُرفض.
- device صالح + حساب معروف يصدر token v2 قصير العمر يحوي uid/did.
- forged/expired token يُرفض.
- Content API verifier يقرأ نفس token ويحل identity الصحيحة.
- identity غير مربوطة بحساب Uchiyomi لا تحصل على content session.
- logout device يمنع إصدار token جديد.
- logout all يمنع كل الأجهزة الخاصة بالهوية.
