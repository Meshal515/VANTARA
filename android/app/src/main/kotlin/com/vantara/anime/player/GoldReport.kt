package com.vantara.anime.player

import com.vantara.addons.torrent.ReadWait
import java.util.Locale

/**
 * DeepTrace «تقرير الذهب» لأندرويد: المراحل والأسباب وقاعدة الثقة نفسها التي في `apps/web/lib/deeptrace.js` (ويندوز).
 * يبني المسار الحرج من الضغط بساعة واحدة (elapsedRealtime)، وينزل في أطول مرحلة إلى سببها بالأرقام، ويقول أين يُتخذ
 * القرار في الكود (ملف ودالة حقيقيان، بلا أرقام أسطر)، وبأي ثقة، وما الدليل الناقص. ما لا دليل عليه «غير معروف».
 * دالة نقية: تُختبر بلا جهاز، ولا تقرأ عنوانًا ولا هوية.
 */
object GoldReport {
    class Read(val at: Long, val openedAt: Long, val firstByteAt: Long, val position: Long, val bytes: Long, val endAt: Long = 0L)
    class Torrent(
        val addedAt: Long = 0L, val metadataCached: Boolean = false, val firstKnownAt: Long = 0L, val firstPeerAt: Long = 0L,
        val metadataAt: Long = 0L, val firstPayloadAt: Long = 0L, val firstPieceAt: Long = 0L,
        val warmedAt: Long = 0L, val warmedPieces: Int = 0, val fileBytes: Long = 0L, val pieceBytes: Int = 0,
        val waits: List<ReadWait> = emptyList(), val waitingPiece: Int = -1, val waitingSince: Long = 0L, val waitingBlocks: Pair<Int, Int>? = null,
        val peers: Int = 0, val downloadBps: Long = 0L, val turbo: Boolean = false, val earlyBytes: Long = 0L, val earlyFailures: Int = 0,
        val hintsSent: Int = 0, val hintsFailed: Int = 0, val mkvSkipped: Long = 0L, val patched: Boolean = false, val criticalPieces: Int = 0,
        /** أول رؤية لإشارة جاهزية التسخين (0 = لم تُرَ)، والقطع التي استهدفها. [warmedAt] لحظة **الجدولة** لا الجاهزية. */
        val warmReadyAt: Long = 0L, val warmTargets: List<Int> = emptyList(),
        /** حدود MKV كما مرّت بالقارئ: بداية أول Cluster وموضع Cues من SeekHead (-1 = غير معروف). */
        val clusterAt: Long = -1L, val cuesAt: Long = -1L,
    )
    /**
     * [tapAt] ضغطة المستخدم الحقيقية في الورقة (0 = لم تُقس). [pickedAt] رجوع `pick`، و[uiOpenAt] نداء `play` من الواجهة،
     * و[intentAt] نية فتح المشغّل في `play` الأصلية. [container] نوع الحاوية من Media3 (video/mp4، video/x-matroska…).
     */
    class Input(
        val tapAt: Long, val openAt: Long, val preparationMs: Long? = null, val reads: List<Read> = emptyList(),
        val tracksAt: Long = 0L, val readyAt: Long = 0L, val frameAt: Long = 0L, val audioOnlyAt: Long = 0L,
        val decoder: String? = null, val decoderInitAt: Long = 0L, val decoderInitMs: Long = 0L,
        val torrent: Torrent? = null, val build: String = "—", val now: Long = 0L, val readsFull: Boolean = false,
        val intentAt: Long = 0L, val pickedAt: Long = 0L, val uiOpenAt: Long = 0L, val container: String? = null,
    )
    /**
     * [ar] الحقيقة المقاسة (أين ذهب الوقت)، و[confidence] ثقتها. [hypothesis] لماذا، حين لا يثبته دليل: يُطبع «محتمل،
     * غير مثبت» ولا يرفع الحكم. [where] مكان القرار في الكود: «مرجّح» إن كان السبب غير مثبت.
     */
    class Cause(val code: String, val ar: String, val where: String?, val share: Double, val coverage: Double, val confidence: String, val needs: String? = null, val hypothesis: String? = null)
    class Phase(val id: String, val ar: String, val start: Long, val end: Long, val beforeTap: Boolean = false, val ongoing: Boolean = false) {
        val ms: Long get() = end - start
        val evidence = mutableListOf<String>()
        var cause: Cause? = null
    }
    class Analysis(val phases: List<Phase>, val bottleneck: Phase?, val secondary: List<Phase>, val integrity: List<String>, val verdict: String, val total: Long, val origin: Long)

    private class Kind(val code: String, val ar: String, val where: String?, val hypothesis: String? = null)

