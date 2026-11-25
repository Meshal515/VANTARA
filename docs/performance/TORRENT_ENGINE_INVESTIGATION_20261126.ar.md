# تحقيق محرك التورنت — 25–26 نوفمبر 2026

> كل حكم هنا مربوط بسطر كود أو قياس قابل للإعادة. ما لم يُقس مكتوب أنه لم يُقس. القياسات المحلية
> (stall-bench على loopback) تعزل سلوك libtorrent نفسه؛ **ليست** قياس جهاز حقيقي ولا سرب عام.

## الخلاصة في سطور

1. **أغلب بطء بدء التشغيل في أندرويد سببه سلوك داخل libtorrent كنا نعالجه من الخارج.** وجدت خمسة أسباب
   جذرية في كود libtorrent 2.0.12 نفسه (نفس النسخة في jlibtorrent 2.0.12.9)، ثلاثة منها تُصلح بالإعدادات
   والسياسة بلا بناء مكتبة مخصصة، واثنان يحتاجان تعديل المكتبة.
2. **تحوّط Nuvio (urgent-hedge) كما هو لا يفيد فانتارا.** صُمم لمشغل يأخذ كتلًا غير موثقة من موضع القراءة
   (أول 4 كتل)، وفانتارا يسلّم قطعًا موثقة كاملة تنتظر **آخر** كتلة أينما كانت. قيس: نسخته لم تحسّن القطعة
   الأولى. كتبنا نسخة تناسب التسليم الموثّق (0002).
3. **ويندوز: libtorrent في تقارير بناء Debug 74 نفسه سقفه 6–13MB/s وزمن read_piece حتى 17.5 ث، بينما rqbit
   78–97MB/s على السرب نفسه.** على مشغّل CI. قرص المشغّل عامل مربك، وسرعتك 75–80MB/s على جهازك لم يُعرف بعد
   أي محرك حققها. هذا يحتاج لوحة تشخيص تعرض اسم المحرك (مطلوب على جهازك).

## الأسباب الجذرية المثبتة

| المعرّف | السبب | الدليل | المنصة | الحالة |
|---|---|---|---|---|
| RC-T1 | مسح كل المواعيد ثم إعادتها عند كل تقدّم قطعة يفرغ قائمة القطع الحرجة، فيطلق libtorrent `cancel_non_critical` ويلغي كل طلبات ما قدّام النافذة عند كل المشاركين | `torrent.cpp` 2.0.12: `set_piece_deadline` (إذا كانت القائمة فارغة يُنشر `cancel_non_critical`) و`cancel_non_critical` (يلغي dq وrq غير الحرجة)؛ `TorrentEngine.kt` كان `legacyWindow=true` في الإنتاج | أندرويد | **أُصلح**: المواعيد بالفرق (`TorrentPolicy.deadlineDiff`) متغير واحد معزول؛ التسلسلي والقراءة المسبقة بلا تغيير |
| RC-T2 | أول 4 قطع تُختار **عشوائيًا متجاهلة الأولوية** ما لم يكن التنزيل تسلسليًا | `peer_connection::picker_options`: `num_have < initial_picker_threshold` ⇒ لا rarest_first ولا ترتيب. stall-bench: القطعة 12 (أولوية 4) ثم 9 قبل القطعة 0 (أولوية 7) | أندرويد (ويندوز تسلسلي) | **أُصلح**: `initial_picker_threshold=0` في أندرويد وويندوز |
| RC-T3 | `set_piece_deadline` يرفع **كل** قطعة بموعد إلى الأولوية 7، فأولوية `SIX` في `TorrentEngine` تُمحى، وتنقسم السرعة على 12 قطعة عند البدء | `torrent.cpp`: `m_picker->set_piece_priority(piece, top_priority)` داخل `set_piece_deadline` | الاثنتان | قيد القياس (المصفوفة الثالثة) |
| RC-T4 | عند البدء يُفترض معدل المشارك **50 بايت/ث**، فطلب معلق واحد يجعل طابوره «327 ثانية»، ودالة الطلبات الحرجة تتوقف عند «طابور أطول من 2 ث» | `peer_connection::download_queue_time` (`if (rate < 50) rate = 50`) و`pick_time_critical_block` (`download_queue_time() > 2000ms ⇒ break`) | الاثنتان | مثبت بالكود والتتبع؛ يحتاج تعديل مكتبة (مرشح 0003) |
| RC-T5 | libtorrent الأصلي لا يعيد طلب كتلة عالقة **أبدًا** ما دام `m_average_piece_time = 0` (لم تكتمل قطعة حرجة بعد، أي عند البدء بالضبط)، وبعدها تكبر المهلة مع حجم القطعة | `request_time_critical_pieces`: `if (m_average_piece_time > 0) timed_out = …` | الاثنتان | تعديل 0001 (قابل للتبديل، الافتراضي معطل) |
| RC-T6 | تحوّط Nuvio يفحص أول 4 كتل من موضع القراءة فقط | `libtorrent-2.0.12-nuvio-urgent-hedge.patch` (`nuvio_hedge_window = 4`) | — | تعديل 0002 بتصميم يناسب التسليم الموثّق |
| RC-T7 | ويندوز: مسار القرص في libtorrent عنق الزجاجة على مشغّل CI | `verification-reports.tgz` لبناء 74: `reads.max_ms` 8759–17479، سرعة 6–8MB/s، أول 4MB بعد 21–76 ث أو لا يصل؛ rqbit 1–6 ث | ويندوز | مثبت على CI فقط؛ يلزم التحقق على جهازك |

