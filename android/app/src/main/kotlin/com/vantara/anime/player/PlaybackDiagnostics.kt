package com.vantara.anime.player

import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.TransferListener
import java.util.IdentityHashMap
import java.util.Locale

/**
 * تشخيص التشغيل لنسخة الاختبار فقط: ماذا طلب المشغّل فعلًا ومتى، لا تقديرات.
 *  - خط البدء من لحظة فتح المصدر: بيانات التورنت، أول قطعة، أول بايت، READY، أول إطار.
 *  - كل طلب قراءة من المشغّل: من أي بايت، كم قرأ، وكم استغرق (هذا ما كشف خطأ Media3 1.5.1).
 *  - كل قفزة: من أين إلى أين، ومتى عاد READY وأول إطار.
 * محدود الحجم (آخر [MAX_READS] طلبًا و[MAX_SEEKS] قفزة و[MAX_EVENTS] حدثًا)، بلا عناوين ولا هويات.
 * الحكم لا يقول إلا ما تثبته هذه الأرقام.
 */
@UnstableApi
class PlaybackDiagnostics(private val now: () -> Long = { android.os.SystemClock.elapsedRealtime() }) : TransferListener {
    class Read(val n: Int, val at: Long, val position: Long) {
        var openedAt = 0L; var bytes = 0L; var firstByteAt = 0L; var endAt = 0L
    }
    /**
     * قفزة واحدة كما طُلبت من SeekGuardPlayer (نقطة كل قفزة: الأزرار والشريط والغرفة). [method]: عادية، أو «إعادة تجهيز
     * بالفهرس» (مصدر بدأ بلا Cues: setMediaSource جديد فتُمسح الـTimeline والمدة حتى يقرأ الفهرس). [durationMs] المدة
     * لحظة الطلب، و[unknownSince]/[unknownMs] متى غابت المدة بعدها وكم بقيت غائبة.
     */
    class Seek(val at: Long, val fromMs: Long, val toMs: Long, val method: String = "عادية", val durationMs: Long = 0L, val seekable: Boolean = true) {
        var readyAt = 0L; var frameAt = 0L
        var unknownSince = 0L; var unknownMs = 0L
    }
    /** حقائق التورنت لحظة كتابة التقرير (من TorrentStats)، بالساعة نفسها elapsedRealtime. */
    class TorrentFacts(
        val peers: Int, val seeds: Int, val downloadBps: Long, val fileBytes: Long, val pieceBytes: Int,
        val metadataAt: Long, val firstPieceAt: Long, val waitingPiece: Int, val waitingSince: Long,
        val waitingBlocks: Pair<Int, Int>?,
        /** عناصر MKV العليا قبل أول Cluster كما مرّت بالقارئ، وما أُعطي أصفارًا بلا تنزيل. */
        val mkvHead: String? = null, val mkvSkipped: Long = 0L,
        /** التسخين قبل الضغط: متى اكتملت بياناته (elapsedRealtime، 0 = لم يُسخَّن) وكم قطعة طلب. */
        val warmedAt: Long = 0L, val warmedPieces: Int = 0,
        /** مشاركون بطيئون حُجبوا مؤقتًا لتتحرر قطعة عالقة (TorrentHotswap). */
        val swaps: Int = 0,
        val firstPeerAt: Long = 0L, val firstPayloadAt: Long = 0L,
        /** الخيار B: مسموح الآن، وما قُرئ قبل التحقق، وكم قطعة منه فشل تحققها. */
        val turbo: Boolean = false, val earlyBytes: Long = 0L, val earlyFailures: Int = 0,
        /** تلميح القراءة: وصل libtorrent كم مرة وفشل كم مرة، وآخر انتظارات القطع الأطول من 0.1 ث. */
        val hintsSent: Int = 0, val hintsFailed: Int = 0,
        val waits: List<com.vantara.addons.torrent.ReadWait> = emptyList(),
        /** تقرير الذهب: إضافة التورنت للجلسة، وMetadata من ملف محفوظ، وأول مشارك معروف. */
        val addedAt: Long = 0L, val metadataCached: Boolean = false, val firstKnownAt: Long = 0L,
    )
    /** حقائق المشغّل لحظة كتابة التقرير. */
    class PlayerFacts(
        val state: Int, val positionMs: Long, val bufferedMs: Long, val durationMs: Long,
        val container: String?, val video: String?, val decoder: String?, val textTracks: Int, val audioTracks: Int,
        val playWhenReady: Boolean = true,
    )