    // سبب انتظار القطعة من لقطته الأولى ([ReadWait]): ما يعرفه المحرك مكتوبًا وما يقوله libtorrent
    // «لم تبدأ» و«لم تصل» حقيقة اللقطة الأولى وحدها. هل طُلبت الكتلة ومتى ومن أي مشارك، وهل وصلت ولم تُكتب، لا يُسجَّل:
    // السبب تفسير محتمل لا يُعلن مؤكدًا (عينات المالك: «مؤكد · تغطية 100%» بلا هذه المعلومات)
    private val NOT_STARTED = Kind("WAIT_PIECE_NOT_STARTED", "انتظار قطعة لم تُكتب منها أي كتلة عند أول عيّنة",
        "TorrentEngine.kt: State.prioritize (setPieceDeadline) ← libtorrent: request_time_critical_pieces",
        "لم تُطلب بعد، أو طُلبت ولم يرد المشارك، أو لا مشارك متصل يملكها")
    private val PARTIAL = Kind("WAIT_BLOCK_RESPONSE", "انتظار كتلة القراءة في قطعة بدأ تنزيلها",
        "libtorrent: piece_picker (ترتيب الكتل، 0004) ← NativeReadHint.kt",
        "الكتلة طُلبت متأخرة في ترتيب القطعة، أو المشارك المرسل بطيء، أو وصلت ولم تُكتب بعد")
    private val COMPLETE = Kind("WAIT_PIECE_VERIFICATION", "القطعة كلها على القرص وتنتظر التحقق والقراءة",
        "libtorrent: hash_piece ثم read_piece ← TorrentEngine.kt: State.piece")
    private val VERIFIED_ONLY = Kind("WAIT_VERIFIED_ONLY", "كتلة الموضع مكتوبة والقراءة انتظرت القطعة الموثقة",
        "TorrentEngine.kt: State.piece (TurboRead.writtenSpan)")
    private val GAP = Kind("VANTARA_BLOCK_TRACKING_GAP", "كتل على القرص لا يعرفها المحرك (فاتته إشعارات block_finished)",
        "TorrentEngine.kt: State (written ← block_finished_alert)")
    private val WAITS_KINDS = listOf(NOT_STARTED, PARTIAL, COMPLETE, VERIFIED_ONLY, GAP)

    // ما كان المشغّل ينتظره من قراءات (المدة مقاسة؛ سبب بطئها من انتظارات القطع داخلها). نوع البيانات لا يُعلن إلا بدليل:
    // رأس MKV حتى أول Cluster، وCues من SeekHead. MP4 من CloudStream ليس Matroska ولا تورنت (عينة المالك)
    private fun extractor(container: String?) = when {
        container == null -> "Media3 (المستخرج حسب الحاوية)"
        container.contains("matroska") || container.contains("webm") -> "Media3 MatroskaExtractor"
        container.contains("mp4") -> "Media3 Mp4Extractor"
        container.contains("mpegurl") || container.contains("hls") -> "Media3 HlsMediaSource"
        container.contains("mp2t") -> "Media3 TsExtractor"
        else -> "Media3 ($container)"
    }
    private fun transport(torrent: Boolean) = if (torrent) "TorrentDataSource.kt: read ← TorrentEngine.kt: State.prioritize" else "Media3 DefaultHttpDataSource ← خادم المصدر (شبكة)"
    private fun readKind(code: String, input: Input): Kind {
        val tor = input.torrent != null
        val ex = extractor(input.container)
        return when (code) {
            "WAIT_HEADER_READ" -> Kind(code, "قراءة رأس MKV قبل أول Cluster (Tracks والمرفقات)", "$ex ← ${transport(tor)}")
            "WAIT_INDEX_READ" -> Kind(code, "قراءة فهرس Cues (موضعه من SeekHead)", "$ex (يطلب Cues قبل موضع المتابعة) ← ${transport(tor)}")
            "WAIT_START_READ" -> Kind(code, "قراءة متصلة من بداية الملف", "$ex ← ${transport(tor)}",
                "رأس الحاوية (moov أو Tracks) أو بيانات الفيديو بعده: حدود الرأس غير مقاسة لهذا الملف")
            "WAIT_TAIL_READ" -> Kind(code, "قراءة من ذيل الملف", "$ex ← ${transport(tor)}",
                if (input.container?.contains("mp4") == true) "فهرس moov في آخر الملف" else "فهرس الحاوية (Cues) أو وسوم آخر الملف: موضع الفهرس غير مقاس")
            else -> Kind("WAIT_POSITION_FIRST_BYTE", "انتظار أول بايت عند موضع التشغيل",
                if (tor) "TorrentDataSource.kt: read ← TorrentEngine.kt: State.prioritize (setPieceDeadline)" else "Media3 DefaultHttpDataSource ← خادم المصدر (شبكة)")
        }
    }

    /** طول اتحاد فترات (تتداخل القراءات المتزامنة فلا تُعد مرتين). */
    private fun union(ranges: List<LongRange>): Long {
        var total = 0L; var end = Long.MIN_VALUE
        for (r in ranges.filter { it.last > it.first }.sortedBy { it.first }) {
            if (r.last <= end) continue
            total += r.last - maxOf(r.first, end); end = r.last
        }
        return total
    }

    private fun kindOf(w: ReadWait): Kind = when {
        w.untracked -> GAP
        w.engine <= 0 -> NOT_STARTED
        w.engine >= w.blocks -> COMPLETE
        w.atOffset -> VERIFIED_ONLY
        else -> PARTIAL
    }

    private class Segment(val kind: Kind, val from: Long, val to: Long)

    val CONFIDENCE_AR = mapOf("CONFIRMED" to "مؤكد", "STRONGLY_SUPPORTED" to "مدعوم بقوة", "POSSIBLE" to "محتمل", "UNKNOWN" to "غير معروف")

    /** قاعدة الثقة المعلنة (مطابقة لويندوز): تغطية الأدلة للمرحلة وحصة السبب من المقاس. */
    fun confidence(coverage: Double, share: Double): String = when {
        coverage >= 0.7 && share >= 0.7 -> "CONFIRMED"
        coverage >= 0.5 && share >= 0.5 -> "STRONGLY_SUPPORTED"
        coverage > 0 -> "POSSIBLE"
        else -> "UNKNOWN"
    }
    private fun capped(c: String, max: String): String {
        val order = listOf("UNKNOWN", "POSSIBLE", "STRONGLY_SUPPORTED", "CONFIRMED")
        return order[minOf(order.indexOf(c), order.indexOf(max))]
    }

