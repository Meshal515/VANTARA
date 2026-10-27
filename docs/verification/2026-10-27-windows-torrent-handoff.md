# نقطة التوقف — Windows Torrent — 27 أكتوبر 2026

حُفظت هذه النقطة بطلب المالك للانتقال إلى مهمة أخرى. **توقف التنفيذ هنا؛ لا
تُدمج أو تنشر Stable تلقائيًا عند قراءة هذا الملف.** عند استئناف التورنت، أكمل
من الأدلة التالية ولا تعد تنفيذ الإصلاحات الموجودة.

## المستودع والفرع

- المستودع: `Meshal515/VANTARA`.
- الفرع الوحيد للعمل: `chatgpt/windows-torrent-ci-and-rebuffer-20261026`.
- [PR296](https://github.com/Meshal515/VANTARA/pull/296)، ما زال Draft؛ قاعدته
  `fix/windows-update-release-parity-20261026`، وليست main.
- آخر كود مرفوع ومختبر: **`bf9d0b1e01f50809fb51575e0ab49a3ef373f1c6`**.
- الالتزام السابق `fc5535c6` أضاف مقارنة مسارات الرسم؛ `5e38ffa9` تقرير الجولة
  القديمة. لا تتعامل مع استنتاج ذلك التقرير عن ضرورة GPU على أنه القرار الحالي.
- worktree المستخدم: `/workspace/VANTARA-windows-torrent-ci-20261027`.

## ما اكتشفناه الآن — تصحيح مهم لاستنتاج البيئة السابق

**لا يلزم شراء GPU أو طلب جهاز المالك لمواصلة هذا التحقيق.** MPV الافتراضي كان
يرسم على Microsoft WARP عبر GPU renderer بإعدادات مكلفة على CPU. نجاح الملف
المحلي ليس مستحيلًا على runner الحالي: تغيير تكلفة الرسم حل الفشل في تجربة
مقارنة فعلية، مع إبقاء شروط clock/frame-loss/stall نفسها.

[تجربة الرسم الأولى 40474133102](https://github.com/Meshal515/VANTARA/actions/runs/40474133102)
قارنت ستة مسارات على نفس ملف كل صيغة: 1080p H264، 1080p HEVC، 4K HEVC8،
4K HEVC10/PQ. الافتراضي فشل، و`profile=fast` الرسمي نجح بلا فقد إطارات في
العينات الأربع لعشر ثوان. لم تكن زيادة مهلة أو حذف assertion.

أمثلة: الافتراضي H264 1080p أسقط 172 إطارًا/نحو 10s (~72%)، مقابل صفر مع
`next-fast`. 4K HEVC الافتراضي تقدم نحو 0.917s في 10.128s، مقابل 10.083s
في 10.086s دون إسقاط مع `next-fast`. التوثيق في مصدر MPV المثبت يؤكد أن
WARP قد يكون بطيئًا مع ميزات GPU الممتدة، وأن fast يخفف كلفة scaling/dither/peak.

في التطبيق لم نخفض جودة جميع GPUs: أُضيفت سياسة Lua تشترك بتحذيرات MPV،
وتطبق fast مرة واحدة فقط عند تحذير `Using a software adapter` من
`vo/gpu-next/d3d11` أو `vo/gpu/d3d11`. فك الفيديو بالمعالج وحده ليس سببًا
لتطبيق السياسة. تبقى hwdec=auto-safe وإعدادات buffering القائمة كما هي.

الملفات:

- `apps/desktop/src/mpv-render-policy.mjs`: نص السياسة الذي ينفذه MPV.
- `apps/desktop/src/services.mjs`: إنشاء script محلي لكل جلسة Windows، تمريره
  إلى MPV، تسجيل حدث محدود، وحذفه عند التنظيف.
- `tools/build-windows.mjs`: التحقق من وجود module السياسة في الحزمة.
- `tools/mpv-render-policy-check.mjs`: يشغل عقد السياسة في Lua الخاص بـMPV
  الحقيقي؛ يتأكد أن GPU الفعلي/التحذير غير المتعلق لا يغيران الجودة، وأن التفعيل
  مرة واحدة، وأن فشل apply لا يُعلن نجاحًا. هذا اختبار سياسة، لا دليل فيديو.
- `tools/windows-render-paths.mjs` وworkflow الخاص به: مقارنة فعلية تشمل الآن
  `conditional-fast` بالسياسة نفسها، لا خيار fast مفروضًا من الاختبار.
- baseline المحلي داخل benchmark يتبع سياسة التطبيق؛ احتُفظ بالافتراضي غير
  المحسّن باسم `unoptimized` كمرجع تشخيصي. لم يُخفض شرط قبول البث.

[اختبار السياسة والرسم الثاني 40475122101](https://github.com/Meshal515/VANTARA/actions/runs/40475122101)
**نجح على الصيغ الأربع**؛ يتضمن اختبار Lua الإلزامي وقياس المسارات.

## عيب ثانٍ مثبت: التطبيق لم يكن يفعّل uTP

`engineArgs()` في التطبيق كان يشغّل rqbit 9.0.1 بلا
`--experimental-enable-utp-listen`. المصدر المثبت يثبت أن هذا الخيار مطلوب
للاستماع **والاتصال** عبر uTP. اختبارات البروتوكول القديمة كانت تضيفه من
adapter، لذلك نجاحها لم يكن دليلًا على قدرة الإعداد الإنتاجي على الاتصال بـUDP-only.

أُعيد الإنتاج على سرب مملوك بوصلة UDP-only ومنفذ TCP مغلق: قبل الإصلاح فشل
التطبيق عند metadata برفض المحرك؛ بعد تفعيل الخيار في args التطبيق نجحت ست
حالات cold/warm مع تطابق البايتات، دون فرض الخيار من adapter. الوسيط المحلي
لأول Range متحقق: cold نحو 298ms وwarm نحو 263ms؛ **ليست أزمنة إطار**.
لا يثبت هذا أنه سبب كل بطء في سرب عام.

- TCP بقي مفعّلًا؛ تتسابق الاتصالات داخل rqbit نفسه؛ لا تغيير للمحرك الافتراضي.
- أضيف mode `production` الافتراضي في benchmark يحفظ args التطبيق حرفيًا.
- TCP-only السلبي صريح ويزيل خيار uTP من args الاختبار فقط.
- لا تتكرر clap flags إذا كانت موجودة في الإنتاج؛ اختبار يمنع ذلك.
- Windows engine/protocol gates تستخدم `production` للحالة الإيجابية rqbit uTP.
- فشل اختبار args المتوقع قبل التنفيذ ونجح بعده، وكذلك الاختبار الشبكي الحقيقي.

## نتيجة أحدث دورة شاملة — لا تخلطها بالتشغيل القديم

[40475121988](https://github.com/Meshal515/VANTARA/actions/runs/40475121988)
على `bf9d0b1e` اكتمل؛ **النتيجة الإجمالية failure** بسبب job واحد:

| المسار | الحالة |
|---|---|
| Torrent Engine Validation | success |
| الحاويات الأربع client/seeder | success لكل الأربعة |
| MPV protocol | success |
| 1080p HEVC | success |
| 4K HEVC8 | success |
| 4K HEVC10/PQ | success |
| 1080p H264 | فشل في اختبارات Python التمهيدية، قبل قياس العرض |
| البوابة المطلوبة الشاملة | failure تبعًا لذلك؛ بقيت إلزامية |

**ليس فشل H264 الحالي دليل سقوط إطارات:** job `122091540632` فشل قبل تنزيل
MPV/FFmpeg، في `server_test.py` الأصلي، مع 9 أخطاء timeout. منها
`test_ipc_auth_origin_file_selection_and_range_validation` و
`test_list_only_reuses_metadata_handle_and_warm_metadata_needs_no_peer` و
`test_partial_unverified_blocks_are_excluded_from_checked_byte_diagnostics` و
`test_storage_reserve_stops_new_piece_requests_before_disk_exhaustion`.
بقية jobs اجتازت المجموعة نفسها. لم يُحل سبب التوقيت بعد؛ **لا ترفع timeout
ولا تحذف الاختبار ولا تعتبر H264 ناجحًا**. ابدأ بسجل هذا job كاملًا، وحدد هل
سبب مشترك في جاهزية seeder/host أو خطأ حقيقي، ثم أعد الإنتاج والإصلاح المبرر.

Artifacts H264: تقرير `12720791205` وحزمة `12720416784` صغيران، ولا يحتويان
قياسات H264 مكتملة. نزّل أيضًا تقارير jobs HEVC/4K لفحص الأرقام والآثار، بدل
الاكتفاء باستنتاج النجاح من عناوين jobs. لا توجد دعوى سرعة تورنت الفيلم العام.

## تحقق محلي وCI عام بعد bf9d0b1e

- `corepack pnpm test` نجح؛ web **1748/1748، 197 ملفًا**؛ Desktop **156 ناجحة،
  5 متخطاة تخص اختبارات البيئة/Windows/Linux**، لا فشل. اختبار policy cleanup
  المخصص لـWindows يعمل ضمن Windows CI؛ لا يُحسب محليًا على Linux.
- أدوات benchmark/validation/fixtures/evidence/bundle: **19/19**.
- فحوص السلامة: **54/54**.
- عقد السياسة داخل MPV Lua الحقيقي محليًا نجح.
- actionlint وgit diff --check نجحا.
- VANTARA CI: [40475128187](https://github.com/Meshal515/VANTARA/actions/runs/40475128187)
  و[40475122431](https://github.com/Meshal515/VANTARA/actions/runs/40475122431) نجحا.
- [Windows StageArt/Playback 40475128447](https://github.com/Meshal515/VANTARA/actions/runs/40475128447)
  نجح، و[Android Debug 40475122109](https://github.com/Meshal515/VANTARA/actions/runs/40475122109)
  نجح؛ لا APK Stable ولا إصدار Windows نُشر.

## نقاط الاستئناف العملية

1. لا تتوقف عند طلب GPU: عيب كلفة WARP صار له إصلاح فعلي؛ افحص conditional policy
   وأرقام HEVC/4K الناجحة من أحدث artifacts، ثم عالج أخطاء Python التسعة في H264.
2. تابع بوابة Windows المطلوبة حتى تنجح كاملة؛ لا تُخفف assertions أو تزيد المهل.
3. إصلاحا prewarm replay وIP filter في الجولة السابقة موجودان بالفعل، ولا يُعادان.
4. main.cjs ما زال يختار rqbit وMPV؛ libtorrent بديل تجريبي للاختبارات فقط.
5. إعادة خدمات التطبيق ومحركاتها بعمليات OS مستقلة مثبتة. إعادة تشغيل المثبت
   الكامل داخل واجهة Electron وجلسة طويلة/سرب عام لم تُعتمد بعد؛ لا تدّعِ ذلك.
6. تبقى البيانات والحسابات والإضافات ومصادر المانجا/الأنمي خارج نطاق هذا العمل.
7. طلب المالك الجديد هو حفظ هذه النقطة والانتقال لمهمة أخرى؛ لا تواصل تغيير
   التورنت أثناء المهمة الأخرى ما لم يطلب ذلك.

## أدلة محلية إذا بقيت مساحة العمل

تحت `/workspace/VANTARA-artifacts/windows-torrent-20261027/`:
`render-paths/` (تقارير وصور التجربة الأولى)، `utp-production-before/` و
`utp-production-after/` و`windows-final-reports/` (الجولة السابقة).

السجلات: `/workspace/windows-utp-render-full-suite.log`،
`/workspace/windows-render-utp-tools.log`، `/workspace/windows-render-utp-safety.log`،
`/workspace/windows-utp-production-before.log` و`windows-utp-production-after.log`.

GitHub connector ينزّل artifacts الصغيرة؛ استخدم `download_url` من
`github_download_workflow_artifact` خلال صلاحيته. تنزيل blob المباشر قد يكون
محجوبًا، والموصل يحد الحزمة بـ512MiB؛ لا تدّعِ قراءة ما لم يُنزّل.
