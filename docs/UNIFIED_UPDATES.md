# VANTARA — تحديثات Android / PWA / Windows من إصدار واحد

## نموذج التحديث

مصدر الإصدار المستقر هو **GitHub Release** من نوع `stable-<versionCode>`، ومعه
`vantara-update.json`. لا تُغَيَّر بنية Android الحالية أو توقيع الـAPK.
في نفس الإصدار، تُبنى نسخة Windows x64 من commit الخاص بالإصدار وتُختبر على Windows.
لا تُضاف `desktop` إلى manifest حتى **بعد** رفع EXE/ZIP واجتياز فحص التشغيل على Windows.

- **Android:** `apps/web/lib/updater.js` يحتفظ بتنزيل APK وفحص SHA والتوقيع
  وطلب إذن التثبيت من أندرويد. إذا لم تتغير البصمة الأصلية، يستطيع استخدام حزمة
  الواجهة حسب سياسة التحديث الحالية. لا تثبيت صامت.
- **PWA:** `apps/web/pwa/update.js` و`sw.js` يكتشفان القشرة الجديدة وينزلان
  الأصول في cache جديد، ثم يفعّلانها بموافقة المستخدم أو عند إغلاق الجلسة.
  النشر إلى Cloudflare Pages يتطلب تفعيل `VANTARA_WEB_ENABLED=true` ونجاح CI.
- **Windows:** `apps/web/desktop/update-check.js` يقرأ **نفس manifest** ويعرض
  تحديث Windows فقط إذا وجد حقل `desktop` صالحًا أحدث من المثبّت. زر التحميل
  يفتح EXE الرسمي من GitHub، والتثبيت يظل يدويًا بعد إغلاق التطبيق.
  لا توجد آلية تثبيت تلقائي أو توقيع رقمي لمثبت NSIS حاليًا.

## التسلسل التنفيذي

1. دمج فرع الميزات في `main` بعد النجاح في CI والمراجعة.
2. نجاح CI على `main` يشغّل `android-stable.yml` ويُصدر `stable-N` مع APK
   و`VANTARA-web.zip` و`vantara-update.json`.
3. نشر PWA عبر `cloudflare-pages.yml` من نفس commit المعتمد، إن كان مفعّلًا.
4. حدث نشر `stable-N` يشغّل `windows-stable-companion.yml` الذي يأخذ *نفس tag*،
   ويضبط نسخة ويندوز على نفس `versionName`، ويبني EXE/ZIP، ثم يختبر التثبيت
   ومشغل mpv على Windows Server 2022.
5. ينشر الـworkflow ملفات ويندوز أولًا، ثم يُلحق `desktop` ببصمة SHA256
   في بيان التحديث. أي فشل قبل هذه النقطة يُبقي المستخدم على الحزمة السابقة.

## قيود أساسية

- الإصدار على المنصات الثلاث من **مصدر واحد**، لكن ليس تحديثًا ذرّيًا متزامنًا:
  PWA وAPK يظهران حين ينتهي نشرهما، وويندوز عند نجاح بناء واختبار ويندوز.
- تحديث واجهة واحدة لا ينقل تلقائيًا مكتبات Android الأصلية إلى Windows أو العكس.
  يجب اختبار وظائف المشغل وتورنت/الغرف لكل منصة على حدة.
- لا يُنشر فرع المعاينة على الإنتاج، ولا يسمح Workflow التحديث الجديد بنشر
  stable من commit خارج main.
- المعاينة `windows-v0.1.0-preview.4` (عند نشرها بعد النجاح) تقدّم **فحص
  تحديثات ويندوز** فقط؛ لا تدّعي أنها أصلحت واجهة mpv المنفصلة أو كل أخطاء
  التورنت، ولا تُظهر تحديث Windows مستقرًا حتى يُنشر حقل `desktop`.
- الأمان النهائي يتطلب توقيع EXE / تحديثات ويندوز وتثبيتًا آمنًا مع rollback
  إذا كان المطلوب تحديثًا آليًا بالكامل؛ هذه ليست خاصية منفذة في المعاينة.

## التحقق

```bash
node --test apps/web/desktop/update-check.test.js tools/unified-windows-manifest.test.mjs
node --check apps/web/desktop/update-check.js
node --check apps/desktop/main.cjs
```

ملفات الدليل: `tools/unified-windows-manifest.mjs`، وسير العمل
`.github/workflows/windows-stable-companion.yml`، وخطة المعاينة
`.github/workflows/windows-unified-preview.yml`.
