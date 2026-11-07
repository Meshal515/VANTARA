# دليل Agent Skills المفيدة للتصميم والبرمجة والتشخيص — 7 نوفمبر 2026

**النطاق:** بحث موجّه في GitHub ومصادر المشاريع الأصلية. هذا فهرس منتقى للمهارات المرتبطة بجودة المنتجات وتطوير VANTARA تحديدًا؛ ليس حصرًا لجميع مهارات الإنترنت.

**القراءة:** A = أولوية عالية، B = انتقائية حسب المهمة، C = لا تفعّلها إلا عند الحاجة. توصيف `impeccable: ...` هو أمر فرعي داخل مهارة رئيسية، و`chrome-devtools-mcp` أداة MCP وليست ملف Skill. أوصاف بعض مهارات Android مأخوذة من العناوين الرسمية وليست بالضرورة أسماء التثبيت الدقيقة.

## أفضل توليفة مبدئية لفانتارا

**الواجهات:** Impeccable + frontend-design + better-interface + better-layout + animation-performance + web-design-guidelines.

**التشخيص:** systematic-debugging أو diagnosing-bugs (اختر أحدهما كقائد) + verification-before-completion + Playwright CLI + Chrome DevTools.

**أندرويد/التشغيل:** android/skills + streaming-media-architecture + media3-analytics-telemetry + media3-datasources-networking + media3-test-utils-robolectric.

**الأمان والنشر:** differential-review + supply-chain-risk-auditor + workers-development / web-perf إذا استُخدم Cloudflare.

## ضوابط مهمّة

- لا تثبت كل الحزم دفعة واحدة؛ تضارب التعليمات قد يضر الجودة ولو كان سياق النموذج واسعًا.
- ثبّت مهارات المشروع محليًا داخل `.claude/skills` أو `.agents/skills` بحسب الوكيل، لا عالميًا إلا عند الحاجة.
- راجع كل `SKILL.md` والسكريبتات وhooks والأذونات قبل التثبيت، ولا تنفّذ `curl | bash` من مصدر غير مدقق.
- مهارة لا تعني تحققًا فعليًا: الاختبارات والسجلات وأول إطار وفحوص الشبكة والتوافق هي معيار التسليم.
- استخدم إصدارات المكتبات الموافقة للمشروع؛ لا تفرض تحديث Media3 أو Gradle اعتمادًا على كتيب مهارة أحدث.
- لا تخلط الإصلاحات مع إعادة تصميم عامة؛ فرع مستقل وتغيير محدود واختبار انحدار لكل عطل.

## أوامر تثبيت نموذجية (Claude Code / أنظمة تدعم skills.sh)

```bash
npx skills add anthropics/skills --skill frontend-design
npx skills add vercel-labs/agent-skills --skill web-design-guidelines
npx skills add vercel-labs/agent-skills --skill vercel-react-best-practices
npx skills add vercel-labs/agent-skills --skill vercel-react-view-transitions
npx skills add mattpocock/skills --skill diagnosing-bugs
npx skills add jakubkrehel/skills --skill better-interface
npx skills add emilkowalski/skills
npx skills add cloudflare/skills
```

**Claude Code — الحزم ذات آلية مختلفة:**

```text
/plugin install superpowers@claude-plugins-official
/plugin marketplace add android/skills
/plugin install android-skills@android-skills
```

**ملاحظة:** أداة Playwright CLI تحتاج تثبيت حزمة `@playwright/cli` ثم `playwright-cli install --skills`. حزمة Android Media3 لها سكربت تثبيت خاص بها راجعه من المستودع الأصلي؛ لا تقم بتشغيل سكربت مجهول الصلاحيات بلا تدقيق.

## سيناريوهات تدقيق مخصّصة لفانتارا