    private val reads = ArrayDeque<Read>()
    private val seeks = ArrayDeque<Seek>()
    private val events = ArrayDeque<String>()
    private val opening = IdentityHashMap<Any, Long>()
    private val active = IdentityHashMap<Any, Read>()
    private var count = 0
    @Volatile var openAt = 0L; private set
    @Volatile var readyAt = 0L; private set
    @Volatile var frameAt = 0L; private set
    /** لحظة الضغط على التشغيل (elapsedRealtime من نية فتح المشغّل)، تبقى عبر تبديل المصادر. 0 = غير معروفة. */
    @Volatile var launchedAt = 0L

    private var preparationMs: Long? = null
    private var firstCandidateMs: Long? = null
    private var audioOnlyAt = 0L
    /** تقرير الذهب: أول مسارات من الحاوية (onTracksChanged)، وتهيئة مفكك الفيديو (onVideoDecoderInitialized). */
    private var tracksAt = 0L
    private var decoderName: String? = null
    private var decoderInitAt = 0L
    private var decoderInitMs = 0L
    @Synchronized fun start(preparationMs: Long? = null, firstCandidateMs: Long? = null) {
        reads.clear(); seeks.clear(); events.clear(); opening.clear(); active.clear()
        count = 0; openAt = now(); readyAt = 0; frameAt = 0; audioOnlyAt = 0
        tracksAt = 0; decoderName = null; decoderInitAt = 0; decoderInitMs = 0
        this.preparationMs = preparationMs
        this.firstCandidateMs = firstCandidateMs
        event("فتح المصدر")
    }

    // طلب قراءة واحد = مصدر بيانات واحد بين فتحه وإغلاقه. منفصلة عن TransferListener لتُختبر بلا Uri.
    @Synchronized fun initializing(source: Any) { opening[source] = now() }
    @Synchronized fun opened(source: Any, position: Long) {
        if (openAt == 0L) return
        val read = Read(++count, opening.remove(source) ?: now(), position).apply { openedAt = now() }
        reads.addLast(read); while (reads.size > MAX_READS) reads.removeFirst()
        active[source] = read
    }
    @Synchronized fun transferred(source: Any, bytes: Int) {
        val read = active[source] ?: return
        if (bytes <= 0) return
        if (read.firstByteAt == 0L) read.firstByteAt = now()
        read.bytes += bytes
    }
    @Synchronized fun ended(source: Any) {
        opening.remove(source)
        active.remove(source)?.endAt = now()
    }

    override fun onTransferInitializing(source: DataSource, dataSpec: DataSpec, isNetwork: Boolean) { if (isNetwork) initializing(source) }
    override fun onTransferStart(source: DataSource, dataSpec: DataSpec, isNetwork: Boolean) { if (isNetwork) opened(source, dataSpec.position) }
    override fun onBytesTransferred(source: DataSource, dataSpec: DataSpec, isNetwork: Boolean, bytesTransferred: Int) { transferred(source, bytesTransferred) }
    override fun onTransferEnd(source: DataSource, dataSpec: DataSpec, isNetwork: Boolean) { ended(source) }

