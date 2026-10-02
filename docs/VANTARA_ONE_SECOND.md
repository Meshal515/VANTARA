# VANTARA ANIME / CINEMA - ONE SECOND

**الخطة التنفيذية الشاملة لتحويل الأنمي والسينما إلى تجربة: افتح العمل → اضغط تشغيل → يبدأ فورًا**

**التاريخ:** 2026-10-02 · **الإصدار 3** (الإصدار 2: قاعدة الصخرة، Arabic First، الإضافات، التحقق، نسب الفشل، اختبارات البث الخمسة · الإصدار 3: نطاقات الفشل المستقلة، تصنيف تحقق الـPWA، تكافؤ التشغيل في الانتقال، بوابة Rock Core، ضمان الـPWA، منصة Windows)  
**النطاق:** APK + PWA + Windows Desktop  
**قيد معماري حاسم:** **لا Home Server، لا VPS، ولا اعتماد على جهاز منزلي يعمل دائمًا.**  
**الأولوية القصوى:** **السيرفرات والتشغيل الفعلي قبل أي تحسينات جانبية.**  
**قاعدة العربية:** **لا AI Translation ولا Subtitle Search خارجي داخل ONE SECOND؛ المسار الأساسي لا يُعد جاهزًا إلا إذا كانت العربية موجودة أصلًا مع العمل (Hard-sub أو Arabic track مرفق من نفس المزود/المسار).**

> **قاعدة المشروع:** إذا كان العمل موجودًا في أحد الـProviders المفعلة، وإذا كان أي مسار تشغيل صالح موجودًا عندها، يجب ألا يخسره VANTARA بسبب ضعف البحث أو المطابقة أو الاستخراج أو ترتيب السيرفرات.


---

## ⓪ قاعدة الصخرة — THE ROCK RULE (فوق كل قاعدة في هذه الوثيقة)

> **If the upstream is playable, VANTARA plays it.**
> إذا كان عند الطرف الثالث بثّ صالح، VANTARA لازم يشغّله. وإذا ما اشتغل، يكون عندنا **دليل** أن العطل من المصدر/السيرفر نفسه، لا من محركنا.

### ⓪.1 Zero Self-Inflicted Failure

إذا أعطى الـupstream:

```text
- رابطًا صالحًا
- headers صحيحة (Referer/Origin/Cookie/User-Agent كما يطلبها)
- codec مدعومًا على الجهاز
- manifest صالحًا
- segment قابلًا للتحميل
```

فـVANTARA **ملزم** بتشغيله. وإن لم يشغّله فهذا **Bug عندنا إلى أن نثبت العكس**.

**قاعدة قاسية:** إذا شغّل مشغّل خارجي (Chrome / ExoPlayer منفصل / VLC) نفس الرابط بنفس الترويسات، وVANTARA لم يشغّله ⇒ السبب يُسجَّل **`VANTARA_BUG`** مباشرة. ممنوع أن نقول للمستخدم «السيرفر غير متاح» في هذه الحالة؛ هذا **False Failure**.

### ⓪.2 أين يكسب المحرك فشلًا ليس من المصدر (القائمة التي نطاردها)

```text
Referer ناقص                     Redirect (301/302/307) لم يُتبع صح
Origin ناقص                      Token انتهت صلاحيته قبل التشغيل
Cookie / جلسة CDN ناقصة          HLS master نجح لكن segments فشلت
User-Agent مختلف عن المستخرج     Range requests غير مدعومة كما افترضنا
Codec فيديو غير مدعوم            Audio codec غير مدعوم
HEVC / AV1 على جهاز لا يفكّه     CORS في الـPWA
Mixed Content                    Signed URL expired
مهلة probe أقصر من بدء الخادم     probe صارم يرفض بثًا يعمل فعلًا
```

كل بند هنا يجب أن يكون له اختبار، ورمز فشل، وإصلاح في طبقة واحدة (Resolver / HTTP / Player) لا في كل مصدر.

### ⓪.3 الأعطال الميدانية الحالية (P0 من تقارير المالك)

| العَرَض | تصنيفه | المعنى |
|---|---|---|
| أفلام ومسلسلات كل سيرفراتها شغالة فعلًا، وVANTARA يقول «13 غير متاح» | **False Failure** | الـprobe أو الترويسات أو المهلة عندنا تقتل بثًا صالحًا |
| بعض الأعمال سيرفر واحد فقط بينما الموقع فيه أكثر | **Server Discovery Failure** | استخراج ناقص للأزرار/المرايا أو Resolver غير موجود لمضيف |
| EgyBest / ArabSeed / Cimaleek تجد العمل لكن **0 سيرفر** | **Resolution Failure** | الصفحة تُفتح والسيرفرات موجودة، لكن الاستخراج/الـResolver يفشل |
| أنميات مشهورة: «غير متاح في المصادر» وهي متاحة | **Discovery Failure** | مطابقة العناوين/المواسم/الأسماء العربية تخسر العمل |

هذه الحالات الأربع هي **أول corpus** للـbenchmark: كل حالة يبلّغ عنها المالك تُحفظ كحالة اختبار حقيقية ولا تُغلق إلا بإثبات (تشغيل فعلي، أو دليل أن المصدر نفسه معطل).

### ⓪.4 اختبارات البث الخمسة — قبل أن نقول عن أي Stream «خربان»

```text
1. Resolve       embed → redirects → final URL (هل خرج الرابط النهائي؟)
2. HTTP          status · content-type · referer · origin · cookies · user-agent · سلسلة التحويل
3. Manifest      HLS: master.m3u8 → variant → media playlist → أول segment يُحمَّل فعلًا
                 MP4: أول بايتات (لا نكتفي بـ200: بعض الخوادم تتجاهل Range وتبدأ الملف كاملًا)
4. Codec         video codec · audio codec · resolution · profile · level ← هل يفكّه هذا الجهاز؟
5. Playback      هل بدأ المشغّل الـdecode فعلًا؟ (HTTP 200 ≠ فيديو قابل للتشغيل)
```

السيرفر لا يُعلَّم «غير متاح» إلا بعد أن يُعرف **أيّ اختبار** فشل، وبأيّ رمز.

### ⓪.5 لا نختار بثًا لا يقدر الجهاز يشغّله

```text
DeviceCapabilities { h264, hevc, hevcMain10, av1, vp9, aac, ac3, eac3, opus }
```

- **APK:** من `MediaCodecList` الفعلي على الجهاز (لا افتراض).
- **PWA:** من `MediaSource.isTypeSupported` / `canPlayType` / `mediaCapabilities.decodingInfo`.

الاختيار = `توافق الجهاز × الجودة × الصحة × الزمن`. مثال: Server A = 2160p HEVC Main10 والجهاز لا يفكّه، وServer B = 1080p AVC ⇒ نختار B. لو اخترنا A وفشل فهذا **خطؤنا** لا خطأ المصدر.

**الـPWA:** لا يوجد transcoding (لا VPS)، فـcodec غير مدعوم في المتصفح ⇒ نختار بثًا آخر، لا نحاول تحويله.

### ⓪.6 Failure Attribution — سبب حقيقي لكل فشل (داخليًا فقط)

```text
SOURCE_NOT_FOUND        SOURCE_OFFLINE         SOURCE_CHANGED        VERIFICATION_REQUIRED
SERVER_LIST_EMPTY       SERVER_DEAD            HOST_CHANGED
RESOLVER_FAILED         TOKEN_EXPIRED          HEADERS_REJECTED      COOKIE_REQUIRED
MANIFEST_INVALID        SEGMENT_UNREACHABLE
CODEC_UNSUPPORTED       AUDIO_CODEC_UNSUPPORTED
PLAYER_INIT_FAILED
USER_NETWORK            PWA_CORS_BLOCKED
VANTARA_BUG
```

المستخدم لا يرى هذا أبدًا. يرى فقط: **«جاري تجربة سيرفر آخر»**. شاشة Debug وحدها تعرف الحقيقة.

### ⓪.7 Host Health ≠ Resolver Health

نقيس الاثنين لكل مضيف ونقارن:

```text
MegaMax upstream success   99%     VANTARA MegaMax resolver   42%   ⇐ المشكلة عندنا
MegaMax upstream success   18%     VANTARA MegaMax resolver   17%   ⇐ المشكلة من MegaMax
```

### ⓪.8 Resolver Certification

كل Resolver لا يدخل Stable إلا بعد Suite على **عدة أعمال** (لا حلقة واحدة):

```text
HGCloud
├── resolve          ✅
├── headers          ✅
├── master playlist  ✅
├── variant          ✅
├── first segment    ✅
└── player startup   ✅
```

### ⓪.9 الرقم الذي يحكم المشروع

```text
Self-Inflicted Playback Failure Rate
= فشل بسببنا ÷ محاولات تشغيل كان upstream فيها سليمًا ومتوافقًا مع الجهاز

الهدف:   APK < 0.1%      PWA < 0.5%
```

وشكل التقرير المطلوب (أرقام، لا كلام إنشائي):

```text
10,000 playback attempts
Upstream failures          612
Verification required      184
User network                91
Unsupported codec           37
VANTARA internal failures    3
```

> لو المحرك نفسه فيه 10–20% false failures، فإضافة مصادر جديدة **تخبّي العلة بدل ما تصلحها**. لذلك قاعدة الصخرة تسبق توسيع المصادر.

---

## ⓪A. Arabic First — العربي أولًا في كل شيء

- **الأنمي والسينما والمانجا:** المصادر العربية أولًا، وترتيبها ونقاطها أعلى دائمًا.
- **المصادر الإنجليزية موجودة ولا نقول لها لا**، لكنها **احتياط لظروف خاصة** فقط:
  1. لا يوجد أي مصدر عربي عنده الحلقة/الفصل.
  2. الحلقة/الفصل نزل بالإنجليزي مبكرًا قبل أن تتوفر العربية.
- المرشح غير العربي **لا يُختار تلقائيًا** فوق أي مرشح `AR_READY`. يظهر للمستخدم صراحة بعلامة واضحة («بدون ترجمة عربية» / «English») عند غياب العربي، ولا يُحسب ضمن نسبة `AR_READY Playable`.
- في المانجا: المصادر العربية أولًا (Madara/ZeistManga/Iken/TeamX…)، وMangaDex مثلًا مسموح بالعربية أولًا ثم الإنجليزية كاحتياط بنفس القاعدة.