1. **الأنمي والإضافات:** قارن الإضافة نفسها داخل CloudStream/أو Aniyomi الأصلي وداخل فانتارا، على الشبكة نفسها والنسخة نفسها. احفظ مسار الاستخراج وHTTP والتحقق ورابط التشغيل؛ لا تفسّر فشلًا دون إعادة إنتاج.
2. **التصميم:** افتح شاشة العمل، وصوّر انتقال الغلاف من البطاقة إلى موضعه النهائي. افحص flicker وإعادة الرسم وتبديل الدقة في منتصف الانتقال؛ طبّق إصلاحًا على النطاق المعطوب فقط.
3. **الأداء:** قِس time-to-first-frame وrebuffer وعدد dropped frames ومدة الوصول لأول بايت. اختبر 1080p و4K بشكل منفصل ولا تقارن على شبكات مختلفة.
4. **سلامة البيانات:** أثبت قبل وبعد التحديث أن المستودعات والمفضلات وحالة المشاهدة محلية وموجودة، ولا تَمسح بيانات التطبيق لأجل إصلاح سطحي.
5. **متعددة المنصات:** نفّذ اختبارات منفصلة في Android وWindows وPWA؛ مهارات الويب لا تثبت نجاح بناء Android الأصلي ولا العكس.

## فهرس المهارات المنقّح

### التصميم وUX