    /** أين في الملف قرأ الطلب: بداية الملف، أو ذيله، أو موضع التشغيل. مكان فقط: ما الذي فيه يقرره [readCode] بدليل. */
    fun placeOf(position: Long, fileBytes: Long): String = when {
        position <= 2L * 1024 * 1024 -> "بداية الملف"
        fileBytes > 0 && (position >= fileBytes * 98 / 100 || (fileBytes - position <= 64L * 1024 * 1024 && position * 100 / fileBytes >= 90)) -> "ذيل الملف"
        else -> "موضع التشغيل"
    }

    /**
     * نوع ما قرأه الطلب ومدة انتظاره: رأس MKV مثبت حين تبدأ القراءة قبل أول Cluster المعروف، وCues مثبت حين يقع موضعه
     * (من SeekHead) داخل القراءة. غير ذلك مكانه فقط («بداية الملف»، «ذيل الملف») وتفسيره محتمل.
     */
    private fun readCode(r: Read, input: Input): String {
        val t = input.torrent
        val cluster = t?.clusterAt ?: -1L
        val cues = t?.cuesAt ?: -1L
        val span = maxOf(r.bytes, 1L)
        if (cues >= 0 && r.position <= cues && cues < r.position + span) return "WAIT_INDEX_READ"
        if (cluster > 0 && r.position < cluster) return "WAIT_HEADER_READ"
        return when (placeOf(r.position, t?.fileBytes ?: 0)) {
            "بداية الملف" -> if (cluster > 0) "WAIT_POSITION_FIRST_BYTE" else "WAIT_START_READ"
            "ذيل الملف" -> "WAIT_TAIL_READ"
            else -> "WAIT_POSITION_FIRST_BYTE"
        }
    }

    /**
     * انتظارات هذا التشغيل وحده: السجل في المحرك لكل تورنت لا لكل جلسة، فما بدأ قبل فتح هذا المصدر من تشغيل سابق
     * للتورنت نفسه (عينة المالك: القطعة 6 نفسها في تقريري «بلا كاش» و«مع كاش»). بلا وقت نهاية (بناء أقدم): لا يُنسب.
     */
    fun sessionWaits(waits: List<ReadWait>, openAt: Long): List<ReadWait> =
        if (openAt <= 0) emptyList() else waits.filter { it.endAt > 0 && it.endAt - it.ms >= openAt - 50 }

    private fun overlap(a0: Long, a1: Long, b0: Long, b1: Long) = (minOf(a1, b1) - maxOf(a0, b0)).coerceAtLeast(0L)

    fun analyze(input: Input): Analysis {
        val integrity = mutableListOf<String>()
        val t = input.torrent
        val open = input.openAt
        if (open <= 0) return Analysis(emptyList(), null, emptyList(), listOf("لم يُفتح مصدر: لا مسار يُبنى"), "UNKNOWN", 0, 0)
        val tapKnown = input.tapAt in 1..open
        val intentKnown = input.intentAt in 1..open
        if (!tapKnown) integrity += if (intentKnown) "زمن الضغطة غير معروف (واجهة أقدم أو «شغّل الأفضل»): المدد من نية فتح المشغّل لا من الضغطة"
            else "زمن الضغط غير معروف: المدد من فتح المصدر لا من الضغط"
        val origin = if (tapKnown) input.tapAt else if (intentKnown) input.intentAt else open
        val firstByte = input.reads.filter { it.firstByteAt > 0 }.minOfOrNull { it.firstByteAt } ?: 0L
        val phases = mutableListOf<Phase>()
        // قبل فتح المصدر: كل علامة مقاسة تفصل مرحلة (الضغطة، رجوع pick، نداء play، نية المشغّل)
        var at = origin
        if (tapKnown) {
            for ((id, ar, mark) in listOf(
                Triple("pick", "انتظار رد pick من المحرك بعد الضغطة", input.pickedAt),
                Triple("ui-open", "تجهيز فتح المشغّل في الواجهة", input.uiOpenAt),
                Triple("bridge", "من نداء play حتى نية فتح المشغّل", input.intentAt),
            )) if (mark in at..open) { phases += Phase(id, ar, at, mark); at = mark }
        }
        phases += Phase("source", if (at == input.intentAt && intentKnown) "فتح المشغّل وتجهيز المصدر (من نية المشغّل)" else "تجهيز المصدر وفتح المشغّل (من الضغط)", at, open)
        var prev = open
        fun add(id: String, ar: String, at: Long, missing: String?) : Boolean {
            if (at <= 0) { missing?.let { integrity += it }; return false }
            val end = maxOf(prev, at)
            phases += Phase(id, ar, prev, end, beforeTap = at < open)
            prev = end
            return true
        }
        if (t != null) add("metadata", "Metadata التورنت", t.metadataAt, "Metadata لم تكتمل بعد")
        val stages = listOf(
            Triple("first-byte", "أول بايت للمشغّل", firstByte),
            Triple("container", "قراءة الحاوية (المسارات معروفة)", input.tracksAt),
            Triple("ready", "التخزين حتى الجاهزية (READY)", input.readyAt),
            Triple("rendered", "حتى أول صورة معروضة", if (input.frameAt > 0) input.frameAt else input.audioOnlyAt),
        )
        // بترتيب وقوعها لا بترتيب ثابت: Media3 يعرض أول إطار قبل READY عادة، فالمسار الحرج إلى الصورة ينتهي بها
        val firstMissing = stages.indexOfFirst { it.third <= 0 }
        for ((id, ar, at) in stages.filterIndexed { i, st -> st.third > 0 && (firstMissing < 0 || i < firstMissing) }.sortedBy { it.third }) add(id, ar, at, null)
        if (firstMissing >= 0) {
            val (id, ar, _) = stages[firstMissing]
            // المرحلة الجارية: من آخر نهاية حتى لحظة التقرير
            if (input.now > prev) phases += Phase(id, ar, prev, input.now, ongoing = true)
            integrity += "البدء لم يكتمل: مرحلة «$ar» جارية منذ ${s(input.now - prev)}"
        }
        if (input.frameAt == 0L && input.audioOnlyAt > 0) integrity += "صوت فقط: لا إطار فيديو منتظر"

        val allWaits = t?.waits.orEmpty()
        if (allWaits.any { it.endAt <= 0 }) integrity += "انتظارات بلا وقت نهاية (بناء أقدم): لا تُنسب إلى مرحلة"
        val waits = sessionWaits(allWaits, open)
        val foreign = allWaits.count { it.endAt > 0 } - waits.size
        if (foreign > 0) integrity += "استُبعد $foreign انتظارًا من تشغيل سابق للتورنت نفسه (سجل المحرك لكل تورنت لا لكل جلسة)"
        if (t == null) integrity += "لا تورنت: القراءة من خادم المصدر عبر HTTP، ولا انتظار قطع"
        for (ph in phases) {
            when (ph.id) {
                "pick", "ui-open", "bridge" -> preOpen(ph)
                "source" -> source(ph, input)
                "metadata" -> metadata(ph, t!!, open)
                else -> engineWaits(ph, input, waits, firstByte, integrity)
            }
        }

        val ranked = phases.filter { it.ms > 0 && it.cause != null }.sortedByDescending { it.ms }
        val bottleneck = ranked.firstOrNull()
        if (t != null) {
            integrity += "انتظارات القطع الأقصر من 0.1 ث لا تُسجَّل، وسبب كل انتظار من لقطته الأولى"
            if (allWaits.size >= 64) integrity += "سجل الانتظارات ممتلئ (آخر 64): سقطت انتظارات أقدم"
            if (waits.any { it.ms > 1_000 }) integrity += "انتظار أطول من ثانية: حالة القطعة فيه من أول عيّنة فقط، وتغيّرها أثناءه غير مقاس"
            if (!t.metadataCached && t.metadataAt > open && t.firstKnownAt == 0L) integrity += "أول مشارك معروف: لم يُقس في هذه الجلسة"
        }
        if (input.readsFull) integrity += "سجل طلبات القراءة ممتلئ: سقطت طلبات قديمة"
        integrity += if (input.frameAt > 0) "أول صورة معروضة: مقاسة (onRenderedFirstFrame)" else "أول صورة معروضة: لم تُعرض بعد"
        val end = phases.maxOfOrNull { it.end } ?: open
        return Analysis(phases, bottleneck, ranked.drop(1).take(2), integrity, bottleneck?.cause?.confidence ?: "UNKNOWN", end - origin, origin)
    }

