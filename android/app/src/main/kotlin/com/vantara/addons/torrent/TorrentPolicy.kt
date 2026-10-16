package com.vantara.addons.torrent

import java.net.URI
import java.net.URLDecoder
import java.net.URLEncoder
import java.net.InetAddress
import java.io.ByteArrayOutputStream
import java.util.Locale

/** The same torrent and exact file selected by the addon, never a title-only lookup. */
class TorrentRequest(infoHash: String, val fileIdx: Int? = null, sources: List<String> = emptyList(), magnet: String? = null) {
    val infoHash = canonicalHash(infoHash)
    val trackers: List<String>
    init {
        require(this.infoHash.matches(Regex("[0-9a-f]{40}"))) { "Invalid torrent hash" }
        require(fileIdx == null || fileIdx >= 0) { "Invalid torrent file index" }
        val fields = if (magnet == null) emptyList() else {
            require(magnet.length <= 16384 && magnet.startsWith("magnet:?")) { "Invalid magnet" }
            magnet.substringAfter('?').split('&').map { part ->
                val pair = part.split('=', limit = 2)
                pair[0] to URLDecoder.decode(pair.getOrElse(1) { "" }, "UTF-8")
            }
        }
        if (magnet != null) {
            val hashes = fields.filter { it.first == "xt" }.map {
                require(it.second.startsWith("urn:btih:", true)) { "Unsupported magnet identity" }
                canonicalHash(it.second.substring(9))
            }
            require(hashes.size == 1 && hashes.single() == this.infoHash) { "Magnet identity does not match stream" }
        }
        trackers = (sources.take(100).filter { it.startsWith("tracker:") }.map { it.removePrefix("tracker:") } + fields.filter { it.first == "tr" }.map { it.second })
            .filter(::publicTracker).distinct().take(32)
    }
    /** متتبّعات الإضافة أولًا ثم قائمة عامة ثابتة: إضافة بلا متتبّعات لا تُترك لـDHT وحده. */
    val announce: List<String> get() = TorrentPolicy.mergeTrackers(trackers)
    fun magnetUri(): String = "magnet:?xt=urn:btih:$infoHash" + announce.joinToString("") { "&tr=" + URLEncoder.encode(it, "UTF-8") }
    private fun publicTracker(value: String): Boolean = runCatching {
        val uri = URI(value)
        val host = uri.host?.lowercase(Locale.ROOT)?.removeSurrounding("[", "]") ?: return false
        value.length <= 2048 && uri.scheme in listOf("udp", "https", "http") && uri.userInfo == null &&
            (host.contains('.') || host.contains(':')) && !host.endsWith(".local") && !host.endsWith(".localhost") &&
            host != "localhost" && publicLiteralOrDomain(host)
    }.getOrDefault(false)
    private fun publicLiteralOrDomain(host: String): Boolean {
        if (!host.contains(':') && !Regex("^[0-9.]+$").matches(host)) return true
        // This branch contains numeric literals only: never resolve addon DNS on the UI thread.
        val address = InetAddress.getByName(host)
        if (address.isAnyLocalAddress || address.isLoopbackAddress || address.isLinkLocalAddress || address.isSiteLocalAddress || address.isMulticastAddress) return false
        val bytes = address.address
        if (bytes.size == 16 && ((bytes[0].toInt() and 254) == 252)) return false
        if (bytes.size == 4) {
            val first = bytes[0].toInt() and 255; val second = bytes[1].toInt() and 255
            if (first == 0 || first >= 224 || (first == 100 && second in 64..127)) return false
        }
        return true
    }
    companion object {
        private fun canonicalHash(raw: String): String {
            val hash = raw.lowercase(Locale.ROOT)
            if (hash.matches(Regex("[0-9a-f]{40}"))) return hash
            require(raw.uppercase(Locale.ROOT).matches(Regex("[A-Z2-7]{32}"))) { "Invalid torrent hash" }
            val alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
            val out = ByteArrayOutputStream(20)
            var buffer = 0; var bits = 0
            for (char in raw.uppercase(Locale.ROOT)) {
                buffer = (buffer shl 5) or alphabet.indexOf(char); bits += 5
                if (bits >= 8) { bits -= 8; out.write((buffer ushr bits) and 255) }
            }
            return out.toByteArray().joinToString("") { "%02x".format(it) }
        }
    }
}

