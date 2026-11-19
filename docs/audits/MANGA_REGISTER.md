# سجل قسم المانجا (جرد كامل)

> **النسخة المفحوصة:** فرع Debug `feat/addons-v7-native-manager-20261027` عند `2c3a32e`.
> **لم يُعدَّل أي كود.** سكربتات الإثبات في آخر الملف وتستورد ملفات المشروع كما هي.
> **قاعدة الإثبات الثلاثي:** البند لا يُعدّ «مشكلة مثبتة» إلا بثلاثة: الكود، والاختبار أو التشغيل، وجوال المالك.

## معنى الأعمدة

| العمود | المعنى |
| --- | --- |
| **كود** | تتبعت المسار سطرًا سطرًا ولا طريق آخر يمنع الخلل. |
| **اختبار** | سكربت أو اختبار شغّل كود المشروع الحقيقي وأخرج السلوك الخاطئ. |
| **جوال** | المالك رآه على جهازه (✅ رآه، ⏳ بانتظار التجربة، — لا يظهر للمستخدم مباشرة). |

الخطورة: **حرج** (فقد بيانات)، **عالٍ** (يكسر تجربة أساسية)، **متوسط** (يزعج ويتكرر)، **منخفض** (حافة).

---

## 1) هوية العمل والتكرار

**الملفات المقروءة سطرًا سطرًا:** `lib/catalog.js` (مطابقة العناوين والفهرس القانوني)، `lib/manga-twins.js`، `lib/manga-alias-store.js`، `lib/manga-evidence.js`، `lib/manga-meta.js`، `v35/works.js` (`workIndex`، `browse`، `browseLive`، `addPage`، `ranked`، `mergeWorkPages`)، `v35/shell.js` (مطابقة AniList ودمج المكتبة)، `lib/unified-identity.js` (الرأس).

### كيف يعمل اليوم

1. كل مصدر يرجع قائمة أعمال بعناوينها فقط.
2. `canonicalIndex` يدمج النسخ في بطاقة واحدة بأربعة أدلة: توأم العنوان، والأسماء البديلة المحفوظة (343 عملًا مشحونًا مع ما يتعلّمه الجهاز من صفحات الأعمال)، والأسماء البديلة التي تحملها النسخة (MangaDex وحده)، والعنوان الأصلي الكوري/الصيني/الياباني.
3. **بعد** رسم البطاقة، كل بطاقة تُطابق وحدها مع AniList (`fetchMangaMatches`) لتأخذ التقييم والغلاف الرسمي.

### البنود

| # | الخطورة | كود | اختبار | جوال | الخلل |
| --- | --- | --- | --- | --- | --- |
| ID1 | **عالٍ** | ✅ | ✅ | ✅ (صورتا البحث) | الهوية الرسمية (معرّف AniList) معروفة لكل بطاقة ومرمية: بطاقتان بنفس المعرّف تبقيان بطاقتين |
| ID2 | **عالٍ** | ✅ | ✅ | ✅ | أسماء AniList البديلة (كل أسماء العمل) تصل الجهاز ولا تدخل الدمج |
| ID3 | **عالٍ (دمج خاطئ)** | ✅ | ✅ (بيانات مصطنعة) | — | العنوان الأصلي يُطبَّع بلا أرقام: «X 2» يُدمج مع «X» |
| ID4 | **عالٍ (لا رجعة)** | ✅ | — | — | الدمج يُحفظ في `refAliases` للأبد بلا طريق فك؛ دمج خاطئ واحد يخلط تقدّم ومكتبة عملين دائمًا |
| ID5 | متوسط | ✅ | ✅ | — | مقياس الهوية «ينجح» وفيه 939 بطاقة مكررة؛ يقيس الدمج الخاطئ فقط |
| ID6 | متوسط | ✅ | — | — | بطاقات AniList (الأكثر قراءة والتصنيفات) تُعامل «بلا نسخ» فلا يدخل اسمها ولا أسماؤها الفهرس |
| ID7 | متوسط | ✅ | — | ⏳ | مرجع العمل `ext:<العنوان المطبَّع>`: نفس العمل بعنوان آخر = مرجع آخر = تقدّم ومكتبة منفصلان حتى يُعرف الدمج |
| ID8 | منخفض | ✅ | — | — | `manga-twins` لا يقارن إلا العناوين اللاتينية، ويقف عند 4 أسماء، ويعتمد على الخادم كل 6 ساعات |

#### ID1 وID2: نفس العمل ثلاث بطاقات رغم أن النظام يعرف أنه واحد

