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
    class Read(val at: Long, val openedAt: Long, val firstByteAt: Long, val position: Long, val bytes: Long)
    class Torrent(
        val addedAt: Long = 0L, val metadataCached: Boolean = false, val firstKnownAt: Long = 0L, val firstPeerAt: Long = 0L,
        val metadataAt: Long = 0L, val firstPayloadAt: Long = 0L, val firstPieceAt: Long = 0L,
        val warmedAt: Long = 0L, val warmedPieces: Int = 0, val fileBytes: Long = 0L, val pieceBytes: Int = 0,
        val waits: List<ReadWait> = emptyList(), val waitingPiece: Int = -1, val waitingSince: Long = 0L, val waitingBlocks: Pair<Int, Int>? = null,
        val peers: Int = 0, val turbo: Boolean = false, val earlyBytes: Long = 0L, val earlyFailures: Int = 0,
        val hintsSent: Int = 0, val hintsFailed: Int = 0, val mkvSkipped: Long = 0L, val patched: Boolean = false, val criticalPieces: Int = 0,
    )
    class Input(
        val tapAt: Long, val openAt: Long, val preparationMs: Long? = null, val reads: List<Read> = emptyList(),
        val tracksAt: Long = 0L, val readyAt: Long = 0L, val frameAt: Long = 0L, val audioOnlyAt: Long = 0L,
        val decoder: String? = null, val decoderInitAt: Long = 0L, val decoderInitMs: Long = 0L,
        val torrent: Torrent? = null, val build: String = "—", val now: Long = 0L, val readsFull: Boolean = false,
    )
    class Cause(val code: String, val ar: String, val where: String?, val share: Double, val coverage: Double, val confidence: String, val needs: String? = null)
    class Phase(val id: String, val ar: String, val start: Long, val end: Long, val beforeTap: Boolean = false, val ongoing: Boolean = false) {
        val ms: Long get() = end - start
        val evidence = mutableListOf<String>()
        var cause: Cause? = null
    }
    class Analysis(val phases: List<Phase>, val bottleneck: Phase?, val secondary: List<Phase>, val integrity: List<String>, val verdict: String, val total: Long, val origin: Long)

    private class Kind(val code: String, val ar: String, val where: String?)

    // سبب انتظار القطعة من لقطة الثانية الأولى ([ReadWait]): ما يعرفه المحرك مكتوبًا وما يقوله libtorrent
    private val NOT_STARTED = Kind("WAIT_PIECE_NOT_STARTED", "لم تبدأ أي كتلة من القطعة بعد ثانية (لم تُطلب أو لا مشارك يرسلها)",
        "TorrentEngine.kt: State.prioritize (setPieceDeadline) ← libtorrent: request_time_critical_pieces")
    private val PARTIAL = Kind("WAIT_BLOCK_RESPONSE", "القطعة تُنزَّل وكتلة القراءة لم تصل بعد",
        "libtorrent: piece_picker (ترتيب الكتل، 0004) ← NativeReadHint.kt")
    private val COMPLETE = Kind("WAIT_PIECE_VERIFICATION", "القطعة كلها على القرص وتنتظر التحقق والقراءة",
        "libtorrent: hash_piece ثم read_piece ← TorrentEngine.kt: State.piece")
    private val VERIFIED_ONLY = Kind("WAIT_VERIFIED_ONLY", "كتلة الموضع مكتوبة والقراءة انتظرت القطعة الموثقة",
        "TorrentEngine.kt: State.piece (TurboRead.writtenSpan)")
    private val GAP = Kind("VANTARA_BLOCK_TRACKING_GAP", "كتل على القرص لا يعرفها المحرك (فاتته إشعارات block_finished)",
        "TorrentEngine.kt: State (written ← block_finished_alert)")
    private val WAITS_KINDS = listOf(NOT_STARTED, PARTIAL, COMPLETE, VERIFIED_ONLY, GAP)

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

    /** أين في الملف قرأ الطلب: الرأس، أو الذيل (فهرس الحاوية)، أو موضع التشغيل. */
    fun placeOf(position: Long, fileBytes: Long): String = when {
        position <= 2L * 1024 * 1024 -> "رأس الملف"
        fileBytes > 0 && (position >= fileBytes * 98 / 100 || (fileBytes - position <= 64L * 1024 * 1024 && position * 100 / fileBytes >= 90)) -> "ذيل الملف (الفهرس)"
        else -> "موضع التشغيل"
    }

    private fun overlap(a0: Long, a1: Long, b0: Long, b1: Long) = (minOf(a1, b1) - maxOf(a0, b0)).coerceAtLeast(0L)

    fun analyze(input: Input): Analysis {
        val integrity = mutableListOf<String>()
        val t = input.torrent
        val open = input.openAt
        if (open <= 0) return Analysis(emptyList(), null, emptyList(), listOf("لم يُفتح مصدر: لا مسار يُبنى"), "UNKNOWN", 0, 0)
        val tapKnown = input.tapAt in 1..open
        if (!tapKnown) integrity += "زمن الضغط غير معروف: المدد من فتح المصدر لا من الضغط"
        val origin = if (tapKnown) input.tapAt else open
        val firstByte = input.reads.filter { it.firstByteAt > 0 }.minOfOrNull { it.firstByteAt } ?: 0L
        val phases = mutableListOf<Phase>()
        phases += Phase("source", "تجهيز المصدر وفتح المشغّل (من الضغط)", origin, open)
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
        var stopped = false
        for ((id, ar, at) in stages) {
            if (stopped) break
            if (!add(id, ar, at, null)) {
                stopped = true
                // المرحلة الجارية: من آخر نهاية حتى لحظة التقرير
                if (input.now > prev) phases += Phase(id, ar, prev, input.now, ongoing = true)
                integrity += "البدء لم يكتمل: مرحلة «$ar» جارية منذ ${s(input.now - prev)}"
            }
        }
        if (input.frameAt == 0L && input.audioOnlyAt > 0) integrity += "صوت فقط: لا إطار فيديو منتظر"

        val waits = t?.waits.orEmpty()
        if (waits.any { it.endAt <= 0 }) integrity += "انتظارات بلا وقت نهاية (بناء أقدم): لا تُنسب إلى مرحلة"
        for (ph in phases) {
            when (ph.id) {
                "source" -> source(ph, input)
                "metadata" -> metadata(ph, t!!, open)
                else -> engineWaits(ph, input, waits, firstByte, integrity)
            }
        }

        val ranked = phases.filter { it.ms > 0 && it.cause != null }.sortedByDescending { it.ms }
        val bottleneck = ranked.firstOrNull()
        if (t != null) {
            integrity += "انتظارات القطع الأقصر من ثانية لا تُسجَّل، وسبب كل انتظار من لقطة ثانيته الأولى"
            if (waits.size >= 32) integrity += "سجل الانتظارات ممتلئ (آخر 32): سقطت انتظارات أقدم"
            if (!t.metadataCached && t.metadataAt > open && t.firstKnownAt == 0L) integrity += "أول مشارك معروف: لم يُقس في هذه الجلسة"
        }
        if (input.readsFull) integrity += "سجل طلبات القراءة ممتلئ: سقطت طلبات قديمة"
        integrity += if (input.frameAt > 0) "أول صورة معروضة: مقاسة (onRenderedFirstFrame)" else "أول صورة معروضة: لم تُعرض بعد"
        val end = phases.maxOfOrNull { it.end } ?: open
        return Analysis(phases, bottleneck, ranked.drop(1).take(2), integrity, bottleneck?.cause?.confidence ?: "UNKNOWN", end - origin, origin)
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
            if (w.ms > 2_000) longWait = true
            ph.evidence += "القطعة ${w.piece}${if (w.tail) " (ذيل الملف)" else ""}: ${w.ms}ms · ${k.ar} · عند الثانية الأولى مكتوب في libtorrent ${w.engine} من ${w.blocks} وعندنا ${w.known}" +
                (if (w.early) " · انتهى بقراءة قبل التحقق" else " · انتهى بالقطعة الموثقة")
        }
        // الطلبات التي فُتحت في المرحلة وطال أول بايت لها: أين في الملف (الذيل = فهرس الحاوية)
        for (r in input.reads) {
            if (r.openedAt < ph.start || r.openedAt > ph.end) continue
            val wait = if (r.firstByteAt > 0) r.firstByteAt - r.openedAt else input.now - r.openedAt
            if (wait < 300) continue
            ph.evidence += "طلب قراءة من ${placeOf(r.position, t?.fileBytes ?: 0)} (${bytes(r.position)}): " +
                if (r.firstByteAt > 0) "أول بايت بعد ${wait}ms" else "لم يصل بايت منذ ${wait}ms"
        }
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
        if (sum.isNotEmpty() && total > 0) {
            val (top, ms) = sum.maxBy { it.value }
            val share = ms.toDouble() / total
            var conf = confidence(coverage, share)
            var needs: String? = if (coverage < 0.7) "${pct(1 - coverage)} من المرحلة بلا انتظار قطعة مسجل" else null
            // لقطة الثانية الأولى تقول حال القطعة حينها، لا ما شغل بقية الانتظار
            if (longWait) { conf = capped(conf, "STRONGLY_SUPPORTED"); needs = listOfNotNull(needs, "تقسيم الانتظار الطويل بعيّنات دورية (حالة كل كتلة كما في ويندوز)").joinToString(" · ") }
            if (top === PARTIAL || top === NOT_STARTED) needs = listOfNotNull(needs, "هل طُلبت كتلة الموضع من مشارك ومن أيّها").joinToString(" · ")
            ph.cause = Cause(top.code, top.ar, top.where, share, coverage, conf, needs)
            return
        }
        if (ph.ms <= 0) return
        if (ph.id == "rendered") { rendered(ph, input); return }
        if (ph.id == "first-byte" && ph.cause != null) return
        ph.cause = Cause("UNKNOWN", if (ph.id == "ready") "لا انتظار قطعة مسجل: Media3 يخزّن ما يكفي للبدء" else "لا انتظار قطعة مسجل", null, 0.0, 0.0, "UNKNOWN",
            "انتظارات القطع الأقصر من ثانية، ووقت Media3 في التحليل والتخزين (لم يُسجَّلا بعد)")
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
            "سبب الانتظار داخل المقطع: لا انتظار قطعة أطول من ثانية مسجل")
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
        appendLine("[المسار الحرج من الضغط]")
        for (p in a.phases) appendLine("  ${p.ar}: ${s(p.ms)}" + (if (a.total > 0) " (${pct(p.ms.toDouble() / a.total)})" else "") +
            (if (p.beforeTap) " · قبل الفتح" else "") + (if (p.ongoing) " · جارية" else ""))
        appendLine("  المجموع (${a.phases.last().ar}): ${s(a.total)}")
        val b = a.bottleneck
        appendLine()
        appendLine("[الاختناق الرئيسي]")
        if (b == null) appendLine("  لا مرحلة طويلة بدليل")
        else {
            val c = b.cause!!
            appendLine("  ${b.ar}: ${s(b.ms)}")
            appendLine("  السبب: ${c.ar} (${c.code})")
            c.where?.let { appendLine("  أين يُتخذ القرار: $it") }
            appendLine("  الثقة: ${CONFIDENCE_AR[c.confidence]} · تغطية الأدلة ${pct(c.coverage)} · حصة السبب ${pct(c.share)}")
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
            appendLine("  التسخين: " + when { t.warmedAt <= 0 -> "لا"; t.warmedAt <= input.openAt -> "جاهز قبل الفتح بـ${t.warmedPieces} قطعة"; else -> "اكتمل بعد الفتح" } +
                " · القطعة ${bytes(t.pieceBytes.toLong())} · الملف ${bytes(t.fileBytes)} · مشاركون الآن ${t.peers}")
        }
        appendLine()
        appendLine("[سلامة الأدلة]")
        for (x in a.integrity) appendLine("  $x")
        appendLine()
        append("[الحكم] ").append(if (b != null) "${CONFIDENCE_AR[a.verdict]}: ${b.ar} بسبب ${b.cause!!.ar}" else "غير معروف")
    }
}