    @Synchronized fun state(state: Int, positionMs: Long, bufferedMs: Long) {
        if (openAt == 0L) return
        val name = when (state) { Player.STATE_BUFFERING -> "انتظار"; Player.STATE_READY -> "جاهز"; Player.STATE_ENDED -> "انتهى"; else -> "متوقف" }
        event("$name عند ${clock(positionMs)} (أمامه ${bufferedMs / 1000} ث)")
        if (state != Player.STATE_READY) return
        if (readyAt == 0L) readyAt = now()
        seeks.lastOrNull()?.takeIf { it.readyAt == 0L }?.readyAt = now()
    }
    @Synchronized fun firstFrame() {
        if (openAt == 0L) return
        if (frameAt == 0L) { frameAt = now(); event("أول صورة") }
        seeks.lastOrNull()?.takeIf { it.frameAt == 0L }?.frameAt = now()
    }
    /** [readyNow]: قفزة داخل ما هو محمّل أصلًا، فلا يمر المشغّل بالانتظار ولا يصل حدث READY جديد. */
    /** القفزة لحظة طلبها (قبل أن يبدأ Media3 أو يُعاد التجهيز). [applied] يكمّلها حين يصل حدث القفزة نفسه. */
    @Synchronized fun seekRequested(fromMs: Long, toMs: Long, method: String, durationMs: Long, seekable: Boolean) {
        if (openAt == 0L) return
        seeks.addLast(Seek(now(), fromMs, toMs, method, durationMs, seekable)); while (seeks.size > MAX_SEEKS) seeks.removeFirst()
        event("قفزة ${clock(fromMs)} ← ${clock(toMs)} ($method)")
    }
    /** حدث القفزة من Media3: داخل المحمّل يبقى READY بلا انتقال حالة، فالجاهزية هنا. */
    @Synchronized fun seekApplied(readyNow: Boolean) {
        val s = seeks.lastOrNull() ?: return
        if (readyNow && s.readyAt == 0L) s.readyAt = now()
    }
    /** المدة كما يعرفها المشغّل الآن (يُستدعى مع كل تغيّر حالة أو Timeline): يقيس غيابها بعد القفزة الأخيرة. */
    @Synchronized fun duration(durationMs: Long) {
        val s = seeks.lastOrNull() ?: return
        val unknown = durationMs <= 0
        if (unknown && s.unknownSince == 0L) s.unknownSince = now()
        if (!unknown && s.unknownSince > 0L) { s.unknownMs += now() - s.unknownSince; s.unknownSince = 0L }
    }

    @Synchronized fun seek(fromMs: Long, toMs: Long, readyNow: Boolean = false) {
        if (openAt == 0L) return
        seeks.addLast(Seek(now(), fromMs, toMs).apply { if (readyNow) readyAt = at }); while (seeks.size > MAX_SEEKS) seeks.removeFirst()
        event("قفزة ${clock(fromMs)} ← ${clock(toMs)}" + if (readyNow) " (داخل المحمّل)" else "")
    }
    @Synchronized fun tracks() { if (openAt != 0L && tracksAt == 0L) { tracksAt = now(); event("المسارات معروفة (قُرئت الحاوية)") } }
    @Synchronized fun decoderInitialized(name: String, initializationMs: Long) {
        if (openAt == 0L || decoderInitAt != 0L) return
        decoderName = name; decoderInitAt = now(); decoderInitMs = initializationMs.coerceAtLeast(0)
    }
    @Synchronized fun audioOnly() { if (openAt != 0L && audioOnlyAt == 0L) { audioOnlyAt = now(); event("صوت فقط: بدأ إخراج الصوت، لا إطار فيديو منتظر") } }
    @Synchronized fun error(message: String) {
        val safe = message.replace(Regex("""https?://[^\s"'<>]+""", RegexOption.IGNORE_CASE), "[url]")
            .replace(Regex("""(?:authorization|cookie|set-cookie)\s*[:=][^\r\n]+""", RegexOption.IGNORE_CASE), "[redacted header]")
            .replace(Regex("""(?:bearer\s+|(?:token|password|credential)\s*[:=]\s*)[^\s,;]+""", RegexOption.IGNORE_CASE), "[redacted]")
        if (openAt != 0L) event("خطأ: ${safe.take(800)}")
    }

    private fun event(text: String) {
        events.addLast("${rel(now())} $text"); while (events.size > MAX_EVENTS) events.removeFirst()
    }