---

## ⓪B. الصخرة الجاهزة والإضافات

**الفكرة:** VANTARA يعطيك **صخرة جاهزة تغنيك عن الإضافات**. نظام الإضافات موجود (مانجا/أنمي/سينما، ومعه إضافات الترجمات)، لكن:

- **الصخرة تغنيك عن الإضافات**: المصادر المدمجة مختارة، مقاسة بالمسار الكامل، ولها Stable/Candidate/LKG وتراجع تلقائي.
- **الإضافات لا تغنيك عن الصخرة**: ممكن تقوّيك، وممكن لا. لذلك:
  - الإضافة **لا تتجاوز** مصدرًا مدمجًا ولا تستبدل معرّفه.
  - تمر بنفس اختبارات البث الخمسة ونفس الصحة؛ إضافة تضر بالتجربة **تُخفض تلقائيًا** ثم تُعطَّل.
  - صلاحيات ضيقة (دومينات معلنة فقط، بلا حساب المستخدم)، وتوقيع/بصمة، وrollback.
- واجهة الإضافات (APK + PWA) تعرض لكل مصدر: حالته (جاهز/يحتاج تحقق/مؤقتًا متوقف)، زمنه، آخر نجاح، ولغته — بنفس هوية كل قسم.

---

## ⓪C. سياسة تحقق Cloudflare — «مرة واحدة تكفي موسمًا»

**المقبول:** مصدر يطلب تحققًا بشريًا **مرة واحدة**، ثم أتابع موسمًا/مسلسلًا كاملًا بلا تكرار. ولو رجع التحقق بعد يوم، **مقبول** (تحقق بضغطة).

**غير المقبول:** تحقق يتكرر **كل حلقة** أو **كل موسم**.

القياس لكل مصدر: `verificationInterval` (كم يعيش التحقق فعليًا):

```text
≥ 24 ساعة / جلسة مشاهدة كاملة    ⇒ مقبول (Stable مع زر تحقق)
يتكرر لكل حلقة                      ⇒ احتياط فقط، لا Stable، لا يُعرض إلا عند غياب البدائل
```

**ملاحظة تقنية (ليست حكمًا مسبقًا):** ختم Cloudflare (`cf_clearance`) عادة مربوط بمتصفح المستخدم وعنوان IP الخاص به، والـWeb Fetcher يطلب من IP مختلف؛ فتحقق المستخدم في متصفحه **غالبًا** لا ينفع الـFetcher. لكن هذا **لا يعني** أن كل مصدر عليه Cloudflare مستحيل في الـPWA. القرار بالقياس فقط، بالتصنيف التالي.

### ⓪C.1 تصنيف التحقق في الـPWA (يُختبر كل مسار مستقلًا)

```text
BROWSER_REUSABLE       المستخدم يتحقق مرة في المتصفح، وجلسة المتصفح نفسها (cookies)
                       تخدم طلبات المصدر المباشرة بعدها، والحلقات التالية تعمل مباشرة.
FETCHER_OK             الـWeb Fetcher يصل للمصدر أصلًا بلا تحدٍّ متكرر (أو بجلسة صالحة قابلة لإعادة الاستعمال).
APK_PREFERRED          الـAPK (WebView + Cookie Jar) يحفظ الجلسة بموثوقية، والمتصفح/الـFetcher لا يستطيعان عمليًا.
VERIFICATION_UNSTABLE  التحقق يتكرر كثيرًا (كل حلقة، أو مرارًا في الموسم نفسه).
UNSUPPORTED            لا مسار صالح على هذه المنصة.
```

**قاعدة:** لا يُصنَّف مصدر عليه Cloudflare كـ`APK_PREFERRED`/`UNSUPPORTED` قبل اختبار **Browser Direct** و**Fetcher** كلٌّ على حدة. والـStable Core في الـPWA **لا يعتمد** على `VERIFICATION_UNSTABLE` أبدًا.

- **APK:** التحقق مرة واحدة يعمل كما يريد المالك (WebView + Cookie Jar للجهاز نفسه).
- **Windows Desktop:** يُقاس فعليًا (⓪H) — لا نفترض النجاح نظريًا.

### ⓪C.2 ضمان الـPWA (SLO) — لا «أفضل جهد»

لا نريد PWA مليانًا بالمصادر نظريًا لكن كل شوي تحقق أو 0 سيرفر. قياسان منفصلان:

```text
1. AR_READY PLAYABLE COVERAGE      نسبة الأعمال التي لها مسار تشغيل عربي صالح على الـPWA
2. VERIFICATION INTERRUPTION RATE  = جلسات تشغيل أجبرت المستخدم على تحقق بشري
                                     ÷ كل جلسات التشغيل التي استخدمت Stable Core
                                     الهدف: ≤ 1%
```

يعني: المستخدم يفتح ويتابع حلقاته وأفلامه بحرية، والتحقق حدث نادر جدًا وليس جزءًا طبيعيًا من المشاهدة.

| سلوك المصدر | الحكم |
|---|---|
| تحقق كل حلقة | **ليس Stable** |
| تحقق مرارًا خلال الموسم نفسه | **ليس Stable** |
| تحقق مرة نادرة ثم تُحفظ الجلسة | **مقبول** |

مصدر تجاوز المعدّل المقبول ⇒ تُخفض صحته وأولويته، يخرج من الـHot Path، ويُنتقل تلقائيًا لمصدر عربي Stable آخر، ويبقى Candidate/Backup فقط. **لا محاولة لتجاوز CAPTCHA أو حلّه آليًا.**


---

## ⓪E. نطاق الفشل المستقل — Independent Failure Domain

«2–4 مسارات مستقلة» تحتاج تعريفًا صارمًا، وإلا أربعة أزرار تنتهي كلها لنفس المضيف تُعدّ أربعة بدائل وهي بديل واحد.

```text
A path is only considered independent if it differs in at least one real failure domain:
- different content source
- different video host
- preferably different CDN / upstream chain

4 server labels backed by the same host = 1 effective redundancy path.
```

- كل Stream يحمل بصمة نطاقه: `(sourceId, hostFamily, cdnHost)` — `cdnHost` من الرابط النهائي بعد التحويلات لا من اسم الزر.
- مقياس `>= 2 independent paths` يُحسب على **البصمات المختلفة**، لا على عدد الأزرار.
- الاحتياط المختار لبدء التشغيل الموازي (Tier backup) يُفضَّل أن يكون من **نطاق فشل مختلف** عن الأول؛ احتياط من نفس المضيف لا يحمي من سقوطه.

---

## ⓪F. تكافؤ التشغيل في الانتقال أثناء الحلقة — Playback Equivalence

الانتقال لسيرفر آخر في الدقيقة 17 ثم القفز لنفس الثانية صحيح **فقط** إذا النسختان متكافئتان زمنيًا. نسختان من نفس الحلقة قد تختلفان: مقدمة أطول، recap، TV cut مقابل Blu-ray.

```text
Before seamless mid-playback failover:
  compare duration and timeline compatibility.

  If the duration difference is small (≤ ~2s or ≤ 0.5%):
      resume the same position.

  If materially different:
      apply a known offset if one was learned for this (source A → source B) pair,
      otherwise restart near the closest safe timestamp (scene/chapter boundary or a few seconds earlier)
      and do not pretend exact continuity.
```

- الإزاحة المتعلّمة تُحفظ لكل زوج نسخ عند أول مطابقة ناجحة (مثلًا فرق مدة المقدمة).
- «نجاح تقني» يوديك لمشهد غلط = فشل تجربة، يُسجَّل.

---

## ⓪G. بوابة Rock Core — حدّ أدنى إلزامي للمصادر العربية المدمجة

الصخرة مكتفية **بدون إضافات**. Arabic First إلزامي. وحتى لا يصل الفريق إلى «5–8 providers» نصفها إضافات أو إنجليزي ويقول «حققنا الخطة»:

```text
ROCK CORE GATE

Anime:
  >= 4 genuinely independent Arabic Stable providers

Cinema / TV:
  >= 4 genuinely independent Arabic Stable providers

Plus:
  >= 1 non-Arabic fallback lane per vertical

Independence per ⓪E: different sources, different video hosts, and
where possible different failure domains.

Extensions do NOT count toward satisfying the Rock Core Gate.
```

**الإنجليزي:** موجود ومسموح، لكنه احتياط فقط حين: العربي لم ينزل بعد، أو العربي لا يملك الحلقة، أو كل المسارات العربية فشلت. ولا يتقدم أبدًا على `AR_READY` صالح.

**الإضافات** (أنمي/سينما/مانجا، وبعض إضافات الترجمة): The Rock works without extensions. الإضافة قد تزيد التغطية، أو تضيف أعمالًا نادرة، أو سيرفرات بديلة، أو قدرات ترجمة اختيارية، أو ترفع الـredundancy — لكنها لا تُحسب ضمن بوابة Rock Core.

---

## ⓪H. ثلاث منصات، قاعدة واحدة — APK · PWA · Windows Desktop

```text
إذا كان upstream قابلًا للتشغيل ومناسبًا للمنصة، VANTARA يشغّله.
والإضافات لا تعوّض ضعف الصخرة الأساسية.
```

### ⓪H.1 Windows Desktop

لا نكتفي بـInstalled PWA إذا كان Runtime أصلي يعطي موثوقية أعلى. **الخيار الأول للتقييم: Tauri + WebView2** (واجهة VANTARA أصلًا Web):

```text
VANTARA UI
→ WebView2
→ local provider/resolver runtime
→ local HTTP (بلا CORS، ترويسات كاملة، cookies لكل مصدر)
→ direct upstream / CDN
→ native/web media playback
No VPS. No Home Server.
```