- **من صورة المالك:** البحث «The tale of cultivation and» يعرض ثلاث بطاقات لعمل واحد: «The Tale of Cultivation and Demon Extermination» و«Chronicles of the Demon-Slaying Ascetic» و«Myeolgwisudojeon». ويعرض «The Crazy Villain Regains His Sanity» و«미친 빌런이 정신을 되찾음» بطاقتين.
- **العلامة في الصورة:** نفس التقييم (7.7 للثلاث، و6.8 للاثنتين). التقييم يأتي من مطابقة AniList لكل بطاقة، أي أن كل بطاقة طابقت **نفس العمل الرسمي**.
- **الموضع:**
  - `lib/manga-meta.js` `matchMangaRating` و`matchMangaArt` يرجعان `id` عمل AniList.
  - `v35/shell.js:957-963` (`flushRatings`) يأخذ `rating` و`art` فقط، و`id` لا يصل `canonicalIndex` ولا `mergeWorkPages`.
  - `lib/catalog.js` `canonicalIndex` لا يعرف أي معرّف خارجي؛ أدلته كلها نصوص.
- **الإثبات** (`proofs/dup1.mjs`، الكود الحقيقي + AniList حيًّا):
  ```
  بطاقات الفهرس: 5
  AniList "The Tale of Cultivation and Demon Extermination" → id 214315 score 7.7
  AniList "Chronicles of the Demon-Slaying Ascetic"        → id 214315 score 7.7
  AniList "Myeolgwisudojeon"                               → id 214315 score 7.7
  AniList "The Crazy Villain Regains His Sanity"           → id 218041 score 6.8
  AniList "미친 빌런이 정신을 되찾음"                           → id 218041 score 6.8
  ```
- **ID2:** نفس رد AniList يحمل كل الأسماء (`synonyms`): العمل 214315 أسماؤه «Until No Demon Remains» و«Myeolgwisudojeon» و«멸귀수도전» و«The Tale of Cultivation…» و«Chronicles of the Demon-Slaying Ascetic». الأسماء الثلاثة في الصورة كلها هنا، ولا يُحفظ منها شيء في `learnAliases`.
- **الغلاف الكوري:** غلاف AniList الرسمي للعمل 214315 هو نفسه الغلاف بالشعار الكوري. أي أن البطاقتين الكوريتين تعرضان **الرسمي** حسب قاعدة «الرسمي أولًا»، والبطاقة الثالثة غلاف Asura. **قرار للمالك:** هل الغلاف الرسمي بشعار كوري مقبول، أم يُفضَّل غلاف بشعار إنجليزي أو عربي من المصدر حين يتساوى في الجودة؟

#### ID3: دمج عمل مع جزئه الثاني بالعنوان الأصلي

- **الموضع:** `lib/catalog.js:339-344` (`originalTitle`) يبقي حروف الهانغل والكانجي وحدها ويرمي الأرقام. «나 혼자만 레벨업» و«나 혼자만 레벨업 2» يصيران المفتاح نفسه «나혼자만레벨업».
- **الحارس الوحيد** `spinOff` يقارن الكلمات الإنجليزية للمفتاحين. إن اختلف العنوانان الإنجليزيان كليًا (اسم جديد للجزء الثاني) لا يمنع شيئًا.
- **الإثبات** (`proofs/dup2.mjs` و`proofs/dup3.mjs`):
  ```
  S1 나혼자만레벨업  S2 나혼자만레벨업
  عملان مختلفان (الثاني برقم 2 في عنوانه الأصلي) → 1 بطاقة: [ 'Ragnarok Arise [2]' ]
  ```
- **الأثر:** فصول عملين في بطاقة واحدة، وهذا أسوأ من التكرار حسب قاعدة الملف نفسه. البيانات مصطنعة، والحالة تحتاج مصدرين يحملان الاسمين الأصليين (MangaDex يحملها).

#### ID4: الدمج لا يُفك

- `lib/manga-alias-store.js` `noteRefAliases` يضيف فقط («These references own saved progress… dropping an old name would hide user data»)، ولا توجد دالة حذف.
- `v35/works.js:67` يسجل كل دمج يحسبه الفهرس، أي أن دمجًا خاطئًا مؤقتًا (ID3، أو اسم بديل خاطئ من مصدر، أو توأم خاطئ من `manga-twins`) يصير دائمًا في `refsOf`.
- **الأثر:** التقدّم والمكتبة والتقييم (`refsOf` في `shell.js:475,481,1949,2817,2828,3867`) والفصول المحفوظة (`chapter-store.js:61`) تُقرأ من العملين معًا للأبد، حتى بعد تصحيح سبب الدمج.

#### ID5: لماذا تقول الاختبارات «لا تكرار»؟