    /** مراحل ما قبل فتح المصدر: مقاسة مباشرة بين علامتين، ومكانها في الكود معروف. لماذا طالت غير مقاس. */
    private fun preOpen(ph: Phase) {
        if (ph.ms <= 0) return
        ph.cause = when (ph.id) {
            "pick" -> Cause("UI_PICK", ph.ar, "server-sheet.js: pick ← AnimeEnginePlugin.kt: pick (خيط Capacitor واحد لكل الإضافات)", 1.0, 1.0, "CONFIRMED",
                hypothesis = "نداء آخر على خيط Capacitor أمامه، أو خيط الواجهة مشغول")
            "ui-open" -> Cause("UI_OPEN", ph.ar, "cinema.js/anime.js: launch ← anime-engine.js: open (الهوية والترجمات واللون)", 1.0, 1.0, "CONFIRMED")
            else -> Cause("BRIDGE_PLAY", ph.ar, "anime-engine.js: open ← AnimeEnginePlugin.kt: play (خيط Capacitor واحد لكل الإضافات)", 1.0, 1.0, "CONFIRMED",
                hypothesis = "نداء آخر على خيط Capacitor أمام play")
        }
    }

    private fun source(ph: Phase, input: Input) {
        if (ph.ms <= 0) return
        val prep = input.preparationMs
        if (prep == null) {
            ph.cause = Cause("UNKNOWN", "لا قياس للاستخراج", null, 0.0, 0.0, "UNKNOWN", "زمن الاستخراج وتجهيز السيرفر")
            return
        }
        ph.evidence += "الاستخراج وتجهيز السيرفر ${prep}ms"
        if (prep > ph.ms) {
            // بدأ قبل الضغط (ورقة السيرفرات تجهّز مسبقًا): لا يُعرف كم منه وقع بعد الضغط، فلا يُنسب إليه شيء
            ph.cause = Cause("UNKNOWN", "الاستخراج بدأ قبل الضغط: لا يُعرف كم منه بعده", null, 0.0, 0.0, "UNKNOWN", "لحظة توفر المرشح بساعة المشغّل")
            return
        }
        val inside = prep
        val share = inside.toDouble() / ph.ms
        ph.evidence += "فتح المشغّل بعدها ${ph.ms - inside}ms"
        ph.cause = if (share >= 0.5) Cause("SOURCE_PREPARATION", "الاستخراج وتجهيز السيرفر", "AnimeEngine.kt: prepare ← stream/Prepared.kt", share, share, confidence(share, share))
        else Cause("PLAYER_OPEN", "فتح المشغّل بعد توفر المرشح (فحص الرابط وتهيئة Media3)", "PlayerActivity.kt: start", 1 - share, 1 - share, confidence(1 - share, 1 - share))
    }