- نفس العقود والـproviders قدر الإمكان، مع **network/runtime adapter** خاص بالمنصة (كما للـAPK).
- **Cloudflare على Windows يُقاس فعليًا:** تحقق بشري داخل WebView2 مخصّص لكل مصدر، ملف تعريف/cookies دائم لكل مصدر، وقياس هل الحلقات التالية تعيد استعمال الختم. **لا نفترض النجاح نظريًا.**
- القرار: إن تفوّق على الـPWA في المقارنة أدناه، يبدأ تنفيذه (المالك حدّد: الأسبوع القادم إن كان أفضل).

### ⓪H.2 المقارنة النهائية (تُملأ بالقياس، لا بالتوقع)

| المقياس | APK | PWA | Windows Desktop |
|---|---|---|---|
| Discovery | | | |
| Playable (AR_READY) | | | |
| Zero Server | | | |
| Verification Interruption Rate | | | |
| Time To First Playable (median / P95) | | | |
| Host compatibility | | | |
| Codec compatibility | | | |
| Self-Inflicted Failure Rate | | | |

---

## ⓪I. Corpus الإلزامي للقياس (من المالك)

- **أنمي:** على الأقل **10 أعمال نادرة/قديمة** قليلة المشاهدين وتصنيفاتها أقل شيوعًا — تُضاف للـcorpus كحالات ثابتة، ولا تكفي المشهورة وحدها.
- **مسلسلات:** **Shameless** وأمثاله (مسلسلات أجنبية طويلة متعددة المواسم) — لكل موسم وحلقة عيّنة.
- **هدف النطاق:** فوق **5,000** مسلسل وفيلم شغّالين بسلاسة ما دام المصدر سليمًا، والطموح **7,000**؛ والأنمي كذلك — على **PWA وAPK**.
- «شغّال» = بوابة ⓪.4 كاملة (لا مجرد ظهور العمل في البحث).

---

## 0. القرار التنفيذي المختصر

VANTARA لا يحتاج “مصادر أكثر” فقط. يحتاج **محرك وسائط كامل** يجعل المصادر مجرد حساسات، والسيرفرات مجرد Candidates، والـHost Resolvers طبقة مستقلة، ويجعل التشغيل يبدأ من **أفضل مسار معروف مسبقًا** بدل أن يبدأ البحث من الصفر بعد ضغط Play.

### التقييم من 10 - بلا Home Server أو VPS

| المنصة | التقييم | الحكم العملي |
|---|---:|---|
| **APK - Local-First بالكامل** | **9.4 / 10** | أقوى مسار. الجوال نفسه ينفذ HTTP، parsing، extraction، health ranking، caching، ويشغل Media3/ExoPlayer. لا CORS ولا حاجة لخادم محتوى. |
| **PWA + Cloudflare Worker رفيع كـFetch Relay فقط** | **8.4 / 10** | قوي جدًا ومناسب لعدد مستخدمين صغير. المتصفح ينفذ أغلب المنطق؛ Worker يتدخل فقط عندما يمنع CORS أو يحتاج fetch وسيط. لا يمرر الفيديو نفسه. |
| **PWA صافي بلا أي Relay نهائيًا** | **5.8 / 10** | غير كافٍ لهدفنا؛ CORS، forbidden headers، cookies، embeds وبعض hosts ستمنع مساواة APK. |
| **المعمارية المشتركة APK + PWA** | **9.0 / 10** | ممتازة إذا كان العقد واحدًا والمنفذ مختلفًا حسب المنصة، ولا نحاول إجبار PWA على Host لا يناسب المتصفح. |

### معنى “ONE SECOND”

ليس وعدًا فيزيائيًا بأن كل موقع في الإنترنت سيبدأ خلال 1.000 ثانية. المقصود **هدف منتج**:

- **Warm path:** بدء التحضير/البفر خلال **أقل من 1 ثانية** عندما يوجد Last Known Playable صالح.
- **Cold path median:** أول Playable خلال **أقل من 2.5 ثانية**.
- **P95:** أقل من **6 ثوانٍ**.
- **لا شاشة “جاري تحميل السيرفرات” تمنع المستخدم**.
- الفشل في Server A لا ينتظر 20-30 ثانية قبل تجربة B.

### تعريف AR_READY - شرط التشغيل الافتراضي

VANTARA ONE SECOND **ليس مشروع ترجمة**. لا نريد أن يصبح استقرار المشاهدة تابعًا لخدمة ترجمة منفصلة. لذلك كل Stream Candidate يحصل على حالة عربية واضحة:

```text
AR_HARDSUB      = العربية مطبوعة أصلًا في الفيديو
AR_ATTACHED     = Arabic subtitle track مرفق أصلًا مع نفس المسار/المزود
NON_AR          = لا توجد عربية أصلًا
UNKNOWN_AR      = لم يتم التحقق بعد
```

المشغل التلقائي يختار فقط `AR_HARDSUB` أو `AR_ATTACHED`. `NON_AR` لا يدخل مسار التشغيل الافتراضي، ويمكن إبقاؤه للتشخيص فقط. **لا ترجمة آلية، ولا جلب Subtitle من خدمة أخرى لتعويض Source ضعيف.**

---

## 1. المشكلة الحقيقية: ثلاث أعطال مستقلة

### 1.1 Discovery Failure - العمل موجود لكن VANTARA لا يجده

أسباب نموذجية:

- اسم عربي مقابل إنجليزي.
- Romaji مقابل Native title.
- Season 2 مقابل `2nd Season` أو `S2`.
- Part 2 مقابل Season split.
- سنة الإصدار مفقودة.
- المصدر يملك slug أو عنوانًا مختلفًا.
- البحث في مصدر واحد أو query واحد فقط.

**النتيجة:** مواقع أخرى تملك العمل، لكن VANTARA يقول عمليًا “غير موجود”.

### 1.2 Server Discovery / Resolution Failure - العمل موجود لكن 0 سيرفر

وهذه حاليًا **أكبر مشكلة** حسب الواقع في VANTARA: نسبة معتبرة من الأعمال تنفتح، لكن لا يظهر أي سيرفر صالح.

السلسلة التي يجب تشخيصها منفصلة:

```text
source match
→ episode/movie page
→ server buttons
→ embed URL
→ redirects
→ host resolver
→ HLS/DASH/MP4
→ lightweight probe
→ player
```

نجاح البحث **ليس نجاحًا**. نجاح استخراج اسم Server **ليس نجاحًا**. النجاح الوحيد هو:

> **Playable stream صالح فعليًا على المنصة المستهدفة.**

### 1.3 Playback Redundancy Failure - سيرفر واحد، 30 ثانية، ويمكن يفشل

هذا يعني أن VANTARA يعتمد على **مسار واحد** بدل شبكة بدائل.

الهدف الصحيح:

```text
Canonical Episode / Movie
├─ Source A → Host 1 → HLS 1080p
├─ Source A → Host 2 → MP4 720p
├─ Source B → Host 3 → HLS 1080p
└─ Source C → Host 4 → DASH/MP4
```

ويبدأ التطبيق بأفضل Known-Good Path فورًا، بينما البقية تتجهز في الخلفية.

---

## 2. القواعد غير القابلة للتفاوض

1. **لا Home Server.**
2. **لا VPS.**
3. **لا media proxy دائم عبر Cloudflare Worker.** الفيديو وsegments تذهب مباشرة من الـCDN للمستخدم قدر الإمكان.
4. **APK الحالي لا ينكسر.** محركات أندرويد الحالية تبقى؛ الإضافات الجديدة additive.
5. **PWA ليس نسخة مزيفة من APK.** نفس العقود، لكن Provider/Host يمكن أن يكون `apkOnly` أو `pwaEligible` حسب قيود المتصفح.
6. **كل Source يجب أن يثبت Search → Details → Episode/Movie → Server → Stream → Play.**
7. **لا نقيس النجاح بعدد المصادر.** نقيس Discovery Rate وPlayable Rate وZero-Server Rate وTime-To-First-Playable.
8. **السيرفرات Priority 0.** أي عمل بـ0 Server يطلق fallback scan تلقائيًا.
9. **الجودة تُقرأ من الـmanifest/stream، لا من label المصدر.**
10. **4K لا يُختلق.** نعرض 2160p فقط إذا stream الحقيقي كذلك.
11. **التحقق البشري مقبول.** نستخدم حالة `NEEDS_VERIFICATION` وتبويب تحقق صريح، لا CAPTCHA automation.
12. **لا نظام ترجمة داخل ONE SECOND.** لا AI Translation، لا OpenSubtitles، ولا بحث خارجي عن ملفات ترجمة. المسار الأساسي يجب أن يكون `AR_READY`: العربية موجودة أصلًا كـHard-sub أو Arabic track مرفق مع نفس العمل/المزود. المرشح غير العربي لا يُختار تلقائيًا (ويظهر صراحة كاحتياط فقط وفق ⓪A).
13. **قاعدة الصخرة (⓪) فوق كل قاعدة:** لا يُعلَّم سيرفر «غير متاح» بلا رمز فشل من ⓪.6، ولا يُنسب فشل للمصدر قبل اختبارات ⓪.4.
14. **Arabic First (⓪A)** في الترتيب والاختيار والقياس.

---

## 3. بنية VANTARA ONE SECOND

```text
                      ┌─────────────────────────┐
                      │   Canonical Media ID    │
                      │ Anime / Movie / Series  │
                      └────────────┬────────────┘
                                   │
                     aliases + source mappings
                                   │
                  ┌────────────────▼────────────────┐
                  │     Provider Orchestrator       │
                  │ discovery / source copies       │
                  └───────┬───────────┬─────────────┘
                          │           │
                  Source A/B/C      Stremio-like
                          │           │
                          └─────┬─────┘
                                │
                    Server Candidates
                                │
                ┌───────────────▼────────────────┐
                │      Host Resolver Fabric       │
                │ HLS / DASH / MP4 / Embed Hosts │
                └───────────────┬────────────────┘
                                │
                         Resolved Streams
                                │
                 quality + latency + health score
                                │
                ┌───────────────▼────────────────┐
                │    Availability / LKG Cache     │
                │ Last Known Good + short TTL     │
                └───────────────┬────────────────┘
                                │
                       FIRST PLAYABLE WINS
                                │
             ┌──────────────────┴──────────────────┐
             │                                     │
        APK Media3                            PWA Player
        ExoPlayer                      native HLS / hls.js
```

### الفكرة المركزية

