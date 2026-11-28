# دراسة: اعتماد نظام Mihon الأصلي للشبكة والجلسات والتحقق لإضافات Mihon

> فرع مستقل: `exp/mihon-network-parity-20261128`. لا يُعتمد شيء هنا قبل إثبات الاستقرار على جهاز المالك.
> النطاق: إضافات Mihon (المانجا) وحدها. **خارج النطاق:** CloudStream وStremio والتورنت والتصميم.
> المرجع: `mihonapp/mihon` عند `f8e30a86` (22 نوفمبر 2026)، Apache-2.0.

## 1. الدليل من جهاز المالك (Debug 3522، Hijala)

| السؤال | الدليل من التشخيص | الحكم |
|---|---|---|
| لماذا أُغلقت النافذة؟ | `COMPLETE_VERIFIED` عند +6.3 ث، `clearance=true new=true` | أُغلقت لأن Cloudflare أصدر جلسة جديدة |
| هل اكتمل التحدي؟ | `new=true` مع `hadInitial=true` | نعم، قبل الإغلاق |
| هل جلسة المحرك هي جلسة النافذة؟ | `Engine jar`: ‏`cf_clearance` واحد، `firstIsNew=true` | نعم، النقل صحيح بلا قديم مكرر |
| هل يقبلها الموقع من المحرك؟ | `Engine probe`: ‏`CHALLENGED 403 mitigated=challenge cfClearanceSent=1 h2` | لا |

النتيجة: الكوكي لم يعد المشكلة. Cloudflare يرفض **طريقة إرسال المحرك للطلب** وهو يحمل جلسة صالحة،
وMihon يدخل الموقع نفسه بلا أي تحدٍّ منذ أيام. الفرق إذن في طريقة الإرسال بين المحركين.

## 2. مكونات Mihon الأصلية واعتمادياتها

| المكون (Mihon) | الدور | الاعتماديات |
|---|---|---|
| `core/common/.../network/NetworkHelper.kt` | عميل واحد: كوكيز، ذاكرة 5MiB، مهل 30/30/120 ث، `UncaughtExceptionInterceptor`، `UserAgentInterceptor`، `CloudflareInterceptor`. DoH اختياري من الإعدادات (الافتراضي: لا شيء = DNS النظام) | OkHttp 5.5.1، `okhttp-dnsoverhttps`، Metro DI |
| `NetworkPreferences.defaultUserAgent` | هوية ثابتة بشكل Chrome المختصر: `Mozilla/5.0 (Linux; Android 10; K) ... Chrome/149.0.0.0 Mobile Safari/537.36` | Preference store |
| `AndroidCookieJar.kt` | مخزن OkHttp = `CookieManager` نفسه الذي تكتب فيه WebView | `android.webkit` |
| `interceptor/CloudflareInterceptor.kt` | يكشف التحدي بـ`cf-mitigated: challenge` + `Server: cloudflare` فقط، قفل قراءة/كتابة لكل مضيف، يحذف `cf_clearance` ثم يحل في WebView مخفية، ويتوقف عند `interactiveBegin` | `androidx.webkit` 1.18 (عالم JS معزول) |
| `interceptor/WebViewInterceptor.kt` | `createWebView`: ‏`setDefaultSettings()` ثم `setUserAgent(UA الطلب)` | — |
| `util/system/WebViewUtil.kt` ‏`setUserAgent` | يضبط `userAgentString` **ويطابق Sec-CH-UA** (Android WebView ← Google Chrome، والإصدار نفسه) | `WebSettingsCompat.USER_AGENT_METADATA` |
| `presentation/webview/WebViewScreenContent.kt` + `ui/webview/WebViewActivity.kt` | التحقق اليدوي: العملية نفسها والمخزن نفسه، و`setUserAgent(headers["user-agent"])` **بالمطابقة نفسها** (السطر 365) | Compose |
| `JavaScriptEngine.kt`، `RateLimitInterceptor`، `SpecificHostRateLimitInterceptor`، `Requests.kt`، `OkHttpExtensions.kt` | عقد الإضافات | QuickJS `547f5b1597` |

**الترخيص:** Apache-2.0 متوافق مع AGPL-3.0-only (في اتجاه واحد). أي كود يُنقل حرفيًا يُسجَّل في `NOTICE.md`
(السطر 24 يغطي `android/app/src/main/kotlin/eu/kanade/` مسبقًا) مع رأس المصدر والتعديلات.

## 3. المقارنة: Mihon / Stable 215 / Stable 224 / Debug الحالي