    private fun metadata(ph: Phase, t: Torrent, open: Long) {
        if (ph.beforeTap || ph.ms <= 0) {
            ph.cause = when {
                t.warmedAt in 1..open -> Cause("PREWARM", "Metadata جاهزة قبل فتح المشغّل (تسخين مسبق)", null, 1.0, 1.0, "CONFIRMED")
                t.metadataCached -> Cause("METADATA_CACHED", "Metadata من ملف محفوظ", null, 1.0, 1.0, "CONFIRMED")
                else -> Cause("ENGINE_REUSED", "التورنت كان في المحرك قبل الفتح", null, 1.0, 1.0, "CONFIRMED")
            }
            return
        }
        if (t.metadataCached) {
            ph.cause = Cause("METADATA_CACHED", "Metadata من ملف محفوظ: الوقت في إضافة التورنت للجلسة", "TorrentEngine.kt: State.handle", 1.0, 1.0, "CONFIRMED")
            ph.evidence += "إضافة التورنت للجلسة ${(t.addedAt - ph.start).coerceAtLeast(0)}ms"
            return
        }
        // المقاطع من البداية الفعلية للمرحلة؛ أي علامة قبلها تُقص إليها، وأي علامة بعد Metadata لم تُقس داخلها
        val start = ph.start
        fun clip(at: Long) = if (at <= 0 || at > ph.end) 0L else maxOf(at, start)
        val added = clip(t.addedAt).takeIf { it > 0 } ?: start
        val known = clip(t.firstKnownAt)
        val peer = clip(t.firstPeerAt)
        val segs = mutableListOf<Segment>()
        if (added > start) segs += Segment(Kind("WAIT_ENGINE_ADD", "قبل إضافة التورنت للمحرك", "TorrentEngine.kt: acquire ← State.handle"), start, added)
        if (known > 0) segs += Segment(Kind("WAIT_PEER_DISCOVERY", "اكتشاف أول مشارك (متتبعات وDHT)", "libtorrent: tracker/DHT announce ← TorrentEngine.kt: resumeAnnounced (TorrentPolicy.PUBLIC_TRACKERS)"), added, known)
        if (peer > 0) segs += Segment(Kind("WAIT_PEER_HANDSHAKE", "الاتصال بأول مشارك", "libtorrent: connect_peer ← TorrentEngine.kt: tuneConnectTimeout"), if (known > 0) known else added, peer)
        if (peer > 0) segs += Segment(Kind("WAIT_METADATA", "تبادل Metadata مع المشاركين المتصلين", "libtorrent: ut_metadata ← TorrentEngine.kt: acquire (waitFor)"), peer, ph.end)
        val measured = segs.sumOf { (it.to - it.from).coerceAtLeast(0) }
        if (segs.isEmpty() || measured <= 0) {
            ph.cause = Cause("UNKNOWN", "لا خط زمني للمشاركين داخل انتظار Metadata", null, 0.0, 0.0, "UNKNOWN", "أول مشارك معروف ومتصل أثناء انتظار Metadata")
            return
        }
        val top = segs.maxBy { it.to - it.from }
        val coverage = minOf(1.0, measured.toDouble() / ph.ms)
        val share = (top.to - top.from).toDouble() / measured
        ph.cause = Cause(top.kind.code, top.kind.ar, top.kind.where, share, coverage, confidence(coverage, share),
            if (coverage < 0.7) "${pct(1 - coverage)} من المرحلة بلا علامة مشارك" else null)
        for (seg in segs.sortedByDescending { it.to - it.from }) ph.evidence += "${seg.kind.ar} ${seg.to - seg.from}ms"
        if (t.firstKnownAt == 0L) ph.evidence += "أول مشارك معروف: لم يُسجَّل"
    }