- `lib/manga-identity-bench.test.js` يقيس على 1911 عملًا حقيقيًا من AniList، ويشترط **صفر دمج خاطئ** و**ألا يتراجع** عدد الأعمال الموحدة. لا يشترط صفر تكرار.
- **نتيجة التشغيل اليوم:**
  ```
  titles:   works=1911 cards=2789 duplicates=939  (البحث والقوائم: العنوان وحده)
  mangadex: works=1911 cards=2724 duplicates=876
  details:  works=1911 cards=1995 duplicates=144  (بعد فتح صفحات الأعمال)
  full:     works=1911 cards=1949 duplicates=100
  Tests 6 passed (6)
  ```
- **المعنى:** في البحث يتكرر قرابة نصف الأعمال التي تحملها أكثر من مصدر بأسماء مختلفة. والفهرس صارم عن قصد («دمج عملين مختلفين أسوأ من بطاقتين»)، لكن الدليل الذي يحل المشكلة (ID1) موجود ومرمي.
- **ملاحظة:** المقياس نفسه يعتمد معرّف AniList حقيقةً أرضية. أي أن نفس الدليل يصلح للقياس والدمج.

#### ID6 إلى ID8

- **ID6:** `v35/works.js:690-693` يضع البطاقة بلا `editions` في `unrelated`، فلا يدخل اسمها ولا `synonyms` الفهرس. بطاقة «الأكثر قراءة» من AniList (`manga-meta.js` `mangaMetadata`) مفتاحها `ext:until no demon remains`، ونسخة المصدر `ext:the tale of cultivation…`. تُدمجان فقط إن ربطهما `refAliases` من قبل.
- **ID7:** `seriesRefOf` = `ext:${work.key}`. القراءة من بطاقة قبل أن يُعرف الدمج تُكتب بمرجع، والقراءة بعده بمرجع آخر. `refsOf` يجمعهما بعد الدمج فقط (وهذا يعتمد على ID4). **تجربة للمالك:** اقرأ فصلًا من بطاقة، ثم افتح البطاقة الأخرى لنفس العمل: هل تظهر «تابع القراءة» بموضعك؟
- **ID8:** `manga-twins.js:20-21` يرفض أي عنوان فيه غير اللاتيني، و`:84` يتجاهل المجموعات فوق 4.

---

## 2) محرك المصادر والإضافات (Android)

**المقروء سطرًا سطرًا:** `ExtensionEnginePlugin.kt` كاملًا (1388 سطرًا)، و`lib/extension-engine.js` كاملًا، و`NetworkHelper.kt` (بناء العميل)، و`FillerSources.kt` (`splitSourceId`)، وقائمة المصادر المدمجة سابقًا في `GeneratedSources.kt`.
**لم يُقرأ بعد في هذا القسم:** `UserExtensions.kt`، و`CloudflareInterceptor.kt`، و`FileExtensionLoader.kt`، و`SourceCompatRepairs.kt`، وجسر الويب `pwa/sources/*`.

**ما هو سليم:** التحقق من البصمة والتوقيع قبل تحميل أي كود، ورفض الرجوع لإصدار أقدم، والتحديث المرحلي الذي لا يمس الإصدار العامل قبل نجاح الجديد، والكتابة الذرية لكاش الصفحات، ورفض صفحة حجب تُرد بـ200 بفحص توقيع الصورة.

