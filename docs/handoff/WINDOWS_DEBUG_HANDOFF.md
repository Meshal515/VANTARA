# تسليم: VANTARA Windows Debug — 13 نوفمبر 2026

> مرجع المهمة: برومت المالك «VANTARA_Windows_Debug_Master_Prompt» + قرار libtorrent + «قانون تصميم الكمبيوتر» في [CLAUDE.md](../../CLAUDE.md).
> هذا تسليم حالة عمل، لا إعلان جاهزية. **لم يُنشر أي Windows Debug بعد، ولم يُختبر شيء على ويندوز حقيقي إلا جزئيًا في CI (فشل البناء الأصلي).**

## الفرع والأساس

| البند | القيمة |
| --- | --- |
| فرع العمل | `ccr-81586a69-ez4f3g` |
| الأساس | `feat/addons-v7-native-manager-20261027` (فرع V7، مصدر APK Debug وWeb Debug؛ إصدار `debug-channel` يقول «تصدر من فرع V7 فقط») عند `53cbbcdd` |
| ليس الأساس | `main` (تصميم أقدم). عمل مبكر بُني خطأً على main محفوظ محليًا فقط في `backup/main-based-8b9c8b9` |
| main | لم يُلمس. لا دمج ولا PR |

## ما أُنجز (بالترتيب، كل commit على الفرع)

### 1) قناة Windows Debug + إصلاح جذري للتحديث — `13219bdc`
- **السبب الجذري المثبت** لتشغيل واجهة أقدم بعد «التحديث»: Stable (0.0.N من stable-N) كان يقرأ بيان `windows-channel` القديم (0.3.18)، و0.3.18 أكبر رقميًا من 0.0.215 مع أنه كود 20 أكتوبر، فيثبّت نسخة أقدم. تحقق بقراءة البيانين المنشورين فعلًا.
- `apps/desktop/channel.cjs`: هوية القناة من `channel.json` (يُختم وقت البناء). Debug: الاسم «VANTARA Debug»، `appId` و`userData` ومجلد التثبيت ومفتاح السجل والاختصارات مستقلة عن Stable، وأيقونة بيضاء (`assets/vantara-debug.ico/png` من الشعار الرسمي نفسه؛ `tools/build-windows-debug-icon.py`).
- البيانات: Debug ← `windows-debug-channel/desktop-debug.json` (format 3، `build` صاعد)؛ Stable ← `releases/latest/download/vantara-update.json` (حقل desktop) ولا يقبل بيان القناة القديمة.
- منع الرجوع في الواجهة **وفي العملية الرئيسية** (`updater.acceptableUpdate`): لا تحديث مساوٍ/أقدم في الإصدار أو رقم البناء، والمثبّت مقيد بقناته واسم ملفه ووسمه.
- البحث يدوي فقط من الإعدادات («البحث عن تحديثات»)، التنزيل بموافقة («تنزيل وتثبيت»)، ثم «أعد التشغيل وحدّث» أو عند الإغلاق. لا إشعار تلقائي.
- `windows.nsi` و`tools/build-windows.mjs` يقبلان `--channel=debug --build=N --version=0.4.N`.
- اختبارات: `apps/desktop/{channel,preload,updater}.test.cjs`، `apps/web/desktop/update-check.test.js`.

### 2) محرك libtorrent لويندوز مع رجوع تلقائي إلى rqbit — `1573b22b`
- APK يستخدم `jlibtorrent 2.0.12.9` (JNI لأندرويد، لا يُنقل). على ويندوز: `tools/torrent-host/vantara-torrent.cpp` = libtorrent-rasterbar أصلي بإعدادات APK حرفيًا (`TorrentEngine.streamingSettings`: TCP فقط بلا uTP، مهل 4/8 ث، طابور 250، `request_queue_time 1`، مواعيد القطع `TorrentPolicy.deadlines`، الطرفان، hotswap، فلتر الشبكات الخاصة، DHT محفوظ، `--parent-pid`).
- واجهة HTTP محلية متوافقة مع ما يستخدمه `apps/desktop/src/services.mjs` من rqbit، فالمشغل والوكيل والنافذة المتحركة وStremio بلا تغيير. لا يرسل إلا بايتات قطع متحقق منها (`read_piece`).
- `services.mjs`: `engineOrder` = libtorrent ثم rqbit. فشل البدء/غياب الملف ← rqbit فورًا (`engine-fallback`)؛ انهيار بعد الجاهزية ← حجب libtorrent 10 دقائق. `VANTARA_TORRENT_ENGINE=rqbit` يفرض rqbit.
- إصلاحات أثبتتها الاختبارات: انتظار مقابس الاستماع قبل الجاهزية؛ accept غير حاجب (كان المحرك لا يخرج مع موت الأب)؛ ملف `.parts` سبّب «End of file» وأوقف التورنت؛ إبقاء الاهتمام بعد `list_only` (أول بايت بعد قفز 11ms بدل 475ms على loopback).
- اختبارات (Linux، libtorrent 2.0.10): `tools/torrent-host/host.test.mjs` (3/3: بايتات مطابقة، ترتيب القطع عبر `/haves` لا الزمن: 2/95 قبل موضع القفز، خروج مع الأب)، و`services.test.mjs` (66/66 بينها 3 رجوع تلقائي + تشغيل حقيقي عبر وكيل services بالبايت).
- أداة قياس: `tools/torrent-host/loopback-bench.mjs`، A/B على أسراب حقيقية قانونية (Blender CC-BY): `swarm-ab.mjs` (لم يُشغَّل بعد).