## تحقق من تقرير المالك (ما صح وما لم يصح)

| الادعاء | الحكم |
|---|---|
| الثلاثة على libtorrent | صحيح لأندرويد (jlibtorrent 2.0.12.9 = libtorrent 2.0.12، `cb6fe6b9c`). ويندوز من vcpkg بنسخة غير مثبتة في التقرير؛ ملاحظات القياس السابقة تذكر `pread_disk_io` الموجود في 2.1 لا 2.0، فالمنصتان **قد** تعملان بنسختين مختلفتين. التحقق: `BUILD-MANIFEST.json` |
| جدول الإعدادات (400/200/100/15/15/4/1/250، uTP وLSD معطلان) | صحيح في `TorrentEngine.streamingSettings` و`vantara-torrent.cpp`. tick غير مضبوط ⇒ 500ms الافتراضي في الاثنين |
| انحباس رأس الطابور الموثق (511/512 لمدة 6.8 ث) | صحيح، وأُعيد إنتاجه محليًا (RC-T4 وRC-T5 يفسرانه من الكود) |
| Hotswap يحجب المشارك كله 60 ث | صحيح (`TorrentHotswap`, `BAN_MS`) |
| تعديلات Nuvio الـ15 ووصف urgent-hedge وstreaming-stall | صحيح حرفيًا. **لكن** نقل urgent-hedge كما هو لا يفيد التسليم الموثّق (RC-T6، مقيس) |
| ويندوز read_piece 6–12 ث | صحيح، وأسوأ في تقارير بناء 74: حتى 17.5 ث |
| DIRECT/READAHEAD معطلان افتراضيًا | صحيح |
| كاش الذاكرة 32MiB، التسخين 90 ث و24 اتصالًا | صحيح (`MAX_MEMORY_BYTES`, `PREFETCH_HOLD_MS`, `PREFETCH_CONNECTIONS`) |
| «ويندوز 75–80MB/s» | لا يُعرف أي محرك حققها. على CI لم يتجاوز libtorrent 13MB/s وrqbit تجاوز 78 |

## أداة القياس

`tools/libtorrent-patches/stall-bench.cpp`: سرب على loopback، باذر سريع (4MB/s) وباذر بطيء (48KB/s) يتصل
أولًا، ملف 128MB بقطع 8MB، ومنزّل يتصرف كقارئ فانتارا (نافذة 12 قطعة بمواعيد، وما قدّامها بأولوية 4، يتقدم
قطعة قطعة). الحد النظري للقطعة الأولى ≈ 2 ث (8MB ÷ 4MB/s).

```bash
# بناء libtorrent 2.0.12 مع التعديلين (الافتراضي = سلوك libtorrent الأصلي حرفيًا)
git clone --branch v2.0.12 --recurse-submodules https://github.com/arvidn/libtorrent
cd libtorrent && patch -p1 < 0001-vantara-stall-cap.patch && patch -p1 < 0002-vantara-urgent-hedge.patch
cmake -B build -G Ninja -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF -Ddeprecated-functions=OFF && ninja -C build install
# المتغيرات: BENCH_IPT, BENCH_CRIT, BENCH_TICK_MS, BENCH_SEQ, BENCH_NO_SLOW, BENCH_TRACE,
#            VANTARA_LT_STALL_CAP_MS, VANTARA_LT_HEDGE_MS
VANTARA_LT_STALL_CAP_MS=1000 ./stall-bench diff
```

## الطريق إلى libtorrent مخصص على المنصتين (لم يُنفذ بعد)

- **أندرويد:** مستودع jlibtorrent (وسم `release/2.0.12.9`) يحفظ غلاف JNI المولّد `swig/libtorrent_jni.cpp`،
  فيمكن إعادة بناء `libjlibtorrent.so` بعد تطبيق تعديلاتنا على libtorrent **دون SWIG ودون تغيير سطر Kotlin**.
  بيئة البناء جاهزة (`swig/Dockerfile`، NDK r26d، Boost 1.88، OpenSSL 3.6). العمل: سير CI يبني arm64-v8a
  وx86_64 ويستبدل ملفي `.so` في Debug فقط، مع رجوع للمكتبة الأصلية بمفتاح بناء.
- **ويندوز:** منفذ vcpkg مخصص (overlay) مثبت على v2.0.12 مع التعديلات، فتتوحد النسخة مع أندرويد.
- **الترخيص:** تعديلاتنا مكتوبة منا (لا نسخ من Nuvio، GPL-3.0). libtorrent BSD-3-Clause.