| # | الخطورة | كود | اختبار | جوال | الخلل |
| --- | --- | --- | --- | --- | --- |
| SE1 | **عالٍ** | ✅ | ❌ (يحتاج Android SDK) | ⏳ (بلاغ دحمي) | التحديث الذاتي والرجوع لآخر إصدار سليم لا يأخذان أثرًا في المصادر المدمجة سابقًا حتى يُعاد تشغيل التطبيق |
| SE2 | متوسط | ✅ | — | ⏳ | كاش الصفحات بمفتاح الرابط وحده بلا انتهاء: صورة «تحذير» سليمة التوقيع من الموقع تبقى مكان الصفحة |
| SE3 | متوسط | ✅ | — | — | إضافات المانجا من مستودع المستخدم لا تتحدث وحدها أبدًا؛ المدمجة سابقًا تتحدث يوميًا |
| SE4 | منخفض | ✅ | — | — | `pageImage` و`cover` يتجاوزان فحص «المصدر مضاف لحسابك» (EE3 من #349 باقٍ) |
| SE5 | منخفض | ✅ | — | ⏳ | صفحة من موقع لا يرد تأخذ حتى 90 ثانية قبل الفشل (3 محاولات × 30 ث) |

#### SE1: «رجعنا لآخر إصدار سليم، أعد المحاولة» ثم يفشل بنفس الإصدار

- **الموضع:** `ExtensionEnginePlugin.kt:494-497`:
  ```kotlin
  private fun forget(pkg: String) {
      packages.remove(pkg)
      loaded.keys.removeAll { it.startsWith("$pkg#") }
  }
  ```
- **الخلل:** معرّف المصدر المدمج سابقًا هو اسم الحزمة نفسه (`…ar.mangaswat`) أو `pkg@en` للتكملة، بلا `#`. الشرط `startsWith("$pkg#")` لا يطابقه، فيبقى كائن الإصدار القديم في `loaded`، و`obtain()` (`:1001`) يرجعه مباشرة قبل أي تحميل.
- **من يتأثر:**
  - `updateBuiltin` (`:1278`): التحديث اليومي والتحديث عند عطل الإضافة يثبّتان الإصدار الجديد على القرص، والقارئ يكمل بالقديم.
  - `recover` (`:1324`): يقول للمستخدم «رجعنا تلقائيًا لآخر إصدار سليم؛ أعد المحاولة» (`:1234`)، وإعادة المحاولة تستعمل نفس الكائن المعطوب.
  - `removeBuiltin` (`:278`) يتفادى الخلل بشرطه الخاص (`splitSourceId`)، وهذا دليل أن الشكل الصحيح معروف.
- **المصادر المتأثرة:** الـ16 كلها، ومنها MangaSwat وTeam X وMangaDex وDilar.
- **علاقته ببلاغ دحمي (تحذير على كل صفحات MangaSwat، ثم اشتغل في تحديث لاحق):** **محتمل لا مؤكد.** يتسق مع «الموقع تغيّر ← نزل إصدار الإضافة الجديد في الخلفية ← بقي القديم في الذاكرة ← اشتغل بعد إعادة تشغيل التطبيق أو تحديثه». **سؤال للمالك أو دحمي:** هل جربتوا إغلاق التطبيق كاملًا وفتحه قبل التحديث؟

#### SE2 إلى SE5

- **SE2:** `image()` (`:725-776`) يكتب الصورة في `cache/pages/<sha256(url)>` ويقرؤها في كل مرة بعدها بلا تاريخ انتهاء. إن رد الموقع بصورة «احذر» أو «Hotlink» سليمة (JPEG حقيقي) تُقبل وتُحفظ، وتبقى بعد تحديث الإضافة ما دام الرابط نفسه. يمسحها فقط السقف أو «امسح التنزيلات» أو النظام.
- **SE3:** `addons-v7.js:821-826` و`:865`: التحديث بزر يدوي («فحص تحديث» ثم «تطبيق»). `refreshBuiltinsDaily` (`:1288-1299`) للمدمجة سابقًا وحدها (`userStore.extension(pkg) != null` يُستثنى).
- **SE4:** `extension-engine.js` `pageImage` و`cover` يناديان `required()` لا `forSource()`، و`ExtensionEnginePlugin.cover` (`:818`) يحمّل الحزمة كاملة لطلب غلاف.
- **SE5:** `NetworkHelper.kt`: `readTimeout(30s)` ومعترض إعادة يكرر GET ثلاث مرات على أي `IOException` منها انتهاء المهلة، و`callTimeout` دقيقتان.

---

## سكربتات الإثبات

تُشغَّل من أي مجلد بـ`node`، وتستورد `apps/web/lib` من المستودع بلا تعديل.

### `dup1.mjs` (ID1 وID2)

```js
const R = '/home/user/VANTARA/apps/web/lib/';
const { canonicalIndex } = await import(R + 'catalog.js');
const { fetchMangaMatches } = await import(R + 'manga-meta.js');
const T = [
  ['asura', 'The Tale of Cultivation and Demon Extermination'],
  ['srcB', 'Chronicles of the Demon-Slaying Ascetic'],
  ['srcC', 'Myeolgwisudojeon'],
  ['srcD', 'The Crazy Villain Regains His Sanity'],
  ['srcE', '미친 빌런이 정신을 되찾음'],
];
const idx = canonicalIndex();
for (const [s, title] of T) idx.add({ sourceId: s, manga: { title, url: '/x/' + encodeURIComponent(title) } });
console.log('بطاقات الفهرس:', idx.list().length, idx.list().map((w) => w.title));
const m = await fetchMangaMatches(T.map((t) => t[1]), { fetchImpl: fetch });
for (const [t, v] of m) console.log('AniList', JSON.stringify(t), '→ id', v.rating?.id ?? v.art?.id ?? null, 'score', v.rating?.score ?? null);
```

### `dup3.mjs` (ID3)

```js
const { canonicalIndex } = await import('/home/user/VANTARA/apps/web/lib/catalog.js');
const i = canonicalIndex();
i.add({ sourceId: 'mangadex', manga: { title: 'Solo Leveling', altNames: ['나 혼자만 레벨업'] } });
i.add({ sourceId: 'other', manga: { title: 'Ragnarok Arise', altNames: ['나 혼자만 레벨업 2'] } });
console.log(i.list().length, i.list().map((w) => w.title + ' [' + w.editions.length + ']'));
```

### ID5

```
pnpm exec vitest run apps/web/lib/manga-identity-bench.test.js
```
