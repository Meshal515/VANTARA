# VANTARA Web (PWA)

نسخة المتصفح من VANTARA: تُثبَّت على الآيفون والآيباد والكمبيوتر من المتصفح،
وتقرأ وتشاهد من نفس المصادر، بنفس الحساب والمكتبة والتقدم.

## القاعدتان

1. **لا تلمس الـAPK.** كل ما هنا إضافي. داخل التطبيق الأصلي لا يعمل سطر واحد
   من كود الويب، ولا يعرف التطبيق جالب الويب. ويحرس ذلك:
   - `tools/repository-safety.test.mjs` (قسم «PWA: لا تلمس الـAPK»).
   - `.github/workflows/pwa-guard.yml`: أي PR يمسّ ملفات الـPWA يفشل إن تغيّرت
     بصمة الكود الأصلي (`tools/native-fingerprint.mjs`).
2. **بلا VPS ولا خادم بيت.** الشيء الوحيد على الخادم هو Cloudflare Worker
   (`services/web-fetcher`) على الخطة المجانية.

## كيف تعمل

```
المتصفح (apps/web)
  ├─ الواجهة نفسها التي في الـAPK (v35/، lib/) — بلا نسخة ثانية
  ├─ pwa/platform.js     البوابة: isNative() / isWeb() / webPlugin()
  ├─ pwa/boot.js         يركّب جسور الويب مكان إضافات Capacitor (في المتصفح فقط)
  ├─ pwa/bridges/        نفس واجهة إضافات الـAPK (ExtensionEngine …)
  ├─ pwa/sources/        محركات العائلات + تعريفات المصادر + السجل
  ├─ pwa/cache/          كاش البيانات (IndexedDB) وكاش الصور (service worker)
  └─ pwa/net/            عميل جالب الويب
        │  POST /v1/fetch · POST /v1/grant · GET /v1/media
        ▼
services/web-fetcher (Cloudflare Worker)
  يجلب صفحات المصادر وصورها نيابةً عن المتصفح: قائمة مواقع مسموحة فقط،
  للمسجّلين فقط (توكن المزامنة نفسه)، ولا يحلّل HTML (المحركات في المتصفح).
```

لماذا المحركات في المتصفح لا في الـWorker: الـWorker المجاني له 10ms معالج
لكل طلب، وتحليل صفحة كبيرة يتجاوزها. والمتصفح عنده `DOMParser` أصلي وسريع.

## المصادر

- **العقد الموحّد** (`pwa/sources/contract.js`):
  مانجا: `search · popular · latest · series · pages`،
  أنمي وسينما: `search · episodes · servers · streams`.
- **محرك لكل عائلة لا لكل موقع** (`pwa/sources/engines/`): Madara وحده يخدم
  أغلب المصادر العربية. موقع جديد من نفس العائلة = سطر في `defs.json`.
- **نفس معرّفات وصيغ الـAPK**: عمل محفوظ من التطبيق يفتح في الويب والعكس
  (Madara: `url` رقم المنشور، و`memo` فيه المسار).
- **محركات الويب منفصلة عن إضافات الـAPK**: الـAPK يشغّل إضافات Keiyoushi كما
  هي؛ الويب له محركاته. تعديل أحدهما لا يمسّ الآخر.

### Stable / Candidate / Last Known Good (`pwa/sources/registry.js`)

| الحالة | ماذا يحدث |
|---|---|
| مصدر جديد | يُستعمل فورًا ويُفحص في الخلفية |
| تعريف بإصدار أعلى أو معدّل | «مرشّح»: القديم يبقى شغّالًا حتى ينجح فحص المرشح |
| نجح الفحص | المرشح يصير stable، والقديم last known good |
| فشل الفحص | لا يُعتمد أبدًا، ويُعاد فحصه بعد 6 ساعات |
| الـstable يفشل 4 مرات متتالية فعليًا | رجوع تلقائي إلى last known good |
| تحقق Cloudflare أو شبكة | تبريد 10 دقائق فقط، بلا رجوع (ليس عطلًا في التعريف) |