| البند | Mihon | Stable 215 | Stable 224 | Debug (3522) |
|---|---|---|---|---|
| هوية المتصفح للمحرك | Chrome مختصر ثابت `Android 10; K`، رئيسي فقط | WebView الجهاز بلا `; wv` و`Version/`: طراز وBuild/ ورقم كامل | مثل 215 | مثل 215 |
| DNS | النظام (DoH اختياري) | `HostRouting`: ‏DoH أولًا لمضيفات المصادر | مثل 215 | مثل 215 |
| معترضات إضافية | لا شيء | `HostRouting` | + `HttpsUpgrade` + `HostCircuitBreaker` | مثل 224 |
| كشف التحدي | `cf-mitigated` + `Server` | `CloudflareRequestPolicy` (25 سطرًا) | `CloudflareRequestPolicy` (47 سطرًا) | مثل 224 |
| حذف `cf_clearance` قبل الحل الصامت | نعم | لا | لا | لا (الحذف في الاستيراد فقط، d2a19e6d) |
| الحل الصامت | WebView مخفية، الهوية مطابقة | WebView مخفية، مطابقة | مطابقة | مطابقة (`alignUserAgentMetadata`) |
| نافذة التحقق اليدوي | العملية والمخزن نفسهما، **مطابقة Sec-CH-UA** | عملية `:verification` ومخزن معزول، **بلا مطابقة** | مثل 215 | مثل 215 (أُزيلت المطابقة في 4b723f45) |
| نقل الجلسة | لا نقل (مخزن واحد) | `cf_clearance` وحده، 30 دقيقة (`Max-Age=1800`) | `cf_clearance` + الكوكيز، 30 يومًا | `sessionImport` 7 أيام بعد حذف القديم |
| حجم `CloudflareInterceptor` | 280 سطرًا | 595 | 673 | 642 |

## 4. الفرضيات القابلة للاختبار (بالترتيب)

1. **الهوية:** هويتنا (طراز وBuild/ ورقم Chrome كامل بلا `wv`) لا يرسلها Chrome حقيقي. Cloudflare يتحدّاها،
   وMihon يرسل هوية Chrome المختصرة فلا يُتحدّى أصلًا.
2. **الطريق:** DoH ومعترضات VANTARA تغيّر شيئًا في الطلب.
3. **ربط الجلسة بهوية الحل:** النافذة تعلن `Android WebView` في Sec-CH-UA وChrome في UA، والمحرك يعلن Chrome.
   Mihon يطابقها في النافذة اليدوية أيضًا.

## 5. التجربة (منفّذة في هذا الفرع، Debug وحده، بلا تغيير سلوك)

مصفوفة 2×2 بعد كل تحقق، **بلا كوكيز**، أربعة طلبات GET مرة واحدة، بلا إعادة ولا تجاوز عند الرفض:

| | هويتنا | هوية Mihon |
|---|---|---|
| طريق محركنا (DNS ومعترضات VANTARA) | `engine+ourUA` | `engine+mihonUA` |
| عميل عارٍ كـMihon (DNS النظام، بلا معترضات) | `bare+ourUA` | `bare+mihonUA` |

- `mihonUA` = شكل Mihon الافتراضي برقم Chrome الرئيسي لـWebView الجهاز نفسه.
- قراءة النتيجة: إن قُبل عمود Mihon ورُفض عمودنا فالهوية هي السبب (فرضية 1). إن اختلف الصفان فالطريق سبب (فرضية 2).
  إن رُفضت الأربعة فالسبب في ربط الجلسة أو في عنوان الشبكة (فرضية 3 أو أبعد).
- الاختبار الآلي: `android/app/src/test/java/com/vantara/verification/MihonParityProbeTest.kt` على خادم محلي فقط.

## 6. خطة الاعتماد بعد الدليل (لا تُنفّذ قبله)

1. **الهوية:** إن ثبتت فرضية 1: `defaultUserAgentProvider` بشكل Mihon (Chrome مختصر برقم WebView الرئيسي)
   لإضافات Mihon فقط، و`setUserAgent` بمطابقة Mihon في الحل الصامت ونافذة التحقق معًا.
2. **المخزن:** مخزن واحد كـMihon مع بقاء العزل عن واجهة التطبيق: ملف WebView مستقل للمصادر
   (`androidx.webkit` Profile، ‏`MULTI_PROFILE`) يستخدمه `AndroidCookieJar` ونافذة التحقق معًا، فلا نقل ولا نسخ.
   البديل حيث لا تدعمه WebView: النقل الحالي.
3. **المعترض:** `CloudflareInterceptor` بمنطق Mihon (كشف `cf-mitigated`، قفل لكل مضيف، حذف قبل الحل) مع إبقاء
   ضوابط VANTARA: لا تحقق تفاعلي إلا بضغطة المستخدم، ولا إعادة طلب عند الرفض الصريح، وحدود الطلبات.
4. **ما يبقى من VANTARA:** عزل الإضافات، فحص العناوين العامة (`VerificationPolicy.publicDns`)، القاطع (`HostCircuitBreaker`)
   واحترام `Retry-After` و429، وعدم تسجيل القيم.

## 7. معايير الاستقرار قبل الاعتماد

- Hijala وموقعان آخران يحتاجان تحققًا: تحقق واحد يفتح المصدر، ويبقى مفتوحًا ما دامت مدة الموقع.
- لا تحقق إضافي لموقع يعمل اليوم بلا تحقق، ولا زيادة في طلبات أي موقع (عدّ الطلبات قبل/بعد).
- اختبارات الوحدة والسلامة كلها خضراء، ولا ملف خارج النطاق (CloudStream/Stremio/تورنت/تصميم) يتغير.
- تجربة المالك على جهازه هي الحكم.

## 8. قيد التسليم للجهاز

بناء الفروع غير فرع V7 يوقَّع بمفتاح مؤقت (`android-debug.yml`، مهمة `apk`)، فلا يُثبَّت فوق تطبيق Debug الحالي إلا
بإزالته، وهذا يمحو بياناته. لذلك المصفوفة (تشخيص فقط، بلا تغيير سلوك) تحتاج قناة Debug لتصل الجهاز، والاعتماد نفسه
يبقى في هذا الفرع حتى تثبت النتيجة.