    /** الحكم: أطول مرحلة بأرقامها، أو ما ينتظره المشغّل الآن. لا سبب لم يُقس. */
    @Synchronized fun verdict(t: TorrentFacts?, p: PlayerFacts, nowMs: Long = now()): String {
        val firstByte = reads.firstOrNull { it.firstByteAt > 0 }?.firstByteAt ?: 0L
        val needBps = if (t != null && p.durationMs > 0 && t.fileBytes > 0) t.fileBytes * 1000 / p.durationMs else 0L
        if (t != null && t.waitingPiece >= 0 && nowMs - t.waitingSince >= 2_000) {
            val blocks = t.waitingBlocks?.let { (done, total) -> "، وصل منها $done من $total كتلة" } ?: "، لم يبدأ تحميلها بعد"
            return "المشغّل ينتظر القطعة ${t.waitingPiece} منذ ${secs(nowMs - t.waitingSince)} ث$blocks"
        }
        if (t != null && needBps > 0 && t.downloadBps in 1 until needBps && p.bufferedMs < 10_000)
            return "التحميل ${mbps(t.downloadBps)} أقل مما يحتاجه الفيديو ${mbps(needBps)}"
        if (firstByte == 0L) return if (t != null && t.metadataAt == 0L) "لم تصل بيانات التورنت بعد (${secs(nowMs - openAt)} ث)" else "لم يصل أول بايت للمشغّل بعد (${secs(nowMs - openAt)} ث)"
        if (readyAt == 0L) return "وصل أول بايت ولم يجهز المشغّل بعد: قرأ ${bytes(reads.sumOf { it.bytes })} في ${reads.size} طلب"
        if (frameAt == 0L && p.video != null) return "المشغّل جاهز لكن لم تظهر أول صورة بعد (${secs(nowMs - readyAt)} ث بعد READY)"
        val prep = firstByte - openAt
        val reading = readyAt - firstByte
        val before = reads.filter { it.at <= readyAt }
        val phases = before.joinToString("، ") { "${where(it.position, t?.fileBytes)} ${bytes(it.bytes)}" }
        return if (reading >= prep)
            "أطول مرحلة: من أول بايت إلى الجاهزية ${secs(reading)} ث، قرأ فيها المشغّل ${bytes(before.sumOf { it.bytes })} في ${before.size} طلب ($phases)"
        else "أطول مرحلة: حتى أول بايت ${secs(prep)} ث (تجهيز التورنت وأول قطعة)"
    }

    /** مدخل تقرير الذهب من هذه الجلسة (ساعة واحدة: elapsedRealtime). */
    @Synchronized fun goldInput(t: TorrentFacts?, nowMs: Long = now(), build: String = "—", patched: Boolean = false, critical: Int = 0) = GoldReport.Input(
        tapAt = launchedAt, openAt = openAt, preparationMs = preparationMs,
        reads = reads.map { GoldReport.Read(it.at, it.openedAt, it.firstByteAt, it.position, it.bytes, it.endAt) },
        tracksAt = tracksAt, readyAt = readyAt, frameAt = frameAt, audioOnlyAt = audioOnlyAt,
        decoder = decoderName, decoderInitAt = decoderInitAt, decoderInitMs = decoderInitMs,
        torrent = t?.let { GoldReport.Torrent(it.addedAt, it.metadataCached, it.firstKnownAt, it.firstPeerAt, it.metadataAt, it.firstPayloadAt, it.firstPieceAt,
            it.warmedAt, it.warmedPieces, it.fileBytes, it.pieceBytes, it.waits, it.waitingPiece, it.waitingSince, it.waitingBlocks,
            it.peers, it.downloadBps, it.turbo, it.earlyBytes, it.earlyFailures, it.hintsSent, it.hintsFailed, it.mkvSkipped, patched, critical) },
        build = build, now = nowMs, readsFull = count > MAX_READS,
    )