**Source لا يشغل الفيديو.** Source فقط يكتشف نسخة العمل والحلقة وServer Candidates.

**Resolver لا يبحث عن العمل.** Resolver يعرف Host محددًا أو عائلة Hosts ويحوّل embed/server candidate إلى stream قابل للتشغيل.

هذا الفصل يجعل تغيير Host واحد يُصلح عدة مصادر دفعة واحدة.

---

## 4. نموذج البيانات الأساسي

### 4.1 CanonicalWork

```ts
type CanonicalWork = {
  id: string;
  kind: 'anime' | 'movie' | 'series';
  canonicalTitle: string;
  titles: {
    english?: string;
    arabic?: string;
    romaji?: string;
    native?: string;
    synonyms: string[];
  };
  year?: number;
  externalIds: {
    anilist?: number;
    mal?: number;
    imdb?: string;
    tvmaze?: number;
  };
};
```

### 4.2 SourceCopy

```ts
type SourceCopy = {
  canonicalId: string;
  sourceId: string;
  sourceWorkId: string;
  url: string;
  titleSeen: string;
  season?: number;
  lastSeenAt: number;
  confidence: number;
};
```

### 4.3 ServerCandidate

```ts
type ServerCandidate = {
  sourceId: string;
  episodeKey: string;
  hostId?: string;
  embedUrl: string;
  label?: string;
  needsVerification?: boolean;
  platform: 'apk' | 'pwa' | 'both';
  discoveredAt: number;
};
```

### 4.4 ResolvedStream

```ts
type ResolvedStream = {
  url: string;
  protocol: 'hls' | 'dash' | 'mp4';
  width?: number;
  height?: number;
  bitrate?: number;
  codec?: string;
  hdr?: string;
  audioCodec?: string;
  headers?: Record<string,string>;
  expiresAt?: number;
  sourceId: string;
  hostId: string;
  platform: 'apk' | 'pwa' | 'both';
};
```

### 4.5 AvailabilitySnapshot

```ts
type AvailabilitySnapshot = {
  mediaKey: string;
  candidates: ServerCandidate[];
  streams: ResolvedStream[];
  bestStreamId?: string;
  checkedAt: number;
  softExpiresAt: number;
  hardExpiresAt: number;
};
```

---

## 5. أقوى توليفة هوية/بحث - بدون TMDB كشرط

### 5.1 الأنمي

**الترتيب المقترح:**

1. **AniList** - canonical metadata / schedule / popular / title aliases.
2. **Kitsu أو Jikan** - fallback للهوية والعناوين عندما يفشل match.
3. **Persistent Source Alias Map** - أهم من أي API: بمجرد أن يتعلم VANTARA أن اسم المصدر X يطابق canonical work Y، لا يعيد البحث من الصفر.

ملاحظة تشغيلية: AniList حاليًا يعلن degraded limit قدره 30 request/min، لذلك لا يجوز استخدامه في كل نقرة؛ يجب cache + batching + local persistence.

### 5.2 السينما والمسلسلات

**الترتيب المقترح:**

1. **Cinemeta** - catalog/meta + IMDb identity.
2. **TVMaze** - fallback قوي للمسلسلات والحلقات.
3. **Wikidata** - identity/enrichment عند الحاجة.
4. **Persistent Source Alias Map** - يخزن أسماء/IDs الخاصة بالمصادر.

**Cinemeta ليس Playback Source.** يدخل في Provider Registry كـ`CATALOG + META` وليس `STREAM`.

---

## 6. توليفة مصادر الأنمي المستهدفة

> الهدف ليس “أكبر عدد”. الهدف: **5-8 مصادر فعلية** تغطي أنواعًا مختلفة، وكل واحد يثبت المسار الكامل Live.

### 6.1 المجموعة الأساسية لـVANTARA

| الفئة | المصدر/النوع | دوره | الحالة المقترحة |
|---|---|---|---|
| Arabic direct | **WitAnime** | تغطية عربية + server candidates | Stable إذا E2E ناجح |
| Arabic direct | **Anime4Up** | تغطية عربية إضافية | Candidate / VERIFY بسبب التحقق |
| Arabic direct | **GateAnime** | diversity / fallback | Candidate حتى ينجح benchmark |
| General source | **Shahiid** | fallback إضافي إذا فهرس الأنمي فعليًا | Candidate/Stable حسب القياس |
| Protocol | **Stremio-compatible provider adapter** | يفتح باب providers قابلة للتركيب | Must-have architecture |
| User extensions | **VANTARA JS/TS provider packages** | إضافة/إصلاح source بلا تحديث كامل | Must-have |

### 6.2 ما لا نعتمد عليه كخدمة خارجية وحيدة

- **Consumet**: مفيد كمرجع هندسي/منطق providers، لكن لا نعتمد على public hosted API كقلب المنتج.
- **Aniyomi official extension repo**: ممتاز كمرجع لتصميم multi-source themes، لكنه archived منذ 2025؛ لا نجعله upstream حيًا مطلوبًا لعمل VANTARA.
- أي Source لا يثبت stream حقيقي لا يدخل Stable لمجرد أن search يعمل.

### 6.3 هدف التغطية

للعمل المشهور:

```text
2-4 independent playable paths
>= 2 different source copies where possible
>= 2 different hosts where possible
```

للعمل النادر:

```text
ابدأ بأقوى 2 source
→ إذا لم يجد، وسّع تلقائيًا للبقية
→ لا تتوقف عند أول source يقول no result
```

---

## 7. توليفة مصادر السينما والمسلسلات المستهدفة

### 7.1 المجموعة الأساسية لـVANTARA

| الفئة | المصدر/النوع | دوره | الحالة المقترحة |
|---|---|---|---|
| Arabic direct | **ArabSeed** | movies/series + MySeed paths | Stable إذا E2E ناجح |
| Arabic direct | **Shahiid** | مصدر إضافي + MegaMax paths | Stable/Candidate حسب القياس |
| Arabic direct | **TukTuk** | مصدر مستقل + paths مختلفة | Stable إذا E2E ناجح |
| Arabic direct | **FaselHD** | breadth / fallback | Candidate حتى ينجح live benchmark |
| Arabic direct | **Cimaleek** | breadth / fallback | Candidate حتى ينجح live benchmark |
| Arabic direct | **EgyDead / GYD** | fallback فقط إذا health منخفض | Low-priority / Candidate |
| Metadata | **Cinemeta** | identity/catalog، لا stream | Stable metadata |
| Protocol | **Stremio-compatible provider adapter** | stream-provider portability | Must-have |
| User extensions | **VANTARA JS/TS packages** | تحديث سريع بلا APK release | Must-have |

### 7.2 قاعدة الاختيار

لا نرتب المصادر يدويًا فقط. كل work/episode يحصل على ترتيب ديناميكي:

```text
sourceScore =
  recentWorkSuccess
+ globalSourceHealth
+ hostHealth
+ latencyScore
+ platformCompatibility
+ userLastSuccess
- verificationPenalty
- timeoutPenalty
```

---

## 7A. لماذا تطبيقات أنمي أخرى تبدو وكأنها "تجد كل شيء"؟

المقارنة المفيدة ليست أن التطبيق الآخر "يعرف سرًا"؛ بل أن **تغطية الكتالوج** و**تغطية السيرفرات** عنده غالبًا بُنيتا كمنتجين مستقلين. من المعلومات العامة المتاحة عن Anime Rift: موقعه يعلن أكثر من 5000 عمل HD/FHD ويقول إن الوسائط تأتي من أطراف ثالثة ولا تُخزن عنده. لكن هذا لا يكشف الباك إند أو عدد الـproviders أو الـresolvers، لذلك **لا يمكن التحقق علنًا من تفاصيل معماريته الداخلية**. والأهم: مراجعات Google Play الحديثة نفسها تذكر أخطاء سيرفر، بطء المشغل الداخلي، وتوقف الحلقة في المنتصف؛ أي أنه ليس نظامًا بلا أعطال.

### الفرق الذي يجب أن نصنعه في VANTARA

```text
تطبيق ضعيف:
Catalog كبير
→ user opens work
→ يبدأ البحث من الصفر
→ 0 server / timeout

VANTARA ROCK:
Catalog index
+ persistent source mappings
+ pre-discovered episode mappings
+ resolver fabric
+ last-known-good playable
+ server health memory
→ user opens work
→ server candidates موجودة مسبقًا قدر الإمكان
→ Play
```

الأشياء التي تعطي التطبيقات الكبيرة إحساس "كل شيء موجود":

1. **Catalog واسع لا يعتمد على Search live فقط.** العمل معروف قبل أن يكتبه المستخدم.
2. **Source IDs محفوظة.** بعد أول مطابقة، لا يعاد البحث بالعنوان في كل مرة.
3. **عدة Source Copies للعمل نفسه.** الفشل في موقع لا يعني فقدان العمل.
4. **Host Resolvers مشتركة.** إصلاح Host واحد يعيد عدة مصادر للعمل.
5. **تحديثات Extensions سريعة.** المصدر يصلح بدون Release كامل للتطبيق.
6. **Native networking على APK.** لا CORS، وHTTP/cookies/headers أسهل من PWA.
7. **إخفاء الفشل.** المستخدم لا يرى خمسة Extractors فشلت؛ يرى أول Stream نجح فقط.

### قاعدة الصخرة

> **وجود بطاقة العمل في الكتالوج لا يعني أن VANTARA يدعمه. الدعم الحقيقي = Canonical Match + Episode/Movie mapping + على الأقل AR_READY Playable Path واحد.**

إذا فتح المستخدم عملًا وظهر `0 Server`، نعد ذلك **فشل P0** حتى لو كان البحث والـmetadata ممتازين.

---

## 7B. ما الذي لا ننسخه من تجربة Stremio؟

Stremio ممتاز كفكرة Addon Protocol، لكن **لا نجعله نموذج التشغيل الافتراضي للهاتف**. تقارير مستخدمين حديثة في 2025-2026 تصف buffering على Android/Android TV حتى مع اتصالات سريعة وDebrid، وفي حالة موثقة كان نفس الـstream يبدأ فورًا على Windows بينما Android ينتظر 30-60 ثانية. توجد كذلك شكاوى مرتبطة بتحديثات المشغل وملفات Remux ضخمة. هذه تجارب مستخدمين وليست قياسًا علميًا عامًا، لكنها تكشف أصناف الفشل التي يجب أن نتجنبها.

