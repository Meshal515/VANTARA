# Windows Stable Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** إصلاح رجوع Windows لقناة قديمة، وفصل إنشاء Stable عن main، ونقل تكامل التورنت والإضافات من APK.
**Architecture:** واجهة apps/web المشتركة، وبيان Stable موثوق مع آخر مثبت Windows مكتمل، وحارس مستقل في main process. يكيّف الوكيل منطق المحرك واختبارات المنصة.
**Tech Stack:** Electron, Node, Vitest, GitHub Actions, Kotlin/libtorrent.
**Spec:** طلب المالك بتاريخ26 أكتوبر2026 في هذه المحادثة.

## Global Constraints
- الحفاظ على الحسابات والهوية والبيانات.
- رفع التغييرات المتحققة على فرع مستقل؛ إنشاء Stable يدوي مع CI ناجح.
- لا ادعاء تكافؤ محركات دون تشغيل فعلي أو نقل AndroidSDK حرفيًا.

## Review Focus
- رفض0.3.18لمستخدمStable209.
- عدم اكتمالWindowsفيآخرAPK لا يجيز قناة أقدم.
- رفضIPCلمثبت يخالف رقم الإصدار قبل التنزيل.
- رفض إصدار من فرع غيرmain أو SHA دونCI قبل أسرار التوقيع.
- تشغيلcold/warm/seek وتكامل الإضافة علىWindows فعلًا.

### Task 1: التحديث
**Files:** update-check.js/tests، updater.cjs/tests، main.cjs.
**Interfaces:** checkDesktopUpdate(bridge)، assertForwardUpdate(update,installed).
- [x] اختبارات حمراء تثبت اختيار0.3.18بدلStableالأحدث.
- [ ] إصلاح المصدر وحارسIPC؛ تشغيلVitest/Node ثمرفعcommit.

### Task 2: الإصدار اليدوي
**Files:** android-stable.yml، windows-stable-companion.yml، repository-safety.test.mjs، windows-stable-channel.mjs/tests.
**Interfaces:** workflow_dispatchعلىmain؛ source_shaموجودفيmain ولهCIناجح؛ مؤشرformat2بعدفحصWindows.
- [ ] اختبار منعworkflow_run/pushلإنشاءStable مع حفظ بواباتCI والتوقيع.
- [ ] تنفيذ الإصدار اليدوي ومؤشر Windows مضاد الرجوع وتوحيد سلسلة أعلى0.3.18.
- [ ] فحص YAML والسلامة والبناء ورفع النتائج.

### Task 3: المحرك والإضافات
**Files:** يحددها الوكيل windows_android_torrent_parity_20261026 خارج ملفات التحديث.
**Interfaces:** عقود Desktop playback/addon runtime الحالية.
- [ ] مقارنةAndroidالحالي وإثبات اختناقاتcold/warm/seek ثم نقل المنطق.
- [ ] اختبار تورنت قانوني وتكامل إضافة وWindowsCI؛ رفع النتيجة وحدودها.