data class TorrentFile(val index: Int, val path: String, val size: Long, val offset: Long)
data class TorrentStats(
    val peers: Int, val seeds: Int, val downloadBytesPerSecond: Long, val totalDone: Long, val metadata: Boolean,
    val state: String? = null, val paused: Boolean = false, val candidates: Int = 0, val known: Int = 0,
)
data class PieceRead(val piece: Int, val offset: Int, val length: Int)

/** Pure bounds/selection rules, shared by native loader and regression tests. */
object TorrentPolicy {
    /**
     * متتبّعات عامة معروفة وثابتة (مجالات عامة لا عناوين رقمية): تمرّ بفلتر الشبكة نفسه
     * (apply_ip_filter_to_trackers + ssrf_mitigation) مثل أي متتبّع من الإضافة.
     */
    val PUBLIC_TRACKERS = listOf(
        "udp://tracker.opentrackr.org:1337/announce",
        "udp://open.demonii.com:1337/announce",
        "udp://open.stealth.si:80/announce",
        "udp://tracker.torrent.eu.org:451/announce",
        "udp://exodus.desync.com:6969/announce",
        "udp://explodie.org:6969/announce",
        "udp://tracker.theoks.net:6969/announce",
        "udp://opentracker.io:6969/announce",
        "udp://tracker.dler.org:6969/announce",
        "udp://tracker-udp.gbitt.info:80/announce",
        // شبكات جوّال تحجب UDP: نسخة HTTP/HTTPS
        "http://tracker.opentrackr.org:1337/announce",
        "https://tracker.gbitt.info:443/announce",
    )
    const val MAX_ANNOUNCE = 48
    fun mergeTrackers(addon: List<String>, defaults: List<String> = PUBLIC_TRACKERS): List<String> {
        val seen = HashSet<String>()
        return (addon + defaults).filter { seen.add(it.trim().trimEnd('/').lowercase(Locale.ROOT)) }.take(MAX_ANNOUNCE)
    }

    /**
     * مواعيد القطع (ms) لـset_piece_deadline: القطعة التي يقرؤها المشغّل الآن أولًا، ثم ما بقي من
     * طرفي الملف (فهرس MP4/MKV الذي يقفز إليه المستخرج قبل أول إطار)، ثم القطع التالية بتدرّج
     * يتسع — 12 قطعة بمواعيد متقاربة كانت تقسم السرعة عليها كلها فتتأخر القطعة الأولى.
     */
    fun deadlines(window: List<Int>, pendingEdges: List<Int> = emptyList()): List<Pair<Int, Int>> {
        val out = ArrayList<Pair<Int, Int>>(window.size + pendingEdges.size)
        val seen = HashSet<Int>()
        window.firstOrNull()?.let { out += it to 0; seen += it }
        for (piece in pendingEdges) if (seen.add(piece)) out += piece to 250 * out.size
        val base = 250 * out.size
        window.drop(1).forEachIndexed { i, piece ->
            if (seen.add(piece)) out += piece to base + if (i < 3) i * 250 else 750 + (i - 2) * 750
        }
        return out
    }
    private val video = Regex("(?i).*\\.(mkv|mp4|webm|avi|mov|m4v|ts)$")
    private fun playable(file: TorrentFile) = file.size > 0 && file.offset >= 0 && video.matches(file.path) &&
        !file.path.startsWith('/') && !file.path.contains('\\') && !file.path.contains('\u0000') &&
        file.path.split('/').none { it == ".." || it == "." } && !Regex("^[A-Za-z]:").containsMatchIn(file.path)
    fun selectFile(files: List<TorrentFile>, requested: Int?): TorrentFile =
        (if (requested == null) files.filter(::playable).maxByOrNull { it.size } else files.firstOrNull { it.index == requested && playable(it) })
            ?: throw IllegalArgumentException("No playable file at requested torrent index")
    fun readAt(file: TorrentFile, position: Long, pieceLength: Int, count: Int): PieceRead? {
        require(pieceLength > 0 && count >= 0 && position in 0..file.size)
        if (position == file.size || count == 0) return null
        val absolute = Math.addExact(file.offset, position)
        val piece = absolute / pieceLength
        require(piece <= Int.MAX_VALUE)
        val offset = (absolute % pieceLength).toInt()
        return PieceRead(piece.toInt(), offset, minOf(count.toLong(), file.size - position, (pieceLength - offset).toLong()).toInt())
    }
    /** First piece and the last two of the file: MP4 moov, MKV cues and AVI idx1 live at one end. */
    fun edges(file: TorrentFile, pieceLength: Int): List<Int> {
        if (file.size <= 0) return emptyList()
        val first = (file.offset / pieceLength).toInt()
        val last = ((Math.addExact(file.offset, file.size) - 1) / pieceLength).toInt()
        return listOf(first, last - 1, last).filter { it in first..last }.distinct()
    }
    fun window(file: TorrentFile, position: Long, pieceLength: Int, count: Int = 12): List<Int> {
        require(count in 1..64)
        val first = readAt(file, position, pieceLength, 1)?.piece ?: return emptyList()
        val last = ((Math.addExact(file.offset, file.size) - 1) / pieceLength).toInt()
        return (first..minOf(last, first + count - 1)).toList()
    }
}