    private fun engineWaits(ph: Phase, input: Input, waits: List<ReadWait>, firstByte: Long, integrity: MutableList<String>) {
        val t = input.torrent
        val sum = LinkedHashMap<Kind, Long>()
        var covered = 0L
        var longWait = false
        for (w in waits) {
            if (w.endAt <= 0) continue
            val o = overlap(ph.start, ph.end, w.endAt - w.ms, w.endAt)
            if (o <= 0) continue
            val k = kindOf(w)
            sum[k] = (sum[k] ?: 0L) + o
            covered += o
            // اللقطة الأولى تتغير أثناء الانتظار في «لم تبدأ» و«تُنزَّل» وحدهما؛ الفجوة والاكتمال حقيقتان عند أخذها
            if (w.ms > 1_000 && (k === NOT_STARTED || k === PARTIAL)) longWait = true
            // المدة المنسوبة لهذه المرحلة وحدها (كان يطبع الانتظار كله: 437ms داخل مرحلة 170ms، عينة المالك)
            ph.evidence += "القطعة ${w.piece}${if (w.tail) " (ذيل الملف)" else ""}: ${o}ms في هذه المرحلة" + (if (o < w.ms) " من انتظار ${w.ms}ms" else "") +
                " · ${k.ar} · عند أول عيّنة مكتوب في libtorrent ${w.engine} من ${w.blocks} وعندنا ${w.known}" +
                (if (w.early) " · انتهى بقراءة قبل التحقق" else " · انتهى بالقطعة الموثقة")
        }
        // القراءات التي كان المشغّل ينتظرها داخل المرحلة. رأس الملف وذيله (فهرس الحاوية) تُحلَّل كاملة قبل المتابعة، فكل
        // مدتها انتظار؛ قراءة موضع التشغيل تنتظر حتى أول بايت ثم تتدفق
        val readKinds = LinkedHashMap<String, Long>()
        val blocking = mutableListOf<LongRange>()
        val startupEnd = listOf(input.readyAt, input.frameAt).filter { it > 0 }.maxOrNull() ?: input.now
        for (r in input.reads) {
            val code = readCode(r, input)
            val end = if (r.endAt > 0) r.endAt else input.now
            val until = if (code == "WAIT_POSITION_FIRST_BYTE") (if (r.firstByteAt > 0) r.firstByteAt else input.now) else end
            val o = overlap(ph.start, ph.end, r.openedAt, until)
            if (o < 100) continue
            readKinds[code] = (readKinds[code] ?: 0L) + o
            blocking += maxOf(ph.start, r.openedAt)..minOf(ph.end, until)
            val dur = end - r.openedAt
            val k = readKind(code, input)
            // المرحلة أولًا؛ المجموع تراكمي حتى لحظة التقرير ويُعلَّم إن امتد بعد البدء (كان «27MB في 8.2 ث» داخل بدء 0.59 ث)
            ph.evidence += "${k.ar} (من ${bytes(r.position)}): ${o}ms في هذه المرحلة" +
                (if (r.firstByteAt > 0) " · أول بايت بعد ${r.firstByteAt - r.openedAt}ms" else " · لم يصل بايت") +
                " · مجموعها حتى لحظة التقرير ${bytes(r.bytes)} في ${dur}ms" + (if (r.endAt <= 0) " (جارية)" else "") +
                (if (end > startupEnd + 100) " (يشمل ما بعد البدء)" else "")
        }
        val readCovered = union(blocking)
        if (readKinds.isNotEmpty() && t != null && t.downloadBps > 0) ph.evidence += "التحميل الآن ${String.format(Locale.US, "%.2f", t.downloadBps / 1048576.0)}MB/ث"
        if (ph.id == "first-byte" && t != null) firstByteSegments(ph, t, firstByte)
        if (ph.id == "container" && t != null && t.mkvSkipped > 0) ph.evidence += "تخطّى بلا تنزيل ${bytes(t.mkvSkipped)} (مرفقات MKV)"
        if (ph.ongoing && t != null && t.waitingPiece >= 0 && t.waitingSince > 0) {
            val since = input.now - maxOf(t.waitingSince, ph.start)
            ph.evidence += "الآن ينتظر القطعة ${t.waitingPiece} منذ ${input.now - t.waitingSince}ms" + (t.waitingBlocks?.let { (d, n) -> " ($d/$n كتلة)" } ?: " (لم يبدأ تحميلها)")
            val k = t.waitingBlocks?.let { (d, n) -> if (d <= 0) NOT_STARTED else if (d >= n) COMPLETE else PARTIAL } ?: NOT_STARTED
            sum[k] = (sum[k] ?: 0L) + since.coerceAtLeast(0)
            covered += since.coerceAtLeast(0)
        }
        val coverage = minOf(1.0, covered.toDouble() / maxOf(1L, ph.ms))
        val total = sum.values.sum()
        // ما كان المشغّل ينتظره (القراءة) حين لا تغطي انتظارات القطع المسجلة نصف المرحلة: يقول أين ذهب الوقت، لا لماذا
        val readCoverage = minOf(1.0, readCovered.toDouble() / maxOf(1L, ph.ms))
        if (readKinds.isNotEmpty() && coverage < 0.5 && readCoverage > coverage) {
            val (code, ms) = readKinds.maxBy { it.value }
            val top = readKind(code, input)
            val share = ms.toDouble() / readKinds.values.sum()
            // نوع البيانات محتمل (لا حدود رأس ولا موضع فهرس مقاس): مكان الوقت مقاس، وما فيه لا يرفع الحكم فوق «محتمل»
            val conf = if (top.hypothesis != null) capped(confidence(readCoverage, share), "POSSIBLE") else confidence(readCoverage, share)
            val why = if (t != null) "لماذا بطؤت القراءة: انتظارات القطع داخلها" + if (covered > 0) " (المسجل منها ${pct(coverage)} من المرحلة)" else " (لم يُسجَّل منها شيء)"
                else "لماذا بطؤت القراءة: سرعة خادم المصدر وما يحتاجه المستخرج منها (لا يُسجَّل)"
            ph.cause = Cause(top.code, top.ar, top.where, share, readCoverage, conf,
                listOfNotNull(if (readCoverage < 0.7) "${pct(1 - readCoverage)} من المرحلة بلا قراءة منتظرة" else null, why).joinToString(" · "), top.hypothesis)
            return
        }
        if (sum.isNotEmpty() && total > 0) {
            val (top, ms) = sum.maxBy { it.value }
            val share = ms.toDouble() / total
            var conf = confidence(coverage, share)
            var needs: String? = if (coverage < 0.7) "${pct(1 - coverage)} من المرحلة بلا انتظار قطعة مسجل" else null
            // اللقطة الأولى تقول حال القطعة حينها، لا ما شغل بقية الانتظار
            if (longWait) { conf = capped(conf, "STRONGLY_SUPPORTED"); needs = listOfNotNull(needs, "حالة القطعة أثناء الانتظار الطويل (عيّنات دورية، كما في ويندوز)").joinToString(" · ") }
            if (top === PARTIAL || top === NOT_STARTED) needs = listOfNotNull(needs, "هل طُلبت كتلة الموضع ومتى ومن أي مشارك، وهل وصلت ولم تُكتب").joinToString(" · ")
            ph.cause = Cause(top.code, top.ar, top.where, share, coverage, conf, needs, top.hypothesis)
            return
        }
        if (ph.ms <= 0) return
        if (ph.id == "rendered") { rendered(ph, input); return }
        if (ph.id == "first-byte" && ph.cause != null) return
        if (ph.id == "first-byte" && t == null) { httpOpen(ph, input); return }
        ph.cause = Cause("UNKNOWN", if (ph.id == "ready") "لا انتظار قطعة مسجل: Media3 يخزّن ما يكفي للبدء" else "لا انتظار قطعة مسجل", null, 0.0, 0.0, "UNKNOWN",
            "انتظارات القطع الأقصر من ثانية، ووقت Media3 في التحليل والتخزين (لم يُسجَّلا بعد)")
    }