كما أن Media3/ExoPlayer نفسه يوضح أن دعم الـcodec النهائي يعتمد على Decoder الجهاز، حتى لو كان HLS/DASH/MP4 مدعومًا على مستوى الحاوية. لذلك "الرابط يعمل" لا يساوي "سيعمل على كل هاتف".

### قرار VANTARA Mobile-First

**المسار الافتراضي للهاتف:**

```text
Direct HTTPS
→ HLS adaptive أو MP4 مناسب
→ AR_READY
→ codec compatible with device
→ health proven
→ start
```

**Torrent/Debrid/Remux ليس requirement ولا default path.** يمكن دعمه مستقبلًا كـOptional High-Quality Lane إذا أراد المستخدم وكان الملف Cached/سريعًا والجهاز قادرًا، لكن لا نبني نجاح ONE SECOND عليه.

### سياسة 4K

- 4K لا يسبق الاستقرار.
- 2160p يظهر فقط إذا كان Stream حقيقيًا ومقروءًا من manifest/metadata.
- لا نختار Remux ضخم تلقائيًا على الهاتف لمجرد أنه أعلى دقة.
- الأفضلية العملية: **Stable high-bitrate 1080p > unstable 4K**.
- إذا 4K Direct HTTPS/HLS ثابت ومناسب للجهاز والاتصال، نختاره أو نعرضه فورًا.

---

## 8. أهم جزء في المشروع: SERVER RESOLVER FABRIC

هذه الطبقة أهم من إضافة عشرة Sources جديدة.

### 8.1 العائلات الأساسية

```text
Direct HLS Resolver
Direct DASH Resolver
Direct MP4 Resolver
Packed-JS Resolver Family
HGCloud Resolver
MegaMax Resolver
StreamHG Resolver
Sendvid Resolver
OK.ru Resolver
Dailymotion Resolver
MySeed / source-specific direct resolver
Generic Embed Detector
```

### 8.2 لماذا هذا أهم؟

لو 4 مصادر تستخدم Host نفسه وتغير الـHost:

**بدون Resolver Fabric:** تصلح 4 adapters.  
**مع Resolver Fabric:** تصلح Resolver واحد.

CloudStream نفسه يفصل الـextractor عن الـprovider عبر طبقة `loadExtractor()`، وهذا هو المبدأ المطلوب معماريًا.

### 8.3 Contract لكل Resolver

```ts
interface HostResolver {
  id: string;
  match(url: string): boolean;
  resolve(input: ResolveInput): Promise<ResolvedStream[]>;
  supports: {
    apk: boolean;
    pwa: boolean;
  };
}
```

### 8.4 كل Resolver يجب أن يعيد

- stream URL.
- protocol.
- required headers/cookies إن كانت المنصة تسمح.
- actual qualities.
- expiration إن أمكن.
- failure reason structured.
- latency.

---

## 9. Server Health - لا يوجد “شغال/خربان” فقط

نحتاج Health متعدد الطبقات:

```text
Source Health
Route Health
Host Health
Resolver Health
Per-Work Success
Per-Device/Platform Compatibility
```

مثال:

```text
WitAnime search       99%
WitAnime episode      96%
HGCloud resolver      98%
MegaMax resolver      93%
GYD resolver          21%
```

### 9.1 حالات السيرفر

```text
READY
STALE
NEEDS_VERIFICATION
COOLDOWN
FAILED
PLATFORM_UNSUPPORTED
```

### 9.2 Circuit Breaker

إذا Host يفشل عدة مرات متتالية:

- لا نجربه أولًا لكل مستخدم.
- cooldown 5-30 دقيقة حسب نوع الفشل.
- نعيد اختباره في الخلفية.
- يبقى fallback ولا يلوث startup path.

---

## 10. ONE SECOND Startup Pipeline

### 10.1 عند دخول صفحة فيلم

```text
فتح Work Page
→ اقرأ AvailabilitySnapshot المحلي
→ إن كان صالحًا: جهّز أفضل candidate مباشرة
→ refresh في الخلفية
```

### 10.2 عند دخول صفحة مسلسل/أنمي

لا نحل كل الحلقات. نجهز فقط:

- Continue Watching episode.
- Next Unwatched episode.
- الحلقة التي ضغطها المستخدم.

### 10.3 عند الضغط Play

```text
T+0ms      اقرأ Last Known Playable
T+0ms      ابدأ prepare لأفضل stream
T+0ms      شغّل probe خفيف للـbackup الأول
T+300ms    إن لم يظهر progress، شغّل backup الثاني
T+700ms    وسّع provider tier
T+1200ms   rare fallback + verification candidates
```

**ممنوع:**

```text
Server A timeout 30s
ثم Server B
ثم Server C
```

### 10.4 Progressive Fan-out بدل 8 مصادر دفعة واحدة

**Tier 1:** أفضل مصدرين تاريخيًا.  
**Tier 2:** 2-3 مصادر إضافية بعد مهلة قصيرة.  
**Tier 3:** المصادر النادرة/البطيئة/verification.

هذا أسرع وأرحم للـrate limits وCloudflare.

---

## 11. Last Known Playable - أهم Cache في المشروع

لا نخزن فقط “المصدر نجح”. نخزن أفضل route:

```text
canonical episode
→ source copy
→ server candidate
→ resolver
→ stream metadata
→ expiresAt
```

### 11.1 Stale-While-Revalidate

إذا snapshot عمره قصير لكنه تجاوز soft TTL:

1. استخدمه فورًا إذا ما زال صالحًا.
2. حدثه في الخلفية.
3. إذا فشل stream، انتقل تلقائيًا للـbackup.

### 11.2 TTL حسب الطبقة

| البيان | TTL مبدئي |
|---|---|
| canonical/source mapping | أيام/أسابيع |
| server candidate | دقائق/ساعات |
| tokenized stream URL | حسب expiry أو دقائق |
| host health | 5-30 دقيقة |
| source health | 15-60 دقيقة |
| aliases | شبه دائم |

---

## 12. Discovery Engine - “أي عمل موجود يجب ألا يضيع”

### 12.1 Alias Generator

لكل work:

```text
English
Arabic
Romaji
Native
Synonyms
Title without punctuation
Season 2 / 2nd Season / S2
Part 1 / Part 2
Year variants
Source-learned aliases
```

### 12.2 Match Score

لا نستخدم fuzzy title وحده.

```text
score =
 titleSimilarity
 + yearMatch
 + seasonMatch
 + episodeCountPlausibility
 + externalIdMatch
 + learnedMappingBoost
```

### 12.3 Persistent Mapping

بعد أول نجاح:

```text
canonicalId ↔ sourceWorkId
```

**المرة القادمة: افتح النسخة مباشرة.**

### 12.4 Catalog Warmup

بهدوء وعلى دفعات:

- trending.
- seasonal anime.
- continue watching.
- libraries.
- recently opened.
- friend activity.
- new releases.

لا نزحف الإنترنت كله. نجهز ما يهم المستخدمين.

---

## 13. الجودات: 1080p / 1440p / 2160p حقيقية

### 13.1 لا نصدق اسم الزر

إذا المصدر كتب `4K` لكن stream هو 1920×1080، VANTARA يعرض **1080p**.

### 13.2 HLS

اقرأ master playlist:

```text
#EXT-X-STREAM-INF
resolution
bandwidth
codecs
frame-rate
```

ثم ابنِ quality ladder حقيقية.

### 13.3 DASH

اقرأ MPD representations:

- width/height.
- bandwidth.
- codecs.
- HDR metadata إن وجدت.

### 13.4 MP4

- metadata/range probe خفيف.
- لا تحمل الملف كاملًا للتأكد.

### 13.5 Quality Score

```text
qualityScore =
 resolution
 + effective bitrate
 + codec efficiency
 + HDR bonus
 + server stability
 - startup penalty
```

لا تجعل 2160p ضعيف bitrate يتفوق آليًا على 1080p ممتاز.

---

## 14. APK - “نبكس الجوال” فعلًا

APK هو المنصة التي يجب أن تكون الأقوى.

### 14.1 Hot Path Native

استخدم الموجود أصلًا:

- OkHttp/native HTTP.
- Kotlin source adapters.
- native resolver layer.
- Room/SQLite أو cache محلي مناسب.
- Media3/ExoPlayer.

Media3 يدعم HLS multivariant ويكيف الجودة حسب bandwidth/device، ويدعم HLS وDASH وعدة container/codec paths.

### 14.2 لا نستبدل المحرك الحالي

المستودع الحالي يملك Android extension/native engine. **ONE SECOND يضيف فوقه ولا يهدمه.**

### 14.3 Dynamic JS Engine - اختياري لا إلزامي

إذا احتجنا providers ديناميكية مشتركة مع PWA:

- QuickJS/Duktape-like sandbox كطبقة إضافية.
- لا نجعل كل native resolver يمر عبر JS.
- native fast path يبقى للأكثر استخدامًا.

### 14.4 Concurrency

APK يمكنه تشغيل provider probes مباشرة من الجهاز بدون CORS. استخدم structured concurrency + cancellation:

```text
launch A + B
first playable wins
cancel expensive unnecessary work
keep cheap backups warming
```

### 14.5 Player Failover

إذا stream مات في الدقيقة 17:

1. احفظ currentPosition.
2. انتقل إلى next compatible stream.
3. seek إلى نفس الثانية.
4. لا تظهر error page إلا بعد استنفاد البدائل.

---

## 15. PWA - كيف نقترب من APK بلا VPS

PWA لا يستطيع كسر CORS أو إرسال كل header ممنوع لمجرد أن لدينا JS. لذلك نحتاج تصميمًا صريحًا.

### 15.1 Direct First

```text
PWA SourceRuntime.request()
→ جرّب browser direct إن كان CORS يسمح
→ وإلا استخدم Web Fetcher
```

### 15.2 Web Fetcher يجب أن يكون Dumb Relay

يفعل فقط:

- allowlist validation.
- fetch HTML/JSON/manifests صغيرة.
- redirects policy.
- auth/account rate limiting.
- cache قصير.

**لا يفعل:**

- parsing ثقيل.
- تشغيل JS للمواقع.
- proxy لكل HLS segment.
- تمرير فيديو 4K عبر Worker.

### 15.3 لماذا؟

Cloudflare Workers Free حاليًا يحدد تقريبًا:

- 100,000 requests/day.
- 10 ms CPU/request.
- 50 subrequests/invocation.
- 6 simultaneous outgoing connections/request.

لذلك parsing على المتصفح واستخدام Worker كـrelay رفيع هو الخيار الصحيح لمجموعة مستخدمين صغيرة.

### 15.4 PWA Eligibility Matrix

كل Host يعرف:

```text
pwaDirect = true/false
pwaViaFetcher = true/false
requiresForbiddenHeaders = true/false
requiresHumanVerification = true/false
```

إذا Host يحتاج سلوكًا لا يستطيع المتصفح تنفيذه بأمان، لا نضيع 10 ثوانٍ عليه؛ يصبح `APK_ONLY` أو backup غير مرشح للـPWA.

### 15.5 Web Player

- Safari: native HLS عندما يكون أفضل.
- بقية المتصفحات: hls.js للـHLS.
- Shaka فقط إذا احتجنا DASH/مسارات متقدمة لا يغطيها اللاعب الحالي.
- لا نغير واجهة VANTARA إلى player generic.

---

## 16. Dynamic Extension System - تحديث المصادر بدون تحديث التطبيق

### 16.1 لا نعمل `eval(raw GitHub JS)`

الصحيح:

```text
repo-index.json
→ package metadata
→ SHA-256/signature verification
→ compatibility check
→ sandbox
→ activate
```

### 16.2 Manifest

```json
{
  "id": "vantara.provider.example",
  "version": 12,
  "engine": ">=1.0",
  "domains": ["example.com"],
  "capabilities": ["SEARCH", "DETAILS", "EPISODES", "SERVERS"],
  "platforms": ["apk", "pwa"]
}
```

### 16.3 صلاحيات ضيقة

الإضافة تحصل على:

```text
http.request scoped to declared domains
html.parse
json.parse
crypto helpers
extension-scoped storage
```

ولا تحصل تلقائيًا على:

- حساب المستخدم.
- رموز auth الأخرى.
- كل ملفات الجهاز.
- DB كاملة.

### 16.4 Stable / Candidate / Last Known Good

كل Provider package له:

```text
Stable
Candidate
LastKnownGood
```

التحديث الجديد لا يصبح Stable إلا بعد E2E smoke. إذا انخفضت health بقوة، rollback تلقائي.

### 16.5 ماذا نتعلم من المشاريع المفتوحة؟

- **CloudStream:** provider plugins منفصلة وExtractor API مركزية.
- **Aniyomi:** extension call-flow + multisrc themes لتقليل تكرار adapters المتشابهة. لكن repo الرسمي للإضافات archived؛ نأخذ الفكرة لا نعتمد عليه كخدمة.
- **Stremio:** protocol contract يفصل `catalog`, `meta`, `stream`, `subtitles`.

---

## 17. Stremio-Compatible Provider Adapter

هذه إضافة معمارية قوية جدًا.

### 17.1 لماذا؟

بروتوكول Stremio يعرّف موارد قياسية:

```text
catalog
meta
stream
subtitles
```

VANTARA يمكنه دعم **Adapter** يقرأ manifest ويحوّل الموارد إلى عقود VANTARA.

### 17.2 المطلوب

```text
Stremio manifest
→ validate capabilities
→ map IDs
→ fetch stream resource
→ normalize Stream objects
→ run VANTARA health/quality/probe
```

### 17.3 مهم

- لا نعتمد على addon واحد كقلب التطبيق.
- user-configured/provider-approved manifests فقط.
- كل stream يمر عبر نفس Quality + Health + Platform checks.

---

## 18. Human Verification - رسمي وليس عطلًا

المستخدم لا يمانع تبويب تحقق، لذلك لا نقتل مصدرًا قويًا لمجرد أنه يحتاج challenge نادرًا.

### الحالات

```text
READY
NEEDS_VERIFICATION
COOLDOWN
FAILED
```

### التدفق

```text
Source يحتاج تحقق
→ زر "تحقق من المصدر"
→ افتح تبويب/نافذة تحقق
→ المستخدم يحل التحقق
→ session/cookies تُحفظ ضمن حدود المنصة
→ أعد extraction
→ إذا نجح، ارفع health
```

إذا التحقق يتكرر في كل حلقة:

- source priority تنخفض.
- يبقى backup.
- لا يظهر للمستخدم كل مرة إذا توجد بدائل أفضل.

---

## 19. UI - المستخدم لا يجب أن يرى القذارة الداخلية

### الوضع العادي

يعرض فقط:

```text
1080p جاهز
720p جاهز
4K HDR جاهز    ← فقط إذا فعلي
```

أو أسماء Servers الواضحة إذا أردنا الاختيار اليدوي.

### لا تعرض أثناء startup

```text
Server 1 loading...
Server 2 failed...
Server 3 extracting...
```

### Debug فقط

```text
Source → Match → Episode → Server → Embed → Resolver → Stream → Probe → Player
```

مع:

- latency.
- HTTP status.
- redirects.
- resolver selected.
- quality discovered.
- exact failure reason.

---

## 20. Zero-Server Emergency Path - أهم مسار في الخطة

إذا دخل المستخدم عملًا ونتيجة snapshot هي `0 playable`:

```text
1. لا تعرض 0 نهائيًا فورًا
2. شغّل exhaustive fallback fan-out
3. جرّب alternate aliases
4. ابحث source copies إضافية
5. استخرج server candidates من كل copy
6. شغّل resolvers بالتوازي على دفعات
7. إن ظهر NEEDS_VERIFICATION اعرضه مباشرة كخيار
8. أول playable يدخل الواجهة فورًا
9. البقية تكمل في الخلفية
```

### Failure Contract

إذا بعد الاستنفاد الحقيقي بقي 0:

يجب أن يكون لدينا سبب مصنف، لا `Unknown`:

```text
NO_SOURCE_MATCH
SOURCE_PAGE_CHANGED
NO_SERVER_BUTTONS
HOST_UNSUPPORTED
HOST_DOWN
VERIFICATION_REQUIRED
PLATFORM_UNSUPPORTED
STREAM_EXPIRED
PLAYER_CODEC_UNSUPPORTED
```

هذا يمنع “0 سيرفر” من أن يكون صندوقًا أسود.

---

## 21. Shared Availability Hints - اختياري ورخيص

للوصول لتجربة أفضل عبر عدة أجهزة بدون Home Server:

يمكن استخدام D1 الموجود أصلًا في مشروع VANTARA لتخزين **hints صغيرة فقط**:

```text
canonicalKey
bestSourceId
bestHostId
lastSuccessAt
qualitySummary
```

ولا نخزن video bytes ولا نعتمد عليها للتشغيل.

الفائدة:

- جهاز A يكتشف أن Host X ممتاز.
- جهاز B يبدأ ترتيبه من X بدل الصفر.

هذا اختياري؛ Local cache يبقى مصدر الحقيقة التشغيلي على الجهاز.

---

## 22. Repo Constraints - مخصوص لـVANTARA الحالي

بناءً على بنية المستودع الحالية:

- `apps/web/` واجهة مشتركة للويب والـAPK.
- `android/` يحتوي المحرك الأصلي للإضافات.
- يوجد مسار content server/self-hosting قديم في المستودع.

### قرار ONE SECOND

**لا يجوز أن يعتمد Anime/Cinema playback critical path على `apps/api` أو جهاز البيت.**

المسار الجديد:

```text
APK:
apps/web UI
→ native bridge
→ local provider/resolver runtime
→ direct upstream/CDN
→ Media3

PWA:
apps/web UI
→ browser provider runtime
→ direct fetch OR serverless web-fetcher
→ direct CDN media
→ web player
```

أي شيء يحتاج Home Server يصبح خارج هذه الخطة.

---

## 22A. ROCK GATES - متى نقول إن العمل "موجود" فعلًا؟

هذه هي القاعدة التي تمنع تكرار مشكلة: **80% من الأعمال موجودة لكن 0 Server.**

### Work Support Gate

لا يدخل العمل حالة `SUPPORTED` إلا إذا تحقق:

```text
Canonical identity        PASS
Source copy mapping       PASS
Episode/Movie mapping     PASS
>= 1 AR_READY server      PASS
Resolver                  PASS
Lightweight stream probe  PASS
Device/player capability  PASS
```

يمكن أن يبقى العمل ظاهرًا ككتالوج إذا لم ينجح التشغيل، لكن داخليًا حالته `CATALOG_ONLY` وليس `SUPPORTED`، ويطلق Zero-Server Recovery في الخلفية.

### أهداف الصخرة

| المقياس | الهدف |
|---|---:|
| Popular/current discovery | >= 99% |
| Popular/current AR_READY playable | >= 98% |
| Popular/current Zero-Server | <= 1% |
| Overall discovery benchmark | >= 95% |
| Overall AR_READY playable | >= 90% أوليًا ثم نرفعها |
| Popular works with >=2 independent playable paths | >= 85% |
| Warm Time-To-Player-Prepare median | <= 1.0s |
| Cold Time-To-First-Playable median | <= 2.5s |
| P95 cold | <= 6s |

هذه **SLOs هندسية وليست ضمانًا أن كل عمل على الإنترنت سيعمل 100%**؛ طالما VANTARA لا يملك المحتوى أو البنية التحتية الأصلية، لا يمكن ضمان كل عمل وكل لحظة. لكن أي صفر سيرفر يجب أن يصبح استثناءً مقاسًا ومطاردًا، لا حالة طبيعية.

---

## 23. Benchmark - لا نريد “اشتغل عندي”

### 23.1 Corpus

على الأقل **120 حالة لكل Vertical**:

#### Anime
- 30 مشهور جدًا.
- 30 موسمي/حديث.
- 30 متوسط.
- 30 قديم/نادر.