الفحص: بحث بكلمة التعريف ← تفاصيل أول نتيجة ← فصول ← صفحات أول فصل.

### Cloudflare

- حماية «بصمة» فقط (Wall A): تمرّ عبر الجالب، مدعومة.
- تحدي JavaScript أو تحقق إنسان (Wall B): يُحكم عليه من الجالب نفسه
  (`GET /health/hosts`، ونتيجته في ملخص نشر `web-fetcher.yml`). ما يحتاج
  إنسانًا كل مرة يُعلَّم «غير مدعوم في الويب» فقط، ويبقى كما هو في الـAPK.

## الكاش

| الطبقة | أين | الصلاحية | الحد |
|---|---|---|---|
| قشرة التطبيق (HTML/JS/CSS/الخطوط) | service worker، `vantara-shell-<بصمة>` | حتى تتغيّر القشرة | — |
| بيانات الأعمال والفصول | IndexedDB `meta` | 30 دقيقة (الصفحات أسبوع) | 40 MB |
| ردود المصادر (بحث وقوائم) | IndexedDB `source` | 10–30 دقيقة | 30 MB |
| صحة المصادر والسجل | IndexedDB `health` | أسبوع | 2 MB |
| الأغلفة وصفحات الفصول | service worker، `vantara-img-v1` | دائم حتى الطرد | 2500 صورة أو نصف الحصة |

- **المنتهي لا يُرمى**: إن فشلت الشبكة يُعرض آخر ما رأيته (stale-if-error).
- **الطرد**: الأقدم استعمالًا أولًا (LRU) حتى 80% من الحد.
- **التعافي**: قاعدة تالفة أو لا تُفتح تُبنى من جديد مرة، وإن فشلت يعمل الكاش
  في الذاكرة. مدخل تالف يُحذف ويُعامل كغياب. Safari يغلق القاعدة في الخلفية
  فتُفتح من جديد تلقائيًا.
- يُطلب من المتصفح ألا يمسح التخزين (`navigator.storage.persist()`).

## مخفي من الـPWA بقرار المالك

- **رفيق** (مساعد التوصيات).
- **ترجمة المانجا** (كل أزرارها وإعداداتها).

هذا قرار، لا عطل. داخل الـAPK كلاهما كما هو. البوابة:
`hiddenOnThisPlatform('rafiq' | 'translation')` في `pwa/platform.js`.

## التشغيل محليًا

```bash
# 1) المزامنة محليًا (D1 محلية)
cd services/sync-worker && npx wrangler@4 d1 migrations apply vantara --local
npx wrangler@4 dev --local --port 8787 --var ALLOWED_ORIGINS:http://127.0.0.1:8765
# 2) جالب الويب محليًا (نفس كود الـWorker على Node)
VANTARA_IDENTITY_SECRET=<نفس سر .dev.vars> ALLOWED_ORIGINS=http://127.0.0.1:8765 npx tsx tools/pwa/dev-fetcher.ts
# 3) الواجهة
cd apps/web && python3 -m http.server 8765
```

وفي المتصفح: `localStorage['vantara.endpoints'] = '{"sync":"http://127.0.0.1:8787"}'`
و`localStorage['vantara.fetch.url'] = 'http://127.0.0.1:8790'`.

فحص محرك على المواقع الحقيقية من الطرفية: `tools/pwa/live-fetcher.mjs`.

## النشر

- الجالب: `web-fetcher.yml` بعد نجاح CI على main (أسرار: Cloudflare + سر الهوية).
- الواجهة: `cloudflare-pages.yml`، **مطفأ** حتى يُضبط متغيّر المستودع
  `VANTARA_WEB_ENABLED=true` (إعدادات المستودع ← Variables).
