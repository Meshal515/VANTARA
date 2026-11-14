# Repository Compatibility Runtime — Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement task-by-task.

**Goal:** تأسيس نواة توافق أصلية وحاجز حزم تجريبي، مع دليل واضح على ما يعمل وما لم يُنفذ.
**Architecture:** وحدات جديدة مستقلة؛ لا توصيل إنتاجي ولا استبدال للمحركات. APIs/issue reports مرجع لسلوك الاختبار وليست تنفيذًا منسوخًا.
**Tech Stack:** Python stdlib ZIP/DEX inspection; ES modules/Node tests; separate GitHub Actions.
**Spec:** docs/repository-compat/DESIGN.md.

## Global Constraints

- لا تغييرات في التورنت والمشغل والترجمة ولا source engine قائم ولا بيانات المستخدم.
- لا main merge أو نشر. لا تنفيذ plugin خارجي أو زيارات تلقائية لمصادر تحذر من الحظر.
- لا ادعاء اجتياز CAPTCHA أو CloudStream execution من تحليل metadata.

## Review Focus

- Zip traversal/duplicates/bombs/corruption fail closed.
- Missing entry point or ABI does not become a healthy source.
- One provider's 429 stops the same host's other jobs without blocking other hosts.
- Sessions never share cached private responses or verification state accidentally.
- Actual published package analysis distinguished from authored test fixtures.

## Task 1 — Research ledger

- [x] تثبيت SHAs وقراءة البلاغات والردود لكل حالة مختارة؛ تصنيف البلاغ مقابل العطل المثبت.
- [x] توثيق الأثر واختبار VANTARA المقابل دون نسخ logs أو PII أو تنفيذ upstream.

## Task 2 — Package Gate

Files: tools/repository-compat/package_gate.py; test_package_gate.py.
- [x] اختبارات RED للأرشيف وحدود DEX ونقطة الدخول والتلف والبصمة.
- [x] تنفيذ مستقل بالمكتبة القياسية؛ لا استخراج/تحميل كود.
- [x] تحليل AnimeWitcher/Anime4Up/AnimeRift الفعلية المثبتة البصمة وتوثيق متطلبات ABI.

## Task 3 — Host policy core

Files: extensions/runtime-core/network-policy.mjs; network-policy.test.mjs.
- [x] RED: host budget, Retry-After, challenge classification, session scoping and no automatic retries.
- [x] تنفيذ ومعاينة النتائج؛ لا تغيير في transports أو player موجود.

## Task 4 — CI / preservation / delivery

Files: .github/workflows/repository-compat.yml; docs/repository-compat/RESEARCH.md, STATUS.md.
- [x] حارس scope وCI مستقل؛ اختبارات الوحدات والحزم الحقيقية بلا تنفيذ وبلا مصادر حية.
- [ ] انتظار نتائج CI ثم توثيقها في طلب المراجعة؛ لا دمج أو نشر.