    /** نص كامل للنسخ: تقرير الذهب أولًا ثم الحقائق الخام، بلا عنوان العمل ولا روابط ولا هويات. */
    @Synchronized fun report(t: TorrentFacts?, p: PlayerFacts, nowMs: Long = now(), build: String = "—"): String = buildString {
        appendLine("تشخيص VANTARA (نسخة الاختبار)")
        appendLine(GoldReport.text(goldInput(t, nowMs, build, engine(), critical())))
        appendLine()
        appendLine("[التفاصيل الخام]")
        val needBps = if (t != null && p.durationMs > 0 && t.fileBytes > 0) t.fileBytes * 1000 / p.durationMs else 0L
        appendLine("المشغّل: ${listOfNotNull(p.container, p.video, p.decoder?.let { "المفكك $it" }).joinToString(" · ").ifEmpty { "—" }}")
        appendLine("المسارات: ترجمة ${p.textTracks} · صوت ${p.audioTracks} · الموضع ${clock(p.positionMs)} · أمامه ${p.bufferedMs / 1000} ث")
        if (t != null) {
            appendLine("التورنت: الملف ${bytes(t.fileBytes)} · القطعة ${bytes(t.pieceBytes.toLong())} · مشاركون ${t.peers} (${t.seeds}) · تحميل ${mbps(t.downloadBps)}" +
                if (needBps > 0) " · يحتاج الفيديو ${mbps(needBps)}" else "")
            if (t.waitingPiece >= 0) appendLine("ينتظر الآن: القطعة ${t.waitingPiece} منذ ${secs(nowMs - t.waitingSince)} ث" +
                (t.waitingBlocks?.let { (d, n) -> " ($d/$n كتلة)" } ?: ""))
            appendLine(when {
                t.warmedAt <= 0 -> "التسخين المسبق: لم يُسخَّن هذا الخيار"
                t.warmedAt <= openAt -> "التسخين المسبق: جاهز قبل التشغيل بـ ${secs(openAt - t.warmedAt)} ث · ${t.warmedPieces} قطعة"
                else -> "التسخين المسبق: اكتمل بعد بدء التشغيل · ${t.warmedPieces} قطعة"
            })
            if (t.swaps > 0) appendLine("تبديل مشاركين بطيئين عن قطعة عالقة: ${t.swaps}")
            appendLine("قبل التحقق: " + (if (t.turbo) "مسموح" else "موثق فقط") + " · قُرئ ${bytes(t.earlyBytes)}" +
                if (t.earlyFailures > 0) " · فشل تحقق ${t.earlyFailures} قطعة وأُعيد التشغيل موثقًا" else "")
            appendLine("المحرك: " + (if (com.vantara.addons.torrent.TorrentEngine.PATCHED) "libtorrent مخصص (نافذة حرجة ${com.vantara.addons.torrent.TorrentEngine.CRITICAL_PIECES})" else "libtorrent الأصلي 2.0.12") +
                " · تلميح القراءة: " + hints(t))
            if (t.waits.isNotEmpty()) {
                appendLine("انتظار القطع (أطول من 0.1 ث، الأحدث آخرًا):")
                for (w in t.waits) appendLine("  " + wait(w))
            }
            t.mkvHead?.let { appendLine("بداية الملف: $it") }
            if (t.mkvSkipped > 0) appendLine("تخطّى بلا تنزيل: ${bytes(t.mkvSkipped)} (مرفقات MKV)")
        }
        val firstByte = reads.firstOrNull { it.firstByteAt > 0 }?.firstByteAt ?: 0L
        if (launchedAt in 1..openAt) appendLine("من الضغط حتى فتح المصدر: ${secs(openAt - launchedAt)} ث" +
            (if (frameAt > 0) " · من الضغط حتى أول صورة: ${secs(frameAt - launchedAt)} ث" else ""))
        appendLine("خط البدء: " + listOfNotNull(
            t?.let { "بيانات التورنت ${rel(it.metadataAt)}" }, t?.let { "أول مشارك ${rel(it.firstPeerAt)}" }, t?.let { "أول بيانات ${rel(it.firstPayloadAt)}" }, t?.let { "أول قطعة ${rel(it.firstPieceAt)}" },
            "أول بايت ${rel(firstByte)}", "جاهز ${rel(readyAt)}", "أول صورة ${rel(frameAt)}",
        ).joinToString(" · "))
        appendLine("أول سيرفر ظهر بعد: ${firstCandidateMs?.let { "${secs(it)} ث" } ?: "لم يُقس"} (من أي سيرفر)")
        appendLine("السيرفر المشغَّل ظهر بعد: ${preparationMs?.let { "${secs(it)} ث" } ?: "لم يُقس"} (من إنشاء جلسة التجهيز حتى توفر هذا المرشح، قبل الفحص والمشغّل)")
        val gap = if (preparationMs != null && firstCandidateMs != null) preparationMs!! - firstCandidateMs!! else null
        if (gap != null && gap >= 1000) appendLine("الانتظار بعد أول سيرفر حتى المشغَّل: ${secs(gap)} ث (الاختناق في الاختيار لا الاستخراج)")
        appendLine("تهيئة المشغّل: ${if (readyAt > 0) "${secs(readyAt - openAt)} ث" else "لم تكتمل"} · أول صورة: ${if (frameAt > 0) "${secs(frameAt - openAt)} ث" else if (audioOnlyAt > 0) "صوت فقط — لا إطار منتظر" else "لم تظهر"}")
        appendLine("طلبات القراءة (${reads.size}):")
        for (r in reads) appendLine("  ${r.n}) ${rel(r.at)} ${where(r.position, t?.fileBytes)} → ${bytes(r.bytes)}" +
            (if (r.openedAt > r.at) " · فتح بعد ${secs(r.openedAt - r.at)} ث" else "") +
            (if (r.firstByteAt > 0) " · أول بايت بعد ${secs(r.firstByteAt - r.openedAt)} ث" else " · لم يصل بايت") +
            (if (r.endAt > 0) " · مدة ${secs(r.endAt - r.openedAt)} ث" else " · جارية"))
        if (seeks.isNotEmpty()) {
            appendLine("القفزات (${seeks.size}):")
            seeks.forEachIndexed { i, s -> appendLine("  ${i + 1}) ${clock(s.fromMs)} ← ${clock(s.toMs)} (${s.method}): " +
                (if (s.readyAt > 0) "جاهز بعد ${secs(s.readyAt - s.at)} ث" else "لم يجهز بعد (${secs(nowMs - s.at)} ث)") +
                (if (s.frameAt > 0) " · صورة بعد ${secs(s.frameAt - s.at)} ث" else "") +
                " · المدة قبلها ${if (s.durationMs > 0) clock(s.durationMs) else "--:--"}" +
                (s.unknownMs + if (s.unknownSince > 0) nowMs - s.unknownSince else 0L).let { if (it > 0) " · غابت المدة ${secs(it)} ث" else "" } +
                reads.filter { it.at >= s.at && (seeks.getOrNull(i + 1)?.at ?: Long.MAX_VALUE) > it.at }.let { rs ->
                    if (rs.isEmpty()) " · لا طلب قراءة" else " · قراءات: " + rs.joinToString("، ") { r -> "${where(r.position, t?.fileBytes)} ${bytes(r.bytes)}" + if (r.firstByteAt == 0L) " (لم يصل بايت)" else "" }
                }) }
            seeks.lastOrNull()?.takeIf { it.readyAt == 0L }?.let { appendLine("  لماذا لم يستأنف: " + stuck(it, t, p, nowMs)) }
        }
        appendLine("الأحداث:")
        for (e in events) appendLine("  $e")
        append("الحكم: ").append(verdict(t, p, nowMs))
    }