#### Cinema/TV
- 30 أفلام/مسلسلات ضخمة.
- 30 إصدارات حديثة.
- 30 متوسطة.
- 30 قديمة/نادرة.

### 23.2 Metrics

```text
Discovery Rate
Source Copy Count
Zero-Server Rate
>=1 Playable Rate
>=2 Independent Playable Paths Rate
>=1080p Rate
>=2160p Rate WHEN upstream actually offers it
Warm Time To First Playable
Cold Time To First Playable
P95 Time To First Playable
Verification Rate
Host Failure Distribution
Platform Unsupported Rate
```

### 23.3 Release Gates

#### Popular content

- Discovery >= **99%**.
- >=1 playable >= **95%**.
- Zero-server <= **1%**.
- >=2 independent paths >= **85%**.

#### Overall corpus

- Discovery >= **95%**.
- >=1 playable >= **90%**.
- Zero-server <= **5%**.

#### Speed

- Warm median <= **1.0s** إلى player prepare/buffering.
- Cold median <= **2.5s**.
- P95 <= **6s**.

إذا لم نصل لهذه الأرقام، لا نقول “ONE SECOND اكتمل”.

---

## 24. مراحل التنفيذ - بالترتيب الصحيح

### Phase 0 - Baseline and instrumentation

- لا تغير behavior بعد.
- أضف trace كامل للمسار مع رموز ⓪.6 لكل فشل.
- ابدأ بالـcorpus الميداني ⓪.3 (حالات المالك) ثم corpus الـ120.
- طبّق اختبارات البث الخمسة ⓪.4 في أداة القياس.
- استخرج: نسب 0-server، الـlatency، و**Self-Inflicted Failure Rate** بفصل upstream عن VANTARA.

**Gate:** نعرف أين يضيع كل request، ومن المسؤول عنه.

### Phase 0.5 - قتل الـFalse Failures (قبل أي مصدر جديد)

- كل سيرفر قال عنه VANTARA «غير متاح» يُعاد اختباره بمشغّل خارجي وبالترويسات الصحيحة.
- كل حالة يشغّلها الخارجي ولا يشغّلها VANTARA = `VANTARA_BUG` يُصلح في طبقته.
- Device Capability Matrix في الاختيار (⓪.5).

**Gate:** لا يوجد سيرفر صالح يُعرض «غير متاح».

### Phase 1 - Resolver Fabric

- فصل source discovery عن hosts.
- نقل الـHGCloud/MegaMax/StreamHG/Sendvid/OK.ru/etc إلى resolvers مستقلة.
- direct HLS/DASH/MP4 resolvers.
- quality normalization.

**Gate:** إصلاح Host واحد يفيد عدة Sources.

### Phase 2 - Availability + Last Known Playable

- local cache.
- soft/hard TTL.
- stale-while-revalidate.
- health scoring.

**Gate:** reopen يبدأ فورًا بدون full extraction.

### Phase 3 - Progressive Parallelism

- Tier 1/2/3 fan-out.
- first playable wins.
- cancellation.
- circuit breaker.

**Gate:** لا يوجد 30 ثانية انتظار على Server واحد.

### Phase 4 - Discovery Coverage

- aliases.
- fuzzy + metadata matching.
- persistent source mappings.
- catalog warmup.

**Gate:** الأعمال التي كانت “موجودة في الموقع لكن VANTARA لا يجدها” تنخفض جذريًا.

### Phase 5 - Provider Portfolio

- تثبيت 5-8 sources لكل Vertical.
- Stable/Candidate/LKG.
- E2E benchmark لكل Source.

**Gate:** المصدر لا يعد Stable إلا بـplayback.

### Phase 6 - Dynamic Extension Repo

- manifests.
- signing/hash.
- sandbox.
- updates/rollback.

**Gate:** source fix يصل بدون app release.

### Phase 7 - PWA hardening

- direct-first.
- Worker relay only when needed.
- pwaEligible host matrix.
- IndexedDB availability cache.
- real Safari/Chrome/Edge testing.

### Phase 8 - Real-device proof

APK:
- Samsung/Android reference device.
- Wi‑Fi + 5G/4G.

PWA:
- iPhone/iPad Safari.
- Windows Chrome/Edge.

**No fake-engine-only acceptance.**

---

## 25. ما نؤجله عمدًا

هذه الخطة لا تتشتت في:

- AI subtitle translation.
- OCR translation.
- redesign player.
- recommendation algorithms.
- social redesign.
- downloads overhaul.

**حتى يصبح:**

> Find → Servers → Play

ممتازًا.

---

## 26. قائمة Must-Have النهائية

### Core

- [ ] Canonical work identity.
- [ ] Alias fan-out.
- [ ] Persistent source mappings.
- [ ] Provider registry with capabilities.
- [ ] Stable/Candidate/LKG lifecycle.
- [ ] Source/Resolver separation.
- [ ] Host Resolver Fabric.
- [ ] HLS/DASH/MP4 normalization.
- [ ] Actual quality inspection.
- [ ] Health scoring.
- [ ] Circuit breaker.
- [ ] Last Known Playable.
- [ ] Stale-while-revalidate.
- [ ] Progressive provider fan-out.
- [ ] First Playable Wins.
- [ ] Automatic playback failover.
- [ ] Human verification flow.
- [ ] Zero-server emergency path.
- [ ] Structured failure reasons.
- [ ] Real E2E benchmark.

### APK

- [ ] Native fast path preserved.
- [ ] Local HTTP/parsing/extraction.
- [ ] Media3/ExoPlayer.
- [ ] Native cache.
- [ ] No Home Server dependency.
- [ ] Optional JS extension runtime only where useful.

### PWA

- [ ] Browser direct-first.
- [ ] Thin Cloudflare fetch relay.
- [ ] No segment proxy by default.
- [ ] IndexedDB cache.
- [ ] PWA eligibility per host.
- [ ] native HLS/hls.js; DASH engine only when needed.
- [ ] No Home Server / VPS.

---

## 27. Claude/Coding-Agent Handoff - النص الذي يمثل الرؤية

انسخ هذا القسم كما هو للكودنج إيجنت:

```text
PROJECT: VANTARA ANIME / CINEMA - ONE SECOND

This is not a “add a few more sources” task.
It is a reliability architecture project.

PRIMARY USER REQUIREMENT:
When the user opens any anime/movie/series that exists in our configured providers, VANTARA must not lose it because of bad title matching, source discovery, server extraction, host resolution, or slow serial fallback.

The current highest-priority failure is:
works are found, but many show ZERO playable servers.
SERVER RELIABILITY IS PRIORITY 0.

NON-NEGOTIABLE:
- No Home Server.
- No VPS.
- Do not make playback depend on a PC being online.
- Preserve existing Android native engines; additive changes only unless proven safe.
- PWA may use the existing Cloudflare/serverless web fetcher as a THIN fetch relay, but do not proxy video segments by default.
- APK should maximize client-side/local work.
- PWA should perform parsing/resolution client-side when browser rules allow it.
- Human verification is acceptable as an explicit, rare NEEDS_VERIFICATION flow.
- Do not build AI translation in this project.

ARCHITECTURE:
Canonical Media
→ Source Copies
→ Server Candidates
→ Host Resolvers
→ Resolved Streams
→ Quality/Health Scoring
→ Availability Snapshot / Last Known Playable
→ First Playable Wins
→ Player

SEPARATE 3 FAILURE CLASSES:
1) DISCOVERY_FAILURE:
   Work exists upstream but VANTARA did not find it.
2) SERVER_DISCOVERY_OR_RESOLUTION_FAILURE:
   Work is found, but servers/embeds/resolvers fail.
3) PLAYBACK_REDUNDANCY_FAILURE:
   Only one slow/broken path exists and fallback is serial.

SOURCE PROVIDERS AND HOST RESOLVERS MUST BE SEPARATE.
A provider discovers content and server candidates.
A resolver understands a host family and returns playable HLS/DASH/MP4 streams.
Fixing one resolver should fix every provider that uses that host.

BUILD A CENTRAL RESOLVER FABRIC FOR:
- direct HLS
- direct DASH
- direct MP4
- HGCloud family
- MegaMax family
- StreamHG family
- Sendvid
- OK.ru
- Dailymotion
- packed/embed families already encountered by VANTARA

Do not invent success from a server label.
A source is only “working” when a real stream reaches the player.

DISCOVERY:
Generate and try aliases:
English, Arabic, Romaji, Native, synonyms, punctuation-free,
Season 2 / 2nd Season / S2,
Part variants, year variants.
Persist canonicalId ↔ sourceWorkId after the first successful match.
The second visit should open the source copy directly instead of searching again.

ANIME PROVIDER PORTFOLIO:
Target 5-8 genuinely E2E-working providers, not vanity count.
Start from current VANTARA adapters such as WitAnime and other already-tested providers.
Treat Anime4Up-like challenge providers as Candidate/NEEDS_VERIFICATION until real E2E tests pass.
Use AniList as metadata/canonical primary with cached fallbacks; never depend on live AniList for every click.

CINEMA PROVIDER PORTFOLIO:
Target 5-8 genuinely E2E-working providers.
Start from current adapters already in VANTARA (ArabSeed, Shahiid, TukTuk and current candidates such as FaselHD/Cimaleek/EgyDead as measured, not assumed).
Cinemeta is META/CATALOG, NOT a playback source.
Add a Stremio-compatible provider adapter as a protocol capability, but keep each actual provider optional and health-scored.

DYNAMIC EXTENSIONS:
Build a VANTARA provider package format with:
- id/version/engine version
- declared domains
- capabilities
- platforms
- SHA/signature verification
- Stable / Candidate / Last Known Good
- rollback
Do NOT eval arbitrary raw GitHub JavaScript with full app permissions.

ONE-SECOND PATH:
On work/detail open, prewarm availability for the most likely movie/episode.
On Play:
- immediately use Last Known Playable if valid
- start Tier-1 providers/resolvers in parallel
- expand to Tier-2 after a short bounded delay
- expand to rare/verification fallbacks only when necessary
- first playable wins
- keep useful backups warming in background
Never wait 20-30 seconds for Server A before trying B.

CACHE:
Store AvailabilitySnapshot locally.
Use soft TTL + hard TTL + stale-while-revalidate.
Store source mapping for much longer than ephemeral stream URLs.
Tokenized stream URLs must respect expiration.

QUALITY:
Parse HLS master playlists / DASH MPDs and record actual:
resolution, bitrate, codec, HDR, audio codec.
Never trust a “4K” label if the actual stream is 1080p.
Support 720/1080/1440/2160 when genuinely available.

PWA:
- Direct browser fetch first when CORS allows.
- Existing Cloudflare Worker only as thin fetch relay for allowed hosts.
- Parsing in browser.
- Do not proxy every media segment.
- Track PWA compatibility per resolver/host.
- Do not waste startup time on a host that is fundamentally browser-incompatible.

APK:
- keep native hot path
- OkHttp/native source adapters/resolvers
- Media3/ExoPlayer
- local cache
- structured concurrency and cancellation
- optional JS runtime only for dynamic providers that benefit from shared code

FAILOVER:
If playback dies mid-stream:
choose next compatible known-good stream and resume near the same playback position.
Do not show a hard error until backups are exhausted.

ZERO SERVER EMERGENCY PATH:
If a work initially has 0 playable servers:
- retry alternate title aliases
- discover more source copies
- extract all server candidates
- run resolver fan-out
- expose NEEDS_VERIFICATION immediately when applicable
- publish the first playable result immediately
- continue finding backups in background
Never leave ZERO SERVER as an unexplained terminal state.

DIAGNOSTICS:
Trace:
Source → Match → Episode/Movie → Server → Embed → Resolver → Stream → Probe → Player
Record latency and structured failure reason.

BENCHMARK BEFORE CLAIMING SUCCESS:
At least 120 anime cases + 120 cinema/TV cases:
very popular / current / medium / obscure-old.
Report:
Discovery Rate
Zero-Server Rate
>=1 Playable Rate
>=2 Independent Paths Rate
>=1080p Rate
>=2160p Rate when upstream offers it
Warm/Cold Time To First Playable
P95 Time To First Playable
Verification Rate
Failure Cause Distribution

THE ROCK RULE (above everything):
If the upstream is playable, VANTARA plays it.
If an external player plays the same URL with the same headers and VANTARA does not: VANTARA_BUG.
Never show 'server unavailable' for a false failure.
Run the five stream tests (resolve, HTTP, manifest→variant→segment, codec, playback) before blaming upstream.
Select streams by device capability × quality × health × latency.
Track Self-Inflicted Playback Failure Rate: APK < 0.1%, PWA < 0.5%.

ARABIC FIRST:
Arabic sources rank first everywhere. English sources exist as an explicit, labeled fallback only when
no Arabic source has the episode/chapter or it was released earlier in English. Never auto-picked over AR_READY.

EXTENSIONS:
The built-in curated rock comes first. Extensions may strengthen it but never override built-in sources,
run under the same tests/health, and are auto-demoted when they hurt the experience.

VERIFICATION:
A Cloudflare check once per source session (>= 24h / a whole season) is acceptable; per-episode is not Stable.
PWA classes: BROWSER_REUSABLE / FETCHER_OK / APK_PREFERRED / VERIFICATION_UNSTABLE / UNSUPPORTED.
Test browser-direct and fetcher independently before classifying. Never assume Cloudflare = impossible on PWA.
PWA SLO: Verification Interruption Rate <= 1% of Stable Core playback sessions.

INDEPENDENCE:
A path is independent only if it differs in source, video host, or preferably CDN chain.
4 server labels backed by the same host = 1 effective path.

FAILOVER EQUIVALENCE:
Compare duration/timeline before resuming at the same position; apply a learned offset or
restart at a safe nearby timestamp when versions differ materially.

ROCK CORE GATE:
Anime >= 4 and Cinema/TV >= 4 independent Arabic Stable providers, plus >= 1 non-Arabic fallback lane each.
Extensions never count toward it.

PLATFORMS:
APK, PWA, and Windows Desktop (evaluate Tauri + WebView2 first; measure Cloudflare reuse in WebView2).
Same rule on all three: if upstream is playable and fits the platform, VANTARA plays it.

RELEASE TARGETS:
Popular:
Discovery >=99%
Playable >=95%
Zero-server <=1%
>=2 independent paths >=85%

Overall corpus:
Discovery >=95%
Playable >=90%
Zero-server <=5%

Speed:
Warm median <=1.0s to player prepare/buffering
Cold median <=2.5s
P95 <=6s

IMPORTANT:
Do not claim success because tests with mocked providers pass.
Use real E2E provider/server/player tests on APK and real browser tests on Safari/Chrome/Edge.
Preserve APK behavior while adding the PWA path.

Before coding, inspect the current repository and produce:
1) current playback pipeline map,
2) exact failure points causing zero-server results,
3) reusable current components,
4) migration plan by phase,
5) baseline benchmark.
Then implement phase-by-phase with tests and measured before/after results.
```

---

## 28. مراجع هندسية تم التحقق منها - 2026-10-02

1. **CloudStream Extractor API** - يوضح فصل ExtractorLinks و`loadExtractor()` عن providers:  
   https://github.com/recloudstream/cloudstream/blob/master/library/src/commonMain/kotlin/com/lagradost/cloudstream3/utils/ExtractorApi.kt

2. **CloudStream Plugin Manager / Repository Manager** - plugin packages، hashes، repositories، remote status:  
   https://github.com/recloudstream/cloudstream/blob/master/app/src/main/java/com/lagradost/cloudstream3/plugins/PluginManager.kt  
   https://github.com/recloudstream/cloudstream/blob/master/app/src/main/java/com/lagradost/cloudstream3/plugins/RepositoryManager.kt

3. **Aniyomi extensions architecture** - `AnimeHttpSource`, `ParsedAnimeHttpSource`, multisrc themes. ملاحظة: المستودع الرسمي archived في 2025:  
   https://github.com/aniyomiorg/aniyomi-extensions

4. **Stremio Addon Protocol** - resources: `catalog`, `meta`, `stream`, `subtitles`:  
   https://stremio.github.io/stremio-addon-sdk/protocol.html

5. **Cinemeta official addon manifest** - catalog/meta وليس stream:  
   https://github.com/Stremio/stremio-official-addons/blob/master/index.json

6. **Android Media3 / ExoPlayer HLS** - multivariant HLS، WebVTT، adaptive playback:  
   https://developer.android.com/media/media3/exoplayer/hls

7. **Media3 supported formats** - HLS/DASH/progressive formats:  
   https://exoplayer.dev/supported-formats.html

8. **Shaka Player** - HLS/DASH وDRM support matrix عند الحاجة لمسارات web متقدمة:  
   https://github.com/shaka-project/shaka-player/blob/main/README.md

9. **AniList rate limits** - degraded 30 req/min حاليًا وفق وثائقهم:  
   https://docs.anilist.co/guide/rate-limiting

10. **Jikan limits** - 3 req/s و60 req/min مع cache:  
    https://docs.api.jikan.moe/

11. **Cloudflare Workers limits** - Free: 100k requests/day، 10ms CPU، 50 subrequests، 6 simultaneous outgoing connections/request:  
    https://developers.cloudflare.com/workers/platform/limits/

12. **Anime Rift official site** - يعلن 5000+ عمل HD/FHD وأن المحتوى يأتي من أطراف ثالثة ولا يستضيف الوسائط بنفسه؛ لا توجد تفاصيل عامة كافية للتحقق من باك إنده الداخلي:  
    https://anime-rift.com/ar

13. **Anime Rift Google Play reviews** - مراجعات 2026 تتضمن شكاوى من أخطاء السيرفر، بطء المشغل الداخلي، وتوقف الحلقة؛ مفيدة كدليل أن تعدد المصادر وحده لا يلغي مشاكل التشغيل:  
    https://play.google.com/store/apps/details?id=com.riftapps.animerift

14. **Stremio Android buffering reports (community evidence)** - أمثلة حديثة على اختلاف السلوك بين Android وWindows وعلى مشاكل buffering/player updates؛ تستخدم كـfailure cases لا كمرجع رسمي للمنتج:  
    https://www.reddit.com/r/Stremio/comments/1pn39qm/playback_issues_android/  
    https://www.reddit.com/r/Stremio/comments/1qz0bah/insane_buffering_after_new_update/

15. **Android Media3 supported formats** - HLS/DASH/MP4 مدعومة، لكن codec decoding يعتمد على قدرات Android والجهاز:  
    https://developer.android.com/media/media3/exoplayer/supported-formats

---

## ⓪D. حدود الصدق — ما نضمنه وما لا نضمنه

**نضمنه ونقيسه:** ألا يفشل التشغيل بسببنا؛ ألا يضيع عمل موجود بسبب البحث/المطابقة؛ ألا ننتظر سيرفرًا ميتًا؛ ألا نختار بثًا لا يفكّه الجهاز؛ وأن يكون لكل فشل سبب حقيقي.

**لا يضمنه أحد:** عملًا لا يملكه أي مصدر، أو سيرفرات ميتة فعلًا عند المصدر. هنا واجبنا: بديل جاهز، ودليل أن العطل ليس منا.

**ما يحتاج جهازًا حقيقيًا:** القياس النهائي للـAPK على Samsung/Android، والـPWA على iPhone/iPad Safari وChrome/Edge. أدوات القياس الآلية تعطي الأرقام، والجهاز الحقيقي يصادق عليها.

---

## الخلاصة

**VANTARA ONE SECOND ليس مشروع “أضف مصادر”.**

هو مشروع تحويل VANTARA من:

```text
اضغط الحلقة
→ ابحث الآن
→ استخرج الآن
→ انتظر السيرفر
→ يمكن يفشل
```

إلى:

```text
VANTARA يعرف العمل ونسخه مسبقًا
→ يعرف أفضل Hosts
→ يحتفظ بآخر مسار صالح
→ يبدأ أفضل stream فورًا
→ يجهز البدائل في الخلفية
→ إذا مات stream ينتقل تلقائيًا
```

وعندها تصبح تجربة الأنمي والسينما مثل ما نريده فعلًا:

> **أدخل العمل. ألقى الحلقة/الفيلم. أضغط Play. يبدأ.**