/**
 * تجهيز مسبق محدود حين تصل نتائج الإضافة (قبل أن يضغط المستخدم): بيانات التورنت (metadata)
 * لأفضل خيارين، وطرفا الملف للأول فقط. السعة والمدة محدودتان في المحرّك.
 */
object TorrentPrefetch {
    const val MAX = 2
    /** طرفا الملف (3 قطع) لا يُجلبان مسبقًا إن تجاوزا هذا الحجم: بيانات الجوّال. */
    const val MAX_EDGE_BYTES = 12L * 1024 * 1024
    private val seedersMark = Regex("👤\\s*([0-9]{1,7})")
    /** عدد المشاركين كما تكتبه Torrentio/Comet/MediaFusion في العنوان («👤 42»)؛ null إن غاب. */
    fun seeders(label: String?): Int? = label?.let { seedersMark.find(it)?.groupValues?.get(1)?.toIntOrNull() }
    /**
     * من قائمة مرتّبة كما يرتّبها المشغّل (رابط، عنوان): أول خيارين ليس لهما 0 مشارك.
     * الأول يجلب طرفي الملف أيضًا، إلا في تجهيز الحلقة التالية (بيانات فقط، لا يزاحم ما يُشاهَد).
     */
    fun pick(ranked: List<Pair<String, String?>>, background: Boolean = false, limit: Int = MAX): List<Pair<String, Boolean>> =
        ranked.filter { seeders(it.second) != 0 }.distinctBy { it.first }.take(limit)
            .mapIndexed { index, (url, _) -> url to (index == 0 && !background) }
    fun edgesFit(pieceLength: Int, pieces: Int): Boolean = pieceLength > 0 && pieceLength.toLong() * pieces <= MAX_EDGE_BYTES
}

/**
 * وزن السرب في ترتيب خيارات التورنت. الترتيب كان يرى الجودة والصحة فقط، فيختار تلقائيًا (ويجهّز
 * مسبقًا) تورنتًا بثلاثة زارعين أو ريمكس 40GB بجانب خيار بمئات الزارعين وحجم معقول — بدء بطيء جدًا
 * أو لا بدء. سرعة بدء التورنت يحددها عدد المشاركين وحجم القطعة/معدل البت، لا الجودة.
 */
object TorrentSwarm {
    private const val GB = 1024.0 * 1024 * 1024
    private val sizeMark = Regex("💾\\s*([0-9]{1,5}(?:[.,][0-9]{1,3})?)\\s*(TB|GB|MB)", RegexOption.IGNORE_CASE)
    /** الحجم كما تكتبه Torrentio/Comet/MediaFusion في العنوان («💾 1.4 GB»)؛ null إن غاب. */
    fun size(label: String?): Long? = label?.let { sizeMark.find(it) }?.let { m ->
        val value = m.groupValues[1].replace(',', '.').toDoubleOrNull() ?: return null
        val unit = when (m.groupValues[2].uppercase()) { "TB" -> 1024 * GB; "GB" -> GB; else -> GB / 1024 }
        (value * unit).toLong()
    }
    /** صفر زارعين = ميت عمليًا؛ ثم لوغاريتم العدد (1000 زارع ≈ 1.0)؛ والأحجام الضخمة تتأخر. */
    fun score(label: String?, videoSize: Long?): Double {
        val seeds = TorrentPrefetch.seeders(label)
        val swarm = when {
            seeds == null -> 0.0
            seeds == 0 -> -1.5
            else -> minOf(1.0, kotlin.math.log10(seeds + 1.0) / 3.0)
        }
        val bytes = videoSize?.takeIf { it > 0 } ?: size(label)
        val heavy = when {
            bytes == null -> 0.0
            bytes > 30 * GB -> -0.6
            bytes > 15 * GB -> -0.4
            bytes > 6 * GB -> -0.15
            else -> 0.0
        }
        return swarm + heavy
    }
}