### 3) CI Windows Debug — `8865ec9f` (+ `444995cf` بصمة PWA)
- `.github/workflows/windows-debug.yml`: Linux (اختبارات + المحرك)، Windows (vcpkg `libtorrent:x64-windows-static` + اختبارات المحرك على ويندوز + video host + exe بالهوية البيضاء)، fixtures مؤلفة 1080p/1440p/2160p (ffmpeg testsrc2)، تغليف، تحقق تثبيت/ترقية/إقلاع/mpv مدمج/**تشغيل تورنت عبر libtorrent داخل التطبيق المثبت** (`apps/desktop/torrent-smoke.cjs`)، A/B، ثم نشر `windows-debug-N` وتقدم البيان (يرفض بناء غير أحدث).
- البناء = رقم تشغيل السير؛ الإصدار `0.4.N`.
- **الحالة: التشغيل #2 فشل** في «Native Windows binaries»: vcpkg ثبّت **libtorrent 2.1** (`libtorrent::v2_1`) والكود كُتب واختبر على 2.0.10. أخطاء MSVC في `vantara-torrent.cpp` حول السطور 859–888 (وضع `--seed` للاختبار): `lt::from_span` غير موجود، `settings_pack::set_int(alert_mask, …)` يحتاج نوع flags، توقيع `create_torrent` تغير. التشغيل #1 أُلغي يدويًا (كان على أساس main). **لم يُنشر شيء.**

### 4) تصميم الكمبيوتر — `890d7c0a` → `f2d85ba1` (كلها `[skip ci]`)
طبقة مستقلة لا تمس الجوال/APK: `@media (min-width:1024px) and (hover:hover) and (pointer:fine)`.
- `apps/web/v35/desktop-work.css` (صفحات العمل):
  - **الأنمي 5 أنماط** (اعتمدها المالك): لا لف أفقي (8→0 صفوف)، البنر بأسلوب منصات البث: بعرض الصفحة بلا ضباب ولا أشرطة، تركيز أعلى الصورة، سقف `max(380px, 100svh − 260px)`؛ «شاشة السينما» إطارها بنسبة الصورة (100%). قياس 1366/1920/2560 والشريط مفتوح/مقفل: الإطار 100%، الظاهر 79–92%، زر التشغيل في الشاشة الأولى. **حلقات «البطاقة الطائرة» صارت شبكة** (الحالية مرفوعة بإطار اللون).
  - **المانجا**: «كلاسيكي» = تراجع مثبت (V7 أسقط `side-dock.js` وقواعد `wide.css`)؛ أُعيد العمود الملتصق (الغلاف كاملًا + اقرأ + الأزرار + التقدم) بجانب الاسم والفصول عبر `sideDock` في `shell.js` (للنمط وحده، شاشة الفأرة وحدها). «ويبتوني» نسخة كمبيوتر: الفن كاملًا في عمود ملتصق (291×412 على 1366، 340×482 على 1920)، أزرار 460px، العمق كما هو. المعرض/الملف/من حيث وقفت بلا صفوف أفقية.
  - **السينما 5 أنماط**: البطولة و«قد يعجبك» شبكات (8→0)؛ البنر بأسلوب البث (86% على 1366، 92% على 1920)؛ «الشريط العريض» 16:9 كاملًا 100% (cinema.css يفرض 2.39:1 على ≥700 خلاف قرار #323)؛ الجسم 1180px بدل 760px والقصة 760px والبطولة/الطاقم بعرض الصفحة؛ «العرض الأول» تركيب كمبيوتر (ملصق + شعار + بطاقة تشغيل فوق الخلفية)؛ زر التشغيل في الشاشة الأولى في الخمسة.
- `CLAUDE.md`: «قانون تصميم الكمبيوتر» (4 بنود المالك) — `eeb8d7bd`.

### 5) غير مكتمل في آخر commit (WIP، لم يُتحقق منه)
- `apps/web/v35/desktop-browse.css` (الرئيسيات: شبكات بدل الشرائط، صفّان + «الكل»، Top 10 بخمسة×2، الأنواع، قوائم IMDb/الرائج) نُقلت من تجربة main مع قاعدة `ah-lineup` الجديدة في V7، ومربوطة في `index.html` و`sw.js`. **لم تُقس على V7 بعد** (انقطع القياس).

## نتائج الزاحف الشامل (قبل طبقة الرئيسيات)
`tools/desktop-audit/crawl.cjs`: 226 صفحة/تبويب لكل إعداد (1366 مفتوح، 1920 مقفل) — كل بند في الشريط الجانبي وكل تبويب فيه، الأقسام الثلاثة. **لا أخطاء JS**. لا تمرير أفقي ولا فيض ولا فراغات في المكتبة/اكتشف/الأصدقاء/المجلس/الإشعارات/التوصيات/المفضلة/لاحقًا/آخر المشاهدات/الإحصائيات/الإضافات/الإعدادات. المتبقي:
- رئيسية الأنمي: `ah-lineup` و`an-strip` أفقية؛ بطل الرئيسية `ah-art-img` 81% على 1920.
- رئيسية السينما: `cn-strip` و`cn-chart-grid` أفقية؛ بنر `cn-bill-img` 69–75%.
- المانجا: بلا بيانات بلا حساب (sync وfetch يردان 401) ← استخدم fixture (`make-manga-fixture.sh`).

## ما لم يُنجز / لم يُتحقق
1. **إصلاح بناء ويندوز (libtorrent 2.1)** ثم تشغيل السير كاملًا ونشر أول Windows Debug.
2. الرئيسيات الثلاث (التحقق من `desktop-browse.css` على V7 + بنر الأنمي والسينما بأسلوب البث) + التبديل بين الرئيسيات (CLS والوميض) + الشريط الجانبي مفتوح/مقفل + 2560/4K + Fullscreen.
3. النمط الموحد (`unifiedLook`) وقسم «المحتوى الموحد» (`experience.js`) على الكمبيوتر.
4. المشغل (أولوية المالك الثانية): بنر/شعار التحميل، قوائم Desktop صغيرة بدل الأدراج، الاختصارات، المشاهدة الجماعية — **لم يُبدأ**.
5. قياس libtorrent مقابل rqbit على أسراب حقيقية وعلى ويندوز حقيقي، وCPU/RAM — **لم يُقس**.
6. اختبار التحديث الداخلي فعليًا (يحتاج بناءين منشورين متتاليين).

## الاختبارات والأوامر
```bash
pnpm install --frozen-lockfile && pnpm --filter @vantara/domain build
node --test tools/repository-safety.test.mjs          # 55/55 (يطبع SHELL_DIGEST المطلوب إن تغيرت ملفات القشرة)
pnpm test:web                                          # 261 ملف / 2644 (على V7)
# المحرك على لينكس:
sudo apt-get install -y libtorrent-rasterbar-dev libboost-dev
cmake -S tools/torrent-host -B /tmp/th -G Ninja && cmake --build /tmp/th
VANTARA_TORRENT_HOST_BINARY=/tmp/th/vantara-torrent node --test --test-concurrency=1 tools/torrent-host/host.test.mjs apps/desktop/*.test.cjs apps/desktop/src/*.test.mjs
# القياس البصري (خادم ثابت + Playwright):
(cd apps/web && python3 -m http.server 8765 --bind 127.0.0.1 &)
cd tools/desktop-audit && mkdir -p shots && ./make-manga-fixture.sh
node audit-work.cjs 1366 768 tag anime          # أنماط صفحة العمل: صفوف أفقية + صور
node banner.cjs anime screen 1920 1080 tag      # البنر: الظاهر من الصورة وزر التشغيل (RAIL=1 للشريط المقفل)
node cnplay.cjs 1366 768                        # أنماط السينما
node manga-probe.cjs webtoon 1366 768 tag       # أنماط المانجا بالـfixture
RAIL=1 node crawl.cjs 1920 1080 tag             # كل الصفحات والتبويبات (طويل: شغّله بالخلفية)
```
**مهم:** كل تعديل على `apps/web/app.js` أو `v35/*.js|css` أو `index.html` يغيّر `SHELL_DIGEST` في `apps/web/sw.js` — شغّل اختبار الأمان وانسخ القيمة، وإلا يفشل `ci.yml`.

## قرارات المالك الثابتة
- لا دمج في main، لا حذف Stable، لا إعادة بناء محرك الإضافات، لا تعديل APK دون ضرورة مشتركة مثبتة.
- قانون الكمبيوتر الأربعة بنود؛ الأغلفة كاملة؛ البنر احترافي بلا ضباب؛ أنماط الأنمي مرجع الجودة.
- العربية فقط في التواصل؛ مختصر؛ لا أسئلة في التصميم — نفّذ بأفضل حكم.
