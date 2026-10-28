# تحقق تنقل الإضافات في Chromium

يشغّل `navigation-proof.py` واجهة shell/V7/SourceMode الحقيقية من المستودع، مع مزامنة مجهولة وخلفية مصدر محليتين للاختبار فقط. يمنع جميع طلبات الشبكة الخارجية. لا يختبر المصادقة أو محركات Android أو تشغيل مصدر حي.

المتطلبات: Python وPlaywright وChromium. شغّل من جذر المستودع:

```sh
CHROMIUM_PATH=/usr/bin/chromium python tools/addons-ui/navigation-proof.py cycles
```

يحفظ JSON ولقطات الشاشة في `addons-ui-evidence` (يمكن تحديد `ADDONS_UI_EVIDENCE`). يفحص ثلاثين دورة: الرئيسية ← الإضافات ← المثبتة ← المصدر ← المثبتة ← الرئيسية، وزر رجوع خارجي واحد، وأخطاء JavaScript، وتحرير لقطات المصدر. فشل أي تحقق يُنهي الأمر بخطأ؛ ليست نتائج المصادر المحاكاة إثباتًا لعمل المواقع.