    /** القفزة الأخيرة لم تعد READY: السبب من الحقائق وحدها، بترتيب ما يمنع الاستئناف أولًا. */
    internal fun stuck(s: Seek, t: TorrentFacts?, p: PlayerFacts, nowMs: Long): String {
        val after = reads.filter { it.at >= s.at }
        val why = mutableListOf<String>()
        if (!p.playWhenReady) why += "التشغيل موقوف (playWhenReady=false)"
        if (p.durationMs <= 0) why += "المدة غير معروفة: المصدر " + (if (s.method != "عادية") "يُعاد تجهيزه ولم يقرأ الفهرس بعد" else "فقد الـTimeline")
        when {
            after.isEmpty() -> why += "لم يفتح المشغّل أي طلب قراءة منذ القفزة (${secs(nowMs - s.at)} ث)"
            after.last().firstByteAt == 0L -> why += "آخر طلب ${where(after.last().position, t?.fileBytes)} لم يصل منه بايت منذ ${secs(nowMs - after.last().openedAt)} ث"
        }
        if (t != null && t.waitingPiece >= 0) why += "المحرك ينتظر القطعة ${t.waitingPiece} منذ ${secs(nowMs - t.waitingSince)} ث" +
            (t.waitingBlocks?.let { (d, n) -> " ($d/$n كتلة)" } ?: " (لم يبدأ تحميلها)")
        if (t != null && t.peers == 0) why += "لا مشاركين متصلين"
        return why.ifEmpty { listOf("الحالة ${p.state} والموضع ${clock(p.positionMs)} وأمامه ${p.bufferedMs / 1000} ث") }.joinToString(" · ")
    }

