# Stable Add-ons Selective Port Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** نقل إصلاحات تجربة الإضافات والتحقق الصامت إلى مرشح Stable من أساس stable-213، دون نشر.

**Architecture:** إعادة استخدام تعديلات الواجهة المعتمدة على الفرع التجريبي فقط. إبقاء محركات المصادر وملفاتها وحسابات المستخدمين ومحدد التطبيق والتوقيع والمحدّث من Stable. اختبارات Release مستقلة لا تستخدم بيانات Debug.

**Tech Stack:** JavaScript/Vitest, Kotlin/JUnit, Android Release, GitHub Actions.

**Spec:** متطلبات المالك في المحادثة؛ docs/ADDONS_STABLE_SELECTIVE_PORT_20261028.md يوثّق التنفيذ والنتائج.

## Global Constraints

- أساس المصدر stable-213=c5741f01aa1d6386e7b50c5ddf3a78e1c73ff841.
- لا دمج main أو نشر أو تحديث خدمات Cloudflare.
- لا تعديل محركات المحتوى أو حسابات أو مشغل أو محدّث أو إعدادات توقيع Stable.
- إعداد Manifest داخل VANTARA يبقى مسار configureInApp الأصلي.
- لا نسخ بيانات Debug أو مسح مخازن المستخدمين.

## Review Focus

- وظائف الكتالوج والبحث والفصول والصفحات الأصلية لا تتغير.
- مستودعات المستخدمين وملفاتهم تبقى بعد تحديث APK وإعادة تشغيله.
- challenge خلفي لا يفتح Activity؛ إلغاء التحقق لا يغلق التطبيق.
- أزرار الإعداد لا تفتح Stremio بدل VANTARA.
- Release حقيقي غير debuggable ومحدد حزمة Stable ثابت.

## Task 1: Selective production port

Files: Addons V7, source-verification, existing bridge metadata/icons and interceptor lifecycle; tests accompanying each.

- [ ] نقل الملفات المعتمدة بصورة صريحة، واستبعاد Debug signing/workflows/updater/generator changes.
- [ ] تثبيت حارس مقارنة مع stable-213 لملفات المحركات الحساسة ووظائف الاستخراج وإعداد Manifest؛ إثبات فشله أمام تعديل متعمد في نسخة اختبار مؤقتة.
- [ ] تشغيل اختبارات الويب والسلامة والحارس وفحص diff.
- [ ] حفظ النقل في التزام مستقل على فرع stable-selective.

## Task 2: Independent Stable candidate acceptance

Files: .github/workflows/android-stable-candidate.yml; tools/android-stable/* (test-only).

- [ ] بناء Release بتوقيع Stable الفعلي كـArtifact فقط دون إصدار عام.
- [ ] تشغيل اختبار Release مستقل لترقية/إعادة التشغيل وصمت التحقق؛ لا يُعتبر نجاح اختبار محلي بديلًا عن Android.
- [ ] انتظار نتائج Actions وتوثيق النتائج والحدود؛ عدم تحويل اختبارات المصادر الحية غير المنفذة إلى نجاح.
- [ ] دفع الفرع وفتح PR مراجعة دون دمج.