    /** أول بايت من خادم المصدر (بلا تورنت): فتح الاتصال (DNS/TLS/تحويلات حتى الرؤوس) ثم أول بيانات، مقاسان من Media3. */
    private fun httpOpen(ph: Phase, input: Input) {
        val r = input.reads.firstOrNull() ?: run {
            ph.cause = Cause("UNKNOWN", "لا طلب قراءة مسجل", null, 0.0, 0.0, "UNKNOWN", "فتح الاتصال بخادم المصدر")
            return
        }
        val connect = overlap(ph.start, ph.end, r.at, r.openedAt)
        val payload = if (r.firstByteAt > 0) overlap(ph.start, ph.end, r.openedAt, r.firstByteAt) else 0L
        ph.evidence += "فتح الاتصال بخادم المصدر حتى الرؤوس ${connect}ms · ثم أول بيانات ${payload}ms"
        val measured = connect + payload
        if (measured <= 0) { ph.cause = Cause("UNKNOWN", "لا قياس داخل المرحلة", null, 0.0, 0.0, "UNKNOWN", "متى بدأ Media3 الاتصال"); return }
        val coverage = minOf(1.0, measured.toDouble() / ph.ms)
        val (code, ar, ms) = if (connect >= payload) Triple("HTTP_CONNECT", "فتح الاتصال بخادم المصدر (DNS وTLS والتحويلات حتى الرؤوس)", connect)
            else Triple("HTTP_FIRST_PAYLOAD", "أول بيانات من خادم المصدر بعد الرؤوس", payload)
        val share = ms.toDouble() / measured
        ph.cause = Cause(code, ar, "Media3 DefaultHttpDataSource ← خادم المصدر (شبكة)", share, coverage, confidence(coverage, share),
            "أي جزء من الاتصال أبطأ (DNS أو TLS أو تحويل): لا يُسجَّل", "بطء خادم المصدر أو الشبكة، لا محرك فانتارا")
    }

    /** أول بايت بلا انتظار مسجل: مقاطع المحرك المقاسة مباشرة بعد Metadata. */
    private fun firstByteSegments(ph: Phase, t: Torrent, firstByte: Long) {
        fun clip(at: Long) = if (at <= 0 || at > ph.end) 0L else maxOf(at, ph.start)
        val payload = clip(t.firstPayloadAt)
        val piece = clip(t.firstPieceAt)
        val segs = mutableListOf<Segment>()
        if (payload > ph.start) segs += Segment(Kind("WAIT_FIRST_PAYLOAD", "حتى أول بيانات من المشاركين", "libtorrent: request_time_critical_pieces ← TorrentEngine.kt: State.select"), ph.start, payload)
        if (piece > maxOf(payload, ph.start)) segs += Segment(Kind("WAIT_FIRST_PIECE", "تنزيل أول قطعة كاملة (القطعة ${bytes(t.pieceBytes.toLong())})", "libtorrent: piece_picker ← TorrentEngine.kt: State.piece"), maxOf(payload, ph.start), piece)
        if (piece > 0 && firstByte > piece) segs += Segment(Kind("DELIVERY", "تسليم القطعة للمشغّل", "TorrentDataSource.kt: read"), piece, firstByte)
        val measured = segs.sumOf { it.to - it.from }
        for (seg in segs.sortedByDescending { it.to - it.from }) ph.evidence += "${seg.kind.ar} ${seg.to - seg.from}ms"
        if (measured <= 0 || ph.evidence.any { it.startsWith("القطعة ") }) return
        val top = segs.maxBy { it.to - it.from }
        val coverage = minOf(1.0, measured.toDouble() / ph.ms)
        val share = (top.to - top.from).toDouble() / measured
        ph.cause = Cause(top.kind.code, top.kind.ar, top.kind.where, share, coverage, confidence(coverage, share),
            "سبب الانتظار داخل المقطع: لا انتظار قطعة أطول من 0.1 ث مسجل")
    }

    private fun rendered(ph: Phase, input: Input) {
        if (input.frameAt > 0 && input.readyAt > 0 && input.frameAt < input.readyAt) ph.evidence += "أول صورة عُرضت قبل الجاهزية بـ${input.readyAt - input.frameAt}ms"
        val init = if (input.decoderInitAt > 0) overlap(ph.start, ph.end, input.decoderInitAt - input.decoderInitMs, input.decoderInitAt) else 0L
        if (input.decoder != null) ph.evidence += "المفكك ${input.decoder}" + if (input.decoderInitAt > 0) ": تهيئته ${input.decoderInitMs}ms، منها ${init}ms في هذه المرحلة" else ""
        val coverage = minOf(1.0, init.toDouble() / maxOf(1L, ph.ms))
        ph.cause = if (init > 0) Cause("DECODER_INIT", "تهيئة مفكك الفيديو", "Media3: MediaCodecVideoRenderer ← PlayerActivity.kt (RenderersFactory)", 1.0, coverage, confidence(coverage, 1.0),
            if (coverage < 0.7) "زمن أول عينة تدخل المفكك وأول إطار يخرج منه (لم يُسجَّلا بعد)" else null)
        else Cause("UNKNOWN", "لا انتظار بيانات ولا تهيئة مفكك في المرحلة: الفك أو العرض", null, 0.0, 0.0, "UNKNOWN", "زمن أول عينة تدخل المفكك وأول إطار يخرج منه (لم يُسجَّلا بعد)")
    }

    private fun s(ms: Long) = String.format(Locale.US, "%.2f ث", ms / 1000.0)
    private fun pct(x: Double) = "${Math.round(x * 100)}%"
    private fun bytes(n: Long) = PlaybackDiagnostics.bytes(n)