| المهارة/الأمر | الاستخدام | الأولوية | المصدر |
|---|---|:---:|---|
| `frontend-design` | إنشاء واجهات ذات هوية بصرية مقصودة بدل التصميم النمطي | A | [anthropics/skills](https://github.com/anthropics/skills) |
| `web-design-guidelines` | تدقيق واجهات الويب والإتاحة والـ UX والأداء | A | [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills) |
| `ui-ux-pro-max` | البحث عن أنماط التصميم والخطوط والألوان والتخطيطات | A | [nextlevelbuilder/ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) |
| `impeccable: critique` | نقد تصميم قائم مع مشاكل UX مرتبة | A | [pbakaus/impeccable](https://github.com/pbakaus/impeccable) |
| `impeccable: audit` | تدقيق واجهة تقني يشمل الإتاحة والملاءمة | A | [pbakaus/impeccable](https://github.com/pbakaus/impeccable) |
| `impeccable: polish` | جولة صقل قبل التسليم | A | [pbakaus/impeccable](https://github.com/pbakaus/impeccable) |
| `impeccable: layout` | تحسين الأحجام والهرمية والتباعد | A | [pbakaus/impeccable](https://github.com/pbakaus/impeccable) |
| `impeccable: animate` | تحسين انتقالات وحركات الواجهة | A | [pbakaus/impeccable](https://github.com/pbakaus/impeccable) |
| `impeccable: adapt` | معالجة أحجام الشاشات المختلفة | A | [pbakaus/impeccable](https://github.com/pbakaus/impeccable) |
| `impeccable: harden` | معالجة حالات الخطأ والترجمة والتجاوز | A | [pbakaus/impeccable](https://github.com/pbakaus/impeccable) |
| `impeccable: optimize` | تحسين عرض وتحميل الواجهة | A | [pbakaus/impeccable](https://github.com/pbakaus/impeccable) |
| `impeccable: document` | توثيق نظام التصميم في DESIGN.md | B | [pbakaus/impeccable](https://github.com/pbakaus/impeccable) |
| `impeccable: live` | التعديل المرئي في متصفح فعلي | B | [pbakaus/impeccable](https://github.com/pbakaus/impeccable) |
| `better-interface` | مراجعة شاملة للواجهة بترتيب إصلاحات | A | [jakubkrehel/skills](https://github.com/jakubkrehel/skills) |
| `better-ui` | تحسين الأسطح والأيقونات والظلال وردود الفعل | A | [jakubkrehel/skills](https://github.com/jakubkrehel/skills) |
| `better-layout` | تجميع العناصر والمحاذاة ودعم RTL | A | [jakubkrehel/skills](https://github.com/jakubkrehel/skills) |
| `better-typography` | الخطوط والتفاف النص والتدرج البصري | A | [jakubkrehel/skills](https://github.com/jakubkrehel/skills) |
| `better-colors` | لوحات الألوان والتباين والتوكنات | A | [jakubkrehel/skills](https://github.com/jakubkrehel/skills) |
| `better-accessibility` | الإتاحة ولوحة المفاتيح والتحكم بالحركة | B | [jakubkrehel/skills](https://github.com/jakubkrehel/skills) |
| `better-writing` | النصوص والأخطاء والحالات الفارغة | B | [jakubkrehel/skills](https://github.com/jakubkrehel/skills) |
| `interface-review` | مراجعة تغيرات التصميم في Pull Request | B | [jakubkrehel/skills](https://github.com/jakubkrehel/skills) |
| `break` | اختبار مكون في ظروف وحالات متعددة | A | [jakubkrehel/skills](https://github.com/jakubkrehel/skills) |
| `state-machine` | عرض جميع حالات مكون بصريًا | A | [jakubkrehel/skills](https://github.com/jakubkrehel/skills) |
| `variant` | إنشاء بدائل واجهة قابلة للمقارنة | B | [jakubkrehel/skills](https://github.com/jakubkrehel/skills) |
| `build-design` | تحويل تصميم Figma أو صورة إلى واجهة | B | [jakubkrehel/skills](https://github.com/jakubkrehel/skills) |
| `explain-interface` | تفكيك بناء واجهة أو حركة موجودة | B | [jakubkrehel/skills](https://github.com/jakubkrehel/skills) |

### الحركة والانتقالات

| المهارة/الأمر | الاستخدام | الأولوية | المصدر |
|---|---|:---:|---|
| `emil-design-eng` | قواعد تصميم هندسي وخاصة الحركة | A | [emilkowalski/skills](https://github.com/emilkowalski/skills) |
| `animate` | بناء الحركة بالتوقيت والمنحنيات الصحيحة | A | [emilkowalski/skills](https://github.com/emilkowalski/skills) |
| `review-animations` | مراجعة تنفيذ الحركات واكتشاف الضعف | A | [emilkowalski/skills](https://github.com/emilkowalski/skills) |
| `improve-animations` | تدقيق حركات المشروع ووضع خطة إصلاح | A | [emilkowalski/skills](https://github.com/emilkowalski/skills) |
| `find-animation-opportunities` | تحديد مواضع الحركة المفيدة فقط | B | [emilkowalski/skills](https://github.com/emilkowalski/skills) |
| `remove-animations` | حذف الانتقالات المرهقة أو غير الضرورية | A | [emilkowalski/skills](https://github.com/emilkowalski/skills) |
| `choreograph` | تنسيق تسلسل حركة عدة عناصر | A | [emilkowalski/skills](https://github.com/emilkowalski/skills) |
| `animation-performance` | تشخيص الحركات التي تسقط الإطارات | A | [emilkowalski/skills](https://github.com/emilkowalski/skills) |
| `animation-vocabulary` | تسمية تأثير الحركة بدقة | B | [emilkowalski/skills](https://github.com/emilkowalski/skills) |
| `mobile-native` | تحسين الإحساس الأصلي لتجربة الويب على الهاتف | A | [emilkowalski/skills](https://github.com/emilkowalski/skills) |
| `prototype` | استعراض نماذج حركة/واجهة متعددة | B | [emilkowalski/skills](https://github.com/emilkowalski/skills) |
| `vercel-react-view-transitions` | انتقالات React وshared elements بين الشاشات | A | [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills) |

### هندسة البرمجيات

| المهارة/الأمر | الاستخدام | الأولوية | المصدر |
|---|---|:---:|---|
| `vercel-react-best-practices` | تحسين React وتأخير الشبكة وإعادة العرض وحجم الحزمة | A | [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills) |
| `vercel-composition-patterns` | تصميم تركيب المكونات وتجنب props معقدة | B | [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills) |
| `vercel-react-native-skills` | تحسين React Native فقط إذا استُخدم في المشروع | C | [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills) |
| `systematic-debugging` | تحقيق السبب الجذري قبل أي إصلاح | A | [obra/superpowers](https://github.com/obra/superpowers) |
| `verification-before-completion` | إثبات التنفيذ وعدم الاكتفاء بتقرير الوكيل | A | [obra/superpowers](https://github.com/obra/superpowers) |
| `test-driven-development` | اختبار يفشل ثم إصلاح ثم ينجح | A | [obra/superpowers](https://github.com/obra/superpowers) |
| `brainstorming` | تحديد متطلبات المهمة قبل التنفيذ | B | [obra/superpowers](https://github.com/obra/superpowers) |
| `writing-plans` | تخطيط خطوات التطوير والاعتمادات | A | [obra/superpowers](https://github.com/obra/superpowers) |
| `executing-plans` | تنفيذ بخطوات ونقاط مراجعة | A | [obra/superpowers](https://github.com/obra/superpowers) |
| `dispatching-parallel-agents` | تقسيم العمل على وكلاء متوازيين | B | [obra/superpowers](https://github.com/obra/superpowers) |
| `requesting-code-review` | طلب مراجعة شاملة للكود | A | [obra/superpowers](https://github.com/obra/superpowers) |
| `receiving-code-review` | التعامل الصحيح مع ملاحظات المراجعة | B | [obra/superpowers](https://github.com/obra/superpowers) |
| `using-git-worktrees` | تجارب مستقلة دون خلط تغييرات الفروع | A | [obra/superpowers](https://github.com/obra/superpowers) |
| `subagent-driven-development` | تنفيذ ثم مراجعة المواصفات والجودة | B | [obra/superpowers](https://github.com/obra/superpowers) |
| `finishing-a-development-branch` | إنهاء فرع عمل مع التحقق من الاختبارات | B | [obra/superpowers](https://github.com/obra/superpowers) |
| `diagnosing-bugs` | إنتاج إعادة توليد فاشلة حاسمة ثم تشخيص | A | [mattpocock/skills](https://github.com/mattpocock/skills) |
| `improve-codebase-architecture` | اكتشاف الوحدات المتشابكة واقتراح حدود اختبار | A | [mattpocock/skills](https://github.com/mattpocock/skills) |
| `codebase-design` | تحسين تصميم الوحدة وواجهات اتصالها | A | [mattpocock/skills](https://github.com/mattpocock/skills) |
| `domain-modeling` | توحيد مصطلحات وكيانات مجال التطبيق | B | [mattpocock/skills](https://github.com/mattpocock/skills) |
| `tdd` | بناء السلوك اعتمادًا على الاختبارات | A | [mattpocock/skills](https://github.com/mattpocock/skills) |
| `prototype` | نموذج مؤقت لحسم قرار تقني أو بصري | A | [mattpocock/skills](https://github.com/mattpocock/skills) |
| `triage` | فرز تقارير الأعطال قبل التشخيص العميق | B | [mattpocock/skills](https://github.com/mattpocock/skills) |
| `research` | بحث تقني بمراجع أولية داخل المستودع | B | [mattpocock/skills](https://github.com/mattpocock/skills) |
| `code-review` | مراجعة منهجية للكود وفق أساليب Sentry | B | [getsentry/skills](https://github.com/getsentry/skills) |
| `code-simplifier` | تبسيط الكود دون تغيير السلوك | B | [getsentry/skills](https://github.com/getsentry/skills) |
| `agents-md` | صياغة تعليمات المشروع AGENTS.md / CLAUDE.md | A | [getsentry/skills](https://github.com/getsentry/skills) |

### أندرويد وكوتلن

| المهارة/الأمر | الاستخدام | الأولوية | المصدر |
|---|---|:---:|---|
| `jetpack-compose-performance` | تحسين Compose وتقليل recompositions وjank | A | [android/skills](https://github.com/android/skills) |
| `android-profiler` | تحليل traces والذاكرة واختناقات التشغيل | A | [android/skills](https://github.com/android/skills) |
| `testing-setup` | وضع استراتيجية اختبار أندرويد | A | [android/skills](https://github.com/android/skills) |
| `r8-analyzer` | فحص إعدادات R8 والتحسينات | B | [android/skills](https://github.com/android/skills) |
| `ANR audit (official Android skill)` | تحليل تجمد واجهة أندرويد وتقارير ANR | A | [android/skills](https://github.com/android/skills) |
| `adaptive UI (official Android skill)` | تكييف الشاشات حسب حجم الجهاز | B | [android/skills](https://github.com/android/skills) |
| `edge-to-edge (official Android skill)` | تصحيح النظام والحدود ومناطق الأمان | B | [android/skills](https://github.com/android/skills) |
| `Intent security (official Android skill)` | مراجعة أمان Intent والمكونات المصدرة | B | [android/skills](https://github.com/android/skills) |
| `kotlin-tooling-agp9-migration` | مساعدة متخصصة في ترقية أدوات بناء أندرويد | C | [Kotlin/kotlin-agent-skills](https://github.com/Kotlin/kotlin-agent-skills) |
| `Compose performance pack` | مرجع إضافي لتتبع recomposition والذاكرة والقوائم | A | [skydoves/compose-performance-skills](https://github.com/skydoves/compose-performance-skills) |
| `Compose UI testing pack` | اختبارات UI وتفاعل وعرض ووصول | A | [skydoves/android-testing-skills](https://github.com/skydoves/android-testing-skills) |
| `ADB testing pack` | التحكم في الأجهزة والتسجيل وتشغيل السيناريوهات | A | [skydoves/android-testing-skills](https://github.com/skydoves/android-testing-skills) |
| `JVM/Coroutines testing pack` | اختبار Flow وCoroutine وواجهات الوحدات | A | [skydoves/android-testing-skills](https://github.com/skydoves/android-testing-skills) |
| `Instrumentation testing pack` | اختبارات تشغيل حقيقية على الأجهزة | A | [skydoves/android-testing-skills](https://github.com/skydoves/android-testing-skills) |

### Media3 وتشغيل الفيديو

| المهارة/الأمر | الاستخدام | الأولوية | المصدر |
|---|---|:---:|---|
| `streaming-media-architecture` | ملكية المشغل والسياسات والتحميل المسبق | A | [sunnat629/android-media-pack](https://github.com/sunnat629/android-media-pack) |
| `migrate-exoplayer-to-media3` | ترحيل ExoPlayer القديم | C | [sunnat629/android-media-pack](https://github.com/sunnat629/android-media-pack) |
| `migrate-xml-ui-to-compose` | ترحيل واجهات المشغل إلى Compose | C | [sunnat629/android-media-pack](https://github.com/sunnat629/android-media-pack) |
| `media3-background-playback-service` | تشغيل الخلفية والتحكم عبر MediaSession | B | [sunnat629/android-media-pack](https://github.com/sunnat629/android-media-pack) |
| `media3-lifecycle-state` | دورة حياة المشغل واستعادة الحالة | A | [sunnat629/android-media-pack](https://github.com/sunnat629/android-media-pack) |
| `media3-compose-ui-material3` | واجهة تحكم مشغل Compose | B | [sunnat629/android-media-pack](https://github.com/sunnat629/android-media-pack) |
| `media3-adaptive-compose-ui` | توافق المشغل مع أحجام الشاشات | B | [sunnat629/android-media-pack](https://github.com/sunnat629/android-media-pack) |
| `media3-view-ui-player` | PlayerView والتكامل مع XML/Compose | B | [sunnat629/android-media-pack](https://github.com/sunnat629/android-media-pack) |
| `media3-tv-leanback-ui` | دعم التلفزيون وD-pad | C | [sunnat629/android-media-pack](https://github.com/sunnat629/android-media-pack) |
| `media3-android-auto-media-surface` | دعم Android Auto | C | [sunnat629/android-media-pack](https://github.com/sunnat629/android-media-pack) |
| `media3-xr-media-surface` | دعم Android XR | C | [sunnat629/android-media-pack](https://github.com/sunnat629/android-media-pack) |
| `media3-video-playback` | أول إطار ونسبة العرض وHDR وPiP | A | [sunnat629/android-media-pack](https://github.com/sunnat629/android-media-pack) |
| `media3-audio-playback` | تركيز الصوت والجلسة والتعامل مع السماعات | B | [sunnat629/android-media-pack](https://github.com/sunnat629/android-media-pack) |
| `media3-vod-playback` | الاستئناف وقوائم التشغيل والفصول | A | [sunnat629/android-media-pack](https://github.com/sunnat629/android-media-pack) |
| `media3-rtsp-playback` | مصادر RTSP | C | [sunnat629/android-media-pack](https://github.com/sunnat629/android-media-pack) |
| `media3-smoothstreaming-playback` | بث SmoothStreaming | C | [sunnat629/android-media-pack](https://github.com/sunnat629/android-media-pack) |
| `media3-midi-playback` | صيغ MIDI | C | [sunnat629/android-media-pack](https://github.com/sunnat629/android-media-pack) |
| `media3-hls-dash-adaptive-streaming` | HLS/DASH والترجمة والتخزين المؤقت | A | [sunnat629/android-media-pack](https://github.com/sunnat629/android-media-pack) |
| `media3-live-streaming` | البث المباشر والانقطاع وإعادة الاتصال | B | [sunnat629/android-media-pack](https://github.com/sunnat629/android-media-pack) |
| `media3-live-only-streaming` | البث المباشر بلا تقديم أو رجوع | C | [sunnat629/android-media-pack](https://github.com/sunnat629/android-media-pack) |
| `media3-datasources-networking` | الشبكة والرؤوس والـ cache وDataSource | A | [sunnat629/android-media-pack](https://github.com/sunnat629/android-media-pack) |
| `media3-bandwidth-abr` | سرعة الشبكة والتكيّف وسياسات buffer | A | [sunnat629/android-media-pack](https://github.com/sunnat629/android-media-pack) |
| `media3-cast-integration` | تسليم البث إلى Cast | C | [sunnat629/android-media-pack](https://github.com/sunnat629/android-media-pack) |
| `media3-workmanager-offline-ops` | مهام التنزيل المحلية وإعادات المحاولة | B | [sunnat629/android-media-pack](https://github.com/sunnat629/android-media-pack) |
| `media3-drm-widevine-setup` | إعداد DRM عندما يكون مطلوبًا | C | [sunnat629/android-media-pack](https://github.com/sunnat629/android-media-pack) |
| `media3-ads-ima` | إعلانات IMA | C | [sunnat629/android-media-pack](https://github.com/sunnat629/android-media-pack) |
| `media3-analytics-telemetry` | قياس TTFF وrebuffer والأخطاء | A | [sunnat629/android-media-pack](https://github.com/sunnat629/android-media-pack) |
| `media3-inspector-metadata-thumbnails` | فحص الوسائط واستخراج الصور المصغرة | B | [sunnat629/android-media-pack](https://github.com/sunnat629/android-media-pack) |
| `media3-transformer-editing` | تحويل وقص ملفات الفيديو | C | [sunnat629/android-media-pack](https://github.com/sunnat629/android-media-pack) |
| `media3-video-effects-lottie-muxer` | المؤثرات وتغليف الفيديو | C | [sunnat629/android-media-pack](https://github.com/sunnat629/android-media-pack) |
| `media3-test-utils-robolectric` | اختبار واجهة Media3 بحالات وهمية | A | [sunnat629/android-media-pack](https://github.com/sunnat629/android-media-pack) |

### اختبارات المتصفح

| المهارة/الأمر | الاستخدام | الأولوية | المصدر |
|---|---|:---:|---|
| `playwright-cli` | اختبارات فعلية للمتصفح وتسجيل التتبع والفيديو | A | [microsoft/playwright-cli](https://github.com/microsoft/playwright-cli) |
| `agent-browser` | توجيه متصفح وكيل بقراءة الحالة ولقطات الإثبات | A | [vercel-labs/agent-browser](https://github.com/vercel-labs/agent-browser) |
| `chrome-devtools-mcp [MCP/CLI]` | تحليل network/console/performance في Chrome | A | [ChromeDevTools/chrome-devtools-mcp](https://github.com/ChromeDevTools/chrome-devtools-mcp) |
| `qa` | اختبار السيناريوهات وإصلاح المشكلات المتحققة | A | [garrytan/gstack](https://github.com/garrytan/gstack) |
| `qa-only` | اختبار شامل دون تغيير كود المنتج | A | [garrytan/gstack](https://github.com/garrytan/gstack) |
| `investigate` | تشخيص مبني على الأدلة | A | [garrytan/gstack](https://github.com/garrytan/gstack) |
| `design-review` | تدقيق واجهة بالصور قبل وبعد | A | [garrytan/gstack](https://github.com/garrytan/gstack) |
| `review` | مراجعة شاملة لفرع العمل | A | [garrytan/gstack](https://github.com/garrytan/gstack) |
| `test-audit` | مراجعة جودة ومردود الاختبارات | B | [garrytan/gstack](https://github.com/garrytan/gstack) |
| `plan-eng-review` | مراجعة خطة الهندسة قبل البناء | B | [garrytan/gstack](https://github.com/garrytan/gstack) |
| `ship` | بوابة تحقق وتوثيق قبل الدمج | B | [garrytan/gstack](https://github.com/garrytan/gstack) |
| `cso` | تدقيق أمان بحسب نموذج التطبيق | B | [garrytan/gstack](https://github.com/garrytan/gstack) |

### أمان وسلامة التبعيات

| المهارة/الأمر | الاستخدام | الأولوية | المصدر |
|---|---|:---:|---|
| `static-analysis` | تحليل الشيفرة بأدوات CodeQL وSemgrep | A | [trailofbits/skills](https://github.com/trailofbits/skills) |
| `differential-review` | تدقيق أمني للتغيرات بمقارنة Git | A | [trailofbits/skills](https://github.com/trailofbits/skills) |
| `fp-check` | التحقق من بلاغات الثغرات الكاذبة | A | [trailofbits/skills](https://github.com/trailofbits/skills) |
| `insecure-defaults` | فحص الإعدادات الافتراضية الخطرة | A | [trailofbits/skills](https://github.com/trailofbits/skills) |
| `sharp-edges` | اكتشاف واجهات برمجية قابلة لسوء الاستخدام | B | [trailofbits/skills](https://github.com/trailofbits/skills) |
| `supply-chain-risk-auditor` | تدقيق مخاطر تبعيات الطرف الثالث | A | [trailofbits/skills](https://github.com/trailofbits/skills) |
| `testing-handbook-skills` | أساليب fuzzing وcoverage والتحليل | B | [trailofbits/skills](https://github.com/trailofbits/skills) |
| `agentic-actions-auditor` | تدقيق أمان GitHub Actions الخاصة بالوكلاء | A | [trailofbits/skills](https://github.com/trailofbits/skills) |

### الرصد والأخطاء

| المهارة/الأمر | الاستخدام | الأولوية | المصدر |
|---|---|:---:|---|
| `sentry-instrument` | إعداد تسجيل الأعطال والأداء والتتبعات | B | [getsentry/sentry-for-ai](https://github.com/getsentry/sentry-for-ai) |
| `sentry-debug-issue` | تحليل بلاغات التشغيل من Sentry | B | [getsentry/sentry-for-ai](https://github.com/getsentry/sentry-for-ai) |
| `sentry-create-alert` | تنبيه للأعطال الحرجة | C | [getsentry/sentry-for-ai](https://github.com/getsentry/sentry-for-ai) |

### الخدمات والنشر

| المهارة/الأمر | الاستخدام | الأولوية | المصدر |
|---|---|:---:|---|
| `cloudflare` | اختيار خدمة Cloudflare المطلوبة | B | [cloudflare/skills](https://github.com/cloudflare/skills) |
| `frameworks-on-cloudflare` | نشر أطر الويب والتكامل الصحيح | B | [cloudflare/skills](https://github.com/cloudflare/skills) |
| `workers-best-practices` | فحص جودة Workers | B | [cloudflare/skills](https://github.com/cloudflare/skills) |
| `workers-development` | تشخيص Workers والسجلات محليًا | B | [cloudflare/skills](https://github.com/cloudflare/skills) |
| `workers-profiling` | فحص CPU والذاكرة في Workers | B | [cloudflare/skills](https://github.com/cloudflare/skills) |
| `web-perf` | قياس أداء الموقع وCore Web Vitals | A | [cloudflare/skills](https://github.com/cloudflare/skills) |
| `wrangler` | إدارة نشر Workers ومواردها | B | [cloudflare/skills](https://github.com/cloudflare/skills) |
| `cloudflare-app-bootstrap` | تشغيل المشروع وتهيئة البيانات والأسرار | B | [cloudflare/skills](https://github.com/cloudflare/skills) |
| `durable-objects` | المزامنة والحالة المشتركة عبر WebSockets | B | [cloudflare/skills](https://github.com/cloudflare/skills) |
| `turnstile-spin` | تحديات التحقق من الزيارات والروبوتات | C | [cloudflare/skills](https://github.com/cloudflare/skills) |

## أهم المصادر والمراجع المباشرة

Google Android: https://developer.android.com/tools/agents/android-skills/browse

Google Android repository: https://github.com/android/skills

Microsoft Playwright skill docs: https://github.com/microsoft/playwright.dev/blob/main/agent-cli/skills.mdx

مهارات التثبيت العامة والبحث: https://skills.sh/

الترجمة/الفيديو: https://github.com/sunnat629/android-media-pack

سياسة الأمان: تحقق من أذونات الأداة، السكربتات المنفذة، مصدر النشر، وتحديثات المستودع قبل السماح بالوصول إلى المفاتيح أو المستودعات الخاصة.
