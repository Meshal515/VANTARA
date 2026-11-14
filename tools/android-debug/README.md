# بوابة ترقية Debug

تُشغَّل الأدوات من `android-debug.yml` قبل أي رفع إلى `debug-channel`، على فرع V7 المصرّح به وحده. لا تغيّر Stable أو مفتاح التوقيع.

- `verify-apks.py`: يتحقق من توقيع APK السابق والمرشح الفعليين، وثبات `com.vantara.app.debug` والبصمة المثبتة، وتطابق APK السابق مع hash/size/version في manifest المنشور، وارتفاع `versionCode` وتطابق إصدار المرشح مع هذه الدفعة.
- `upgrade-check.sh`: يثبت APK السابق ثم المرشح عبر `adb install -r` على محاكي جديد. لا يمسح بيانات التطبيق ولا يزيله. يفشل إذا لم تدعم صورة المحاكي ARM64 للـAPK الموقّع نفسه.
- `webview-proof.mjs`: يتصل بالـWebView الحقيقي عبر CDP، ويتحقق من استمرار علامات اختبار في `localStorage` و`IndexedDB` وملف Native، وثبات هوية الجهاز الأصلية بعد الترقية وإعادة تشغيل العملية. يفتح Home والإضافات ثلاثين مرة باستخدام renderer المنشور والجسور الأصلية، مع sync محلي مجهول لا يستخدم حسابات إنتاج.
- يرصد الاختبار تغيّر PID أو فقدان MainActivity للتركيز، وإنشاء `:verification` أو `VerificationActivity` تلقائيًا، وعدد WebViews زائدًا، وأخطاء JavaScript وcrash وANR. تحفظ CI لقطات وصورًا وLogcat وتقارير الذاكرة ونتائج الاختبار حتى عند الفشل.

هذا اختبار ترقية وتكرار تنقل. علامات الاستمرار لا تمثل جلسة حساب حقيقي، ولا يثبت الاختبار اجتياز Cloudflare أو عمل مصدر أو فيديو على جهاز فعلي. تشغيل Chromium المحلي يفيد في فحص harness فقط؛ لا يُعد دليل Android. نجاح المحاكي مطلوب للنشر ولا يجوز تجاوزه عند تعذّر المحاكي.

التحقق المحلي للأدوات:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tools/android-debug -p 'test_*.py' -v
node --check tools/android-debug/webview-proof.mjs
bash -n tools/android-debug/upgrade-check.sh
```