    /** «تقرير الذهب» نصًا، بالشكل نفسه في كل المنصات: يُنسخ كما هو. */
    fun text(input: Input): String = buildString {
        val a = analyze(input)
        appendLine("VANTARA DEEPTRACE · تقرير الذهب v1 · أندرويد")
        appendLine("البناء: ${input.build}")
        if (a.phases.isEmpty()) { a.integrity.forEach { appendLine(it) }; return@buildString }
        appendLine()
        appendLine(if (input.tapAt in 1..input.openAt) "[المسار الحرج من الضغطة]" else if (input.intentAt in 1..input.openAt) "[المسار الحرج من نية فتح المشغّل · الضغطة لم تُقس]" else "[المسار الحرج من فتح المصدر · الضغطة لم تُقس]")
        for (p in a.phases) appendLine("  ${p.ar}: ${s(p.ms)}" + (if (a.total > 0) " (${pct(p.ms.toDouble() / a.total)})" else "") +
            (if (p.beforeTap) " · قبل الفتح" else "") + (if (p.ongoing) " · جارية" else ""))
        appendLine("  المجموع (${a.phases.maxBy { it.end }.ar}): ${s(a.total)}")
        if (input.frameAt > 0) appendLine("  من الضغط حتى أول صورة معروضة: ${s(input.frameAt - a.origin)}" + if (input.readyAt > 0) " · حتى التشغيل (READY): ${s(input.readyAt - a.origin)}" else "")
        val b = a.bottleneck
        appendLine()
        appendLine("[الاختناق الرئيسي]")
        if (b == null) appendLine("  لا مرحلة طويلة بدليل")
        else {
            val c = b.cause!!
            appendLine("  ${b.ar}: ${s(b.ms)}")
            appendLine("  الحقيقة المقاسة: ${c.ar} (${c.code})")
            appendLine("  الثقة: ${CONFIDENCE_AR[c.confidence]} · تغطية الأدلة ${pct(c.coverage)} · حصة السبب ${pct(c.share)}")
            c.hypothesis?.let { appendLine("  السبب المحتمل (غير مثبت): $it") }
            c.where?.let { appendLine("  أين يُتخذ القرار" + (if (c.hypothesis != null) " (مرجّح)" else "") + ": $it") }
            for (e in b.evidence) appendLine("  دليل: $e")
            c.needs?.let { appendLine("  الدليل الناقص: $it") }
        }
        if (a.secondary.isNotEmpty()) {
            appendLine()
            appendLine("[اختناقات ثانوية]")
            for (p in a.secondary) {
                appendLine("  ${p.ar}: ${s(p.ms)} · ${p.cause!!.ar} (${CONFIDENCE_AR[p.cause!!.confidence]})")
                for (e in p.evidence.take(3)) appendLine("    دليل: $e")
            }
        }
        input.torrent?.let { t ->
            appendLine()
            appendLine("[الميزات الفعلية]")
            appendLine("  المحرك: " + (if (t.patched) "libtorrent مخصص (نافذة حرجة ${t.criticalPieces})" else "libtorrent الأصلي") +
                " · تلميح القراءة: " + when { t.hintsSent > 0 -> "وصل ${t.hintsSent}" + if (t.hintsFailed > 0) "، فشل ${t.hintsFailed}" else ""; t.hintsFailed > 0 -> "لا يصل (فشل ${t.hintsFailed})"; else -> "لم يُرسل" })
            appendLine("  الخيار B: " + (if (t.turbo) "مسموح" else "موثق فقط") + " · قُرئ قبل التحقق ${bytes(t.earlyBytes)}" + if (t.earlyFailures > 0) " · فشل تحقق ${t.earlyFailures}" else "")
            // «جاهز قبل الفتح بـ0 قطعة» كان لحظة الجدولة وعدد المستهدف: Metadata والقطع المكتملة والكتل الجزئية وإشارة
            // الجاهزية أشياء مختلفة، وما احتاجه المشغّل فعلًا في «انتظار القطع»
            appendLine("  التسخين: " + when { t.warmedAt <= 0 -> "لا"; t.warmedAt <= input.openAt -> "جُدول قبل الفتح بـ${s(input.openAt - t.warmedAt)} · مستهدف ${t.warmedPieces} قطعة"; else -> "جُدول بعد الفتح" } +
                (if (t.warmedAt > 0) " · إشارة الجاهزية (بداية الملف على القرص): " + when { t.warmReadyAt <= 0 -> "لم تُرَ"; t.warmReadyAt <= input.openAt -> "قبل الفتح بـ${s(input.openAt - t.warmReadyAt)}"; else -> "بعد الفتح" } else "") +
                " · Metadata " + (if (t.metadataAt in 1..input.openAt) "جاهزة قبل الفتح" else if (t.metadataAt > 0) "بعد الفتح" else "لم تكتمل"))
            appendLine("  القطعة ${bytes(t.pieceBytes.toLong())} · الملف ${bytes(t.fileBytes)} · مشاركون الآن ${t.peers}" +
                (if (t.clusterAt > 0) " · أول Cluster عند ${bytes(t.clusterAt)}" else "") + (if (t.cuesAt >= 0) " · Cues عند ${bytes(t.cuesAt)}" else ""))
        }
        appendLine()
        appendLine("[سلامة الأدلة]")
        for (x in a.integrity) appendLine("  $x")
        appendLine()
        append("[الحكم] ").append(if (b != null) "${CONFIDENCE_AR[a.verdict]}: ${b.ar} — ${b.cause!!.ar}" + (if (b.cause!!.hypothesis != null) " · السبب غير مثبت" else "") else "غير معروف")
    }
}