/**
 * نافذة التورنت المتحركة على القرص (نفس نسخة الويندوز):
 *  - ورا موضع المشاهدة: 50 ثانية فقط (32MB على الأقل)؛ ما قبلها يُفرَّغ من القرص (hole punch).
 *  - قدّام: حتى 10 دقائق بقدر ما تسمح المساحة الحرة (نصف الفائض عن احتياط 1GB)، و12 قطعة دائمًا.
 *  - الرجوع لمنطقة فُرّغت: libtorrent ما زال يظن القطعة عنده ويقرأ أصفارًا (ثبت باختبار حقيقي)،
 *    فيُعاد بناء التورنت ببيانات الاستئناف مع حذف القطع المفرّغة منها — بلا فحص كامل للملف.
 * رأس الملف وآخر قطعتين (فهرس MKV/MP4) لا تُفرَّغ أبدًا.
 */
object TorrentWindow {
    const val BEHIND_MS = 50_000L
    const val MIN_BEHIND_BYTES = 32L * 1024 * 1024
    const val MIN_EVICT_BYTES = 64L * 1024 * 1024
    const val AHEAD_MS = 10 * 60_000L
    const val RESERVE_FREE_BYTES = 1024L * 1024 * 1024
    const val MIN_AHEAD_PIECES = 12
    const val MAX_AHEAD_PIECES = 4096

    fun bytesPerSecond(size: Long, durationMs: Long): Double =
        if (durationMs > 30_000 && size > 0) size * 1000.0 / durationMs else 1.5 * 1024 * 1024

    /** أول قطعة يجب أن تبقى على القرص؛ null = لا تفريغ بعد (المدة مجهولة أو ما زلنا في البداية). */
    fun keepFrom(file: TorrentFile, pieceLength: Int, positionMs: Long, durationMs: Long): Int? {
        if (durationMs <= 0 || positionMs <= 0 || file.size <= 0) return null
        val bps = bytesPerSecond(file.size, durationMs)
        val byTime = minOf(1.0, positionMs.toDouble() / durationMs) * file.size
        // معدل البت متغيّر: هامش 3% من الحجم وبحد أقصى دقيقتين من الفيديو
        val margin = minOf(file.size * 0.03, 120 * bps)
        val target = byTime - margin - maxOf(MIN_BEHIND_BYTES.toDouble(), BEHIND_MS / 1000.0 * bps)
        if (target <= 0) return null
        return ((file.offset + target.toLong()) / pieceLength).toInt()
    }

    /** القطع التي تُفرَّغ الآن: بعد قطعة الرأس وقبل آخر قطعتين، من حيث وقف التفريغ السابق، بدفعة لا تقل عن 64MB. */
    fun evictRange(file: TorrentFile, pieceLength: Int, keepFrom: Int, evictedUntil: Int): IntRange? {
        if (file.size <= 0) return null
        val head = (file.offset / pieceLength).toInt()
        val last = ((file.offset + file.size - 1) / pieceLength).toInt()
        val start = maxOf(head + 1, evictedUntil)
        val end = minOf(keepFrom, last - 1)
        if (end <= start || (end - start).toLong() * pieceLength < MIN_EVICT_BYTES) return null
        return start until end
    }

    /** النطاق داخل الملف (إزاحة، طول) لقطع متتالية، مقصوصًا بحدود الملف. */
    fun fileSpan(file: TorrentFile, pieceLength: Int, pieces: IntRange): Pair<Long, Long> {
        val start = maxOf(0L, pieces.first.toLong() * pieceLength - file.offset)
        val end = minOf(file.size, (pieces.last + 1).toLong() * pieceLength - file.offset)
        return start to maxOf(0L, end - start)
    }

    /** كم قطعة قدّام موضع القراءة: 12 دائمًا، وحتى 10 دقائق بقدر نصف المساحة الفائضة عن 1GB. */
    fun aheadPieces(file: TorrentFile, pieceLength: Int, durationMs: Long, freeBytes: Long): Int {
        if (durationMs <= 0) return MIN_AHEAD_PIECES
        val want = AHEAD_MS / 1000.0 * bytesPerSecond(file.size, durationMs)
        val room = maxOf(0L, freeBytes - RESERVE_FREE_BYTES) / 2.0
        val pieces = kotlin.math.ceil(minOf(want, room) / pieceLength).toInt()
        return pieces.coerceIn(MIN_AHEAD_PIECES, MAX_AHEAD_PIECES)
    }
}
