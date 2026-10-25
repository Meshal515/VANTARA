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
    class Seek(val at: Long, val fromMs: Long, val toMs: Long) {
        var readyAt = 0L; var frameAt = 0L
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
    )
    /** حقائق المشغّل لحظة كتابة التقرير. */
    class PlayerFacts(
        val state: Int, val positionMs: Long, val bufferedMs: Long, val durationMs: Long,
        val container: String?, val video: String?, val decoder: String?, val textTracks: Int, val audioTracks: Int,
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

    @Synchronized fun start() {
        reads.clear(); seeks.clear(); events.clear(); opening.clear(); active.clear()
        count = 0; openAt = now(); readyAt = 0; frameAt = 0
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
    @Synchronized fun seek(fromMs: Long, toMs: Long, readyNow: Boolean = false) {
        if (openAt == 0L) return
        seeks.addLast(Seek(now(), fromMs, toMs).apply { if (readyNow) readyAt = at }); while (seeks.size > MAX_SEEKS) seeks.removeFirst()
        event("قفزة ${clock(fromMs)} ← ${clock(toMs)}" + if (readyNow) " (داخل المحمّل)" else "")
    }
    @Synchronized fun error(message: String) { if (openAt != 0L) event("خطأ: ${message.take(160)}") }

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
        val prep = firstByte - openAt
        val reading = readyAt - firstByte
        val before = reads.filter { it.at <= readyAt }
        val phases = before.joinToString("، ") { "${where(it.position, t?.fileBytes)} ${bytes(it.bytes)}" }
        return if (reading >= prep)
            "أطول مرحلة: من أول بايت إلى الجاهزية ${secs(reading)} ث، قرأ فيها المشغّل ${bytes(before.sumOf { it.bytes })} في ${before.size} طلب ($phases)"
        else "أطول مرحلة: حتى أول بايت ${secs(prep)} ث (تجهيز التورنت وأول قطعة)"
    }

    /** نص كامل للنسخ: حقائق فقط، بلا عنوان العمل ولا روابط ولا هويات. */
    @Synchronized fun report(t: TorrentFacts?, p: PlayerFacts, nowMs: Long = now()): String = buildString {
        appendLine("تشخيص VANTARA (نسخة الاختبار)")
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
            t.mkvHead?.let { appendLine("بداية الملف: $it") }
            if (t.mkvSkipped > 0) appendLine("تخطّى بلا تنزيل: ${bytes(t.mkvSkipped)} (مرفقات MKV)")
        }
        val firstByte = reads.firstOrNull { it.firstByteAt > 0 }?.firstByteAt ?: 0L
        appendLine("خط البدء: " + listOfNotNull(
            t?.let { "بيانات التورنت ${rel(it.metadataAt)}" }, t?.let { "أول قطعة ${rel(it.firstPieceAt)}" },
            "أول بايت ${rel(firstByte)}", "جاهز ${rel(readyAt)}", "أول صورة ${rel(frameAt)}",
        ).joinToString(" · "))
        appendLine("طلبات القراءة (${reads.size}):")
        for (r in reads) appendLine("  ${r.n}) ${rel(r.at)} ${where(r.position, t?.fileBytes)} → ${bytes(r.bytes)}" +
            (if (r.openedAt > r.at) " · فتح بعد ${secs(r.openedAt - r.at)} ث" else "") +
            (if (r.firstByteAt > 0) " · أول بايت بعد ${secs(r.firstByteAt - r.openedAt)} ث" else " · لم يصل بايت") +
            (if (r.endAt > 0) " · مدة ${secs(r.endAt - r.openedAt)} ث" else " · جارية"))
        if (seeks.isNotEmpty()) {
            appendLine("القفزات (${seeks.size}):")
            seeks.forEachIndexed { i, s -> appendLine("  ${i + 1}) ${clock(s.fromMs)} ← ${clock(s.toMs)}: " +
                (if (s.readyAt > 0) "جاهز بعد ${secs(s.readyAt - s.at)} ث" else "لم يجهز بعد (${secs(nowMs - s.at)} ث)") +
                (if (s.frameAt > 0) " · صورة بعد ${secs(s.frameAt - s.at)} ث" else "")) }
        }
        appendLine("الأحداث:")
        for (e in events) appendLine("  $e")
        append("الحكم: ").append(verdict(t, p, nowMs))
    }

    private fun rel(t: Long) = if (t > 0 && openAt > 0 && t >= openAt) String.format(Locale.US, "+%.1f", (t - openAt) / 1000.0) else "—"

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