    // حقائق المحرك الثابتة؛ خارج الجهاز (اختبارات JVM) لا تُحمَّل مكتبته
    private fun engine() = runCatching { com.vantara.addons.torrent.TorrentEngine.PATCHED }.getOrDefault(false)
    private fun critical() = runCatching { com.vantara.addons.torrent.TorrentEngine.CRITICAL_PIECES }.getOrDefault(0)

    private fun hints(t: TorrentFacts) = when {
        t.hintsSent > 0 -> "وصل ${t.hintsSent}" + if (t.hintsFailed > 0) " · فشل ${t.hintsFailed}" else ""
        t.hintsFailed > 0 -> "لا يصل (فشل ${t.hintsFailed}، المكتبة بلا 0004)"
        else -> "لم يُرسل بعد"
    }

    /** انتظار واحد: القطعة والموضع والمدة، وما يعرفه المحرك مكتوبًا مقابل libtorrent لحظة أول عيّنة، وكيف انتهى. */
    internal fun wait(w: com.vantara.addons.torrent.ReadWait): String =
        "القطعة ${w.piece}" + (if (w.tail) " (آخر الملف)" else "") + " عند الكتلة ${w.block}: ${secs(w.ms)} ث" +
            " · مكتوب عندنا ${w.known} وفي libtorrent ${w.engine} من ${w.blocks}" +
            " · كتلة الموضع " + (if (w.atOffset) "معروفة" else "غير معروفة") +
            " · انتهى " + (if (w.early) "بقراءة قبل التحقق" else "بالقطعة الموثقة") +
            when {
                w.untracked -> " · فجوة: كتل على القرص لا يعرفها المحرك"
                !w.atOffset && w.engine < w.blocks -> " · كتلة الموضع لم تُنزَّل بعد"
                else -> ""
            }

    // ما حدث قبل فتح المشغّل (التسخين المسبق، بيانات محفوظة) يُكتب «قبل الفتح» لا «—»: البدء الدافئ يُعرف من البارد
    private fun rel(t: Long) = if (t > 0 && openAt > 0 && t >= openAt) String.format(Locale.US, "+%.1f", (t - openAt) / 1000.0) else if (t > 0 && openAt > 0) "قبل الفتح" else "—"

    companion object {
        const val MAX_READS = 60
        const val MAX_SEEKS = 20
        const val MAX_EVENTS = 80
        internal fun secs(ms: Long) = String.format(Locale.US, "%.1f", ms / 1000.0)
        internal fun mbps(bytesPerSecond: Long) = String.format(Locale.US, "%.1f Mbps", bytesPerSecond * 8 / 1_000_000.0)
        internal fun bytes(n: Long) = when {
            n >= 1L shl 30 -> String.format(Locale.US, "%.2fGB", n / (1024.0 * 1024 * 1024))
            n >= 1L shl 20 -> String.format(Locale.US, "%.1fMB", n / (1024.0 * 1024))
            n >= 1L shl 10 -> String.format(Locale.US, "%.0fKB", n / 1024.0)
            else -> "${n}B"
        }
        internal fun clock(ms: Long): String { val s = (ms.coerceAtLeast(0) / 1000).toInt(); return "%d:%02d".format(Locale.US, s / 60, s % 60) }
        /** موضع القراءة بالنسبة للملف: «من البداية» أو «من آخر الملف» أو «عند 42%». */
        internal fun where(position: Long, fileBytes: Long?): String = when {
            position == 0L -> "من البداية"
            fileBytes != null && fileBytes > 0 && fileBytes - position <= 64L * 1024 * 1024 && position * 100 / fileBytes >= 90 -> "من آخر الملف (${bytes(position)})"
            fileBytes != null && fileBytes > 0 -> "عند ${position * 100 / fileBytes}% (${bytes(position)})"
            else -> "عند ${bytes(position)}"
        }
    }
}
