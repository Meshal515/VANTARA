package com.vantara.addons.torrent

import java.net.URI
import java.net.URLDecoder
import java.net.URLEncoder
import java.net.InetAddress
import java.io.ByteArrayOutputStream
import java.util.Locale

/** The same torrent and exact file selected by the addon, never a title-only lookup. */
class TorrentRequest(
    infoHash: String, val fileIdx: Int? = null, sources: List<String> = emptyList(), magnet: String? = null,
    /** رقم الحلقة المطلوبة (عدد صحيح موجب) حين يغيب fileIdx: يختار ملفها من حزمة الموسم بدل الأكبر (TR1). */
    val episode: Int? = null,
    /** اسم الملف كما تعلنه الإضافة (behaviorHints.filename): أقوى من رقم الحلقة إن طابق ملفًا. */
    val filename: String? = null,
) {
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
    val firstPieceAt: Long = 0L, val fileBytes: Long = 0L,
    val pieceBytes: Int = 0, val metadataAt: Long = 0L, val waitingPiece: Int = -1, val waitingSince: Long = 0L,
    val mkvHead: String? = null, val mkvSkipped: Long = 0L,
    val warmedAt: Long = 0L, val warmedPieces: Int = 0, val swaps: Int = 0,
    /** خط البدء: أول مشارك متصل وأول بيانات من الشبكة (elapsedRealtime، 0 = لم يحدث). */
    val firstPeerAt: Long = 0L, val firstPayloadAt: Long = 0L,
    /** تقرير الذهب: إضافة التورنت للجلسة، وMetadata من ملف محفوظ، وأول مشارك معروف (elapsedRealtime، 0 = لم يحدث). */
    val addedAt: Long = 0L, val metadataCached: Boolean = false, val firstKnownAt: Long = 0L,
    /** الخيار B ([TurboRead]): مسموح الآن، وما قُرئ قبل التحقق، وكم قطعة منه فشل تحققها. */
    val turbo: Boolean = false, val earlyBytes: Long = 0L, val earlyFailures: Int = 0,
    /** تلميح القراءة (0004): كم مرة وصل libtorrent وكم مرة فشل (مكتبة بلا الدالتين). */
    val hintsSent: Int = 0, val hintsFailed: Int = 0,
    /** آخر انتظارات القراء الأطول من 0.1 ث ([ReadWait]). */
    val waits: List<ReadWait> = emptyList(),
    /** كل read وصل المحرك (بعد مخزن TorrentDataSource). */
    val engineReads: Long = 0L,
)
/**
 * انتظار قارئ لقطعة تجاوز ثانية: لحظة الثانية الأولى، كم كتلة يعرفها المحرك مكتوبة ([known]، من block_finished_alert)
 * وكم يقول libtorrent إنها مكتوبة أو قيد الكتابة ([engine]، من download_queue) من [blocks]، وهل كتلة الموضع [block]
 * معروفة. ثم المدة الكلية وكيف انتهى: قراءة قبل التحقق ([early]) أو القطعة الموثقة. [engine] أكبر من [known] بأكثر من
 * كتلتين = كتل على القرص لا يعرفها المحرك فلا يقرؤها مبكرًا.
 */
data class ReadWait(
    val piece: Int, val block: Int, val blocks: Int, val known: Int, val engine: Int, val atOffset: Boolean,
    val ms: Long, val early: Boolean, val tail: Boolean,
    /** نهاية الانتظار (elapsedRealtime): ينسبه تقرير الذهب إلى مرحلته. 0 = غير معروفة. */
    val endAt: Long = 0L,
) {
    val untracked: Boolean get() = engine > known + 2
}
/** ما قاسه المحرك لتورنت: حجم القطعة، والسرب (باذرون معروفون، -1 مجهول)، والمتصلون الآن. */
data class TorrentFacts(
    val pieceLength: Int, val swarmSeeds: Int, val peers: Int,
    /** بيانات أول إطار على القرص (CLAUDE.md: إضاءة التسخين بإشارة المحرك): قطعة الرأس موثقة، أو كتل متصلة من بداية الملف. */
    val ready: Boolean = false,
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
    /**
     * ما يأخذ موعدًا خارج النافذة: الطرفان في أول ترتيب فقط ([firstOpen]: المستخرج يقرأ الرأس ثم الفهرس قبل أول إطار)،
     * وقطع الفهرس المطلوبة صراحة ([cues]) دائمًا. بموعد دائم كان الطرفان يملآن طابور كل مشارك قبل موضع المتابعة (قطع
     * 16MB: حتى 48MB)، وlibtorrent لا يطلب للحرجة من مشارك طابوره فوق 2 ث: المتابعة 5–14 ث. القياس على محرك ويندوز
     * (المكتبة نفسها): متابعة 16MB 6.9 ← 4.7 ث، والبدء كما هو.
     */
    fun pendingEdges(firstOpen: Boolean, edges: List<Int>, cues: List<Int>, next: List<Int>, have: (Int) -> Boolean): List<Int> =
        ((if (firstOpen) edges else emptyList()) + cues).distinct().filter { it !in next && !have(it) }
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
    /**
     * الملف الذي يُشغَّل أو يُنزَّل من التورنت:
     * 1) fileIdx الصريح من الإضافة إن كان فيديو صالحًا.
     * 2) اسم الملف المعلن (behaviorHints.filename) إن طابق ملفًا.
     * 3) رقم الحلقة من أسماء الملفات (S01E05، 1x05، E05، «- 05»، [05]، «الحلقة 5»).
     * 4) ملف الفيديو الوحيد، أو الأكبر حين لا تُطلب حلقة بعينها (فيلم).
     * حزمة فيها عدة حلقات وطُلبت حلقة ليست فيها = خطأ صريح، لا تشغيل حلقة أخرى (TR1). fileIdx يشير لغير فيديو
     * يرجع لمطابقة الاسم والرقم بدل الفشل النهائي (TR2).
     */
    /**
     * [season]: موسم الطلب إن عُرف (null = عمل AniList بموسم واحد بأرقام نسبية). TO1-TO6: الهوية من الحزمة كلها
     * ([EpisodeNames.pack]): الخاصة والملخصات لا تنافس، والرقم الذي يتغير بين الملفات هو الحلقة، والترقيم المطلق يُطابَق
     * بالترتيب، وحزمة عدة مواسم بلا تلميح لا تُخمَّن (رفض فيُجرَّب مصدر آخر، لا حلقة موسم آخر).
     */
    fun selectFile(files: List<TorrentFile>, requested: Int?, episode: Int? = null, filename: String? = null, season: Int? = null): TorrentFile {
        if (requested != null) files.firstOrNull { it.index == requested && playable(it) }?.let { return it }
        val videos = files.filter(::playable)
        if (videos.isEmpty()) throw IllegalArgumentException("No playable file at requested torrent index")
        val hinted = filename?.let(::baseName)?.lowercase(Locale.ROOT)?.takeIf { it.isNotBlank() }
        if (hinted != null) videos.firstOrNull { baseName(it.path).lowercase(Locale.ROOT) == hinted }?.let { return it }
        val wanted = episode?.takeIf { it > 0 }
        val ids = EpisodeNames.pack(videos.map { it.path })
        val regular = videos.filter { ids[it.path]?.let { id -> !id.special && !id.fraction } ?: true }
        if (wanted != null) {
            val inSeason = { f: TorrentFile -> season == null || ids[f.path]?.season.let { it == null || it == season } }
            val matches = regular.filter { ids[it.path]?.episode == wanted && inSeason(it) }
            if (matches.isNotEmpty()) {
                val seasons = matches.mapNotNull { ids[it.path]?.season }.toSet()
                if (season == null && seasons.size > 1) throw IllegalArgumentException("EPISODE_NOT_IN_TORRENT")
                return matches.maxBy { it.size }
            }
            // ترقيم مطلق: حزمة متصلة من موسم واحد تبدأ بعد 1 (13..24) والمطلوب ترتيبه فيها (1 ← 13)
            val numbered = regular.filter(inSeason).mapNotNull { f -> ids[f.path]?.episode?.let { it to f } }.sortedBy { it.first }
            val numbers = numbered.map { it.first }
            val oneSeason = numbered.mapNotNull { ids[it.second.path]?.season }.toSet().size <= 1
            if (oneSeason && numbers.isNotEmpty() && numbers.first() > 1 && numbers.zipWithNext().all { (a, b) -> b == a + 1 } && wanted <= numbers.size) {
                return numbered[wanted - 1].second
            }
        }
        if (videos.size == 1) return videos.single()
        // fileIdx صريح لا يقود لفيديو: لا يُستبدل بملف آخر بلا دليل على أنه الحلقة نفسها
        if (requested != null) throw IllegalArgumentException("No playable file at requested torrent index")
        if (wanted != null) {
            // حزمة بلا أرقام حلقات قابلة للقراءة: الأكبر كما كان. فيها أرقام ولا تحوي المطلوبة: لا حلقة خاطئة
            if (videos.any { ids[it.path]?.episode != null }) throw IllegalArgumentException("EPISODE_NOT_IN_TORRENT")
        }
        return videos.maxBy { it.size }
    }
    private fun baseName(path: String) = path.substringAfterLast('/')
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
    /**
     * تعديل مواعيد النافذة بالفرق ([deadlineDiff]): ما خرج منها يُلغى موعده، وما دخل يأخذ موعده، والقطعة
     * التي يقرؤها المشغّل الآن (موعد 0) يُعاد ضبط موعدها دائمًا. السبب من كود libtorrent 2.0.12 نفسه
     * (torrent.cpp: set_piece_deadline وcancel_non_critical): إذا فرغت قائمة القطع الحرجة ثم أُضيفت قطعة،
     * تُلغى كل الطلبات غير الحرجة عند كل المشاركين. مسح المواعيد كلها ثم إعادتها (النافذة القديمة) يفرغ
     * القائمة عند كل تقدّم قطعة، فتُلغى طلبات ما قدّام النافذة في كل مرة. وإعادة ضبط قطعة موجودة لا تصفّر
     * مؤقت إعادة الطلب فيها (first_requested/last_requested) بخلاف مسحها وإضافتها من جديد.
     */
    data class DeadlineDiff(val reset: List<Int>, val set: List<Pair<Int, Int>>, val keep: Set<Int>)
    fun deadlineDiff(current: Set<Int>, wanted: List<Pair<Int, Int>>): DeadlineDiff {
        val keep = wanted.mapTo(LinkedHashSet()) { it.first }
        val reset = current.filter { it !in keep }
        val set = wanted.filter { (piece, deadline) -> deadline == 0 || piece !in current }
        return DeadlineDiff(reset, set, keep)
    }

    /**
     * أول قطعة، وقطع الذيل التي تغطي آخر [TAIL_INDEX_BYTES] من الملف (قطعتان كحد): فهرس الحاوية (Cues في MKV،
     * moov في MP4) في أوله أو آخره. كانت «آخر قطعتين» دائمًا: بقطع 8MB تلك 16MB والفهرس 697KB فقط (عينة الجهاز
     * 26 نوفمبر: 24MB قبل أول صورة بسرب من 8 مشاركين = 14.8 ث).
     */
    fun edges(file: TorrentFile, pieceLength: Int): List<Int> {
        if (file.size <= 0) return emptyList()
        val first = (file.offset / pieceLength).toInt()
        val end = Math.addExact(file.offset, file.size)
        val last = ((end - 1) / pieceLength).toInt()
        val tailFrom = maxOf(last - 1, ((end - minOf(file.size, TAIL_INDEX_BYTES)) / pieceLength).toInt())
        return (listOf(first) + (tailFrom..last)).filter { it in first..last }.distinct()
    }
    /** فهارس الحاويات التي رأيناها في آخر الملف: 63KB–697KB؛ 2MB هامش آمن. */
    const val TAIL_INDEX_BYTES = 2L * 1024 * 1024
    /**
     * تركيز البدء: عند أول نافذة أو قفزة إلى موضع جديد، والقطعة المنتظرة لم تكتمل، تُطلب القطع ذات الموعد
     * وحدها. فتح النافذة كلها (12 قطعة متتابعة) يملأ طابور كل مشارك بنحو 10 كتل لقطع لا ينتظرها المشغّل،
     * فالكتل الأخيرة من القطعة المنتظرة (عند مشاركين بطيئين) لا تُنقذ إلا خلف طابور من ثانية إلى ثانيتين.
     * محاكي السرب (40 مشاركًا، 49 Mbps، قطعة 1MB): أول قطعة بعد تسخين 1.5 ث من 3.9 إلى 1.8 ث، وباردًا من 5.6
     * إلى 3.2 ث. القفزة تشمل تخطي مرفقات MKV. التشغيل المستمر لا يتأثر: القطعة التالية من القطع ذات الموعد أصلًا،
     * أو اكتملت.
     */
    /** القطع ذات الموعد في التركيز: القطعة المنتظرة وحدها حين القطعة كبيرة (≥4MB تحمل ثواني من الفيديو). */
    fun focusPieces(pieceLength: Int, critical: Int = 2): Int = if (pieceLength >= LARGE_PIECE_BYTES) 1 else critical
    const val LARGE_PIECE_BYTES = 4 * 1024 * 1024

    fun focusStart(next: List<Int>, applied: List<Int>, focused: Boolean, haveHead: Boolean, critical: Int = 2): Boolean =
        next.isNotEmpty() && !haveHead && (next.first() !in applied.take(critical) || (focused && next.first() == applied.first()))

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
    /** التسخين الخلفي للصفوف الظاهرة (غير «المقترح»): عددها، وسرعة كل واحد، وميزانية قطعته الأولى. */
    const val BACKGROUND_MAX = 4
    const val BACKGROUND_RATE = 1024 * 1024
    const val BACKGROUND_BUDGET = 8L * 1024 * 1024
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
    /** «تسخين كامل على باقة الجوال» في ورقة الشبكة بالمشغّل: مقفل افتراضيًا، والمستخدم يفعّله لنفسه. */
    const val PREFS = "vantara.player"
    const val WARM_ON_METERED = "warmOnMetered"
    /**
     * ميزانية التسخين على شبكة غير محدودة (Wi-Fi) لكل خيار: أول قطعة والذيل حتى قطع 16MB (كانت 16MB فيبقى ذيل
     * ملفات 16MB بعد الضغط). الرأس وحده بموعد، والذيل بأولوية أقل (TorrentEngine.prefetched)، فلا يبطئ الرأس.
     */
    const val WARM_BUDGET = 48L * 1024 * 1024
    /**
     * القطع التي تُنزَّل قبل الضغط على تشغيل. الثواني الضائعة (11–16 ث على الجوال) كانت قبل أول
     * قطعة: انتظار أن يسمح المشاركون بالتحميل. التسخين يبدأ هذا الانتظار والمستخدم يتصفح.
     * أول قطعة أولًا ولو كانت كبيرة (كان «الطرفان معًا ≤12MB» يُسقط ملفات القطع 8MB كلها)،
     * ثم الذيل (فهرس الحاوية) فيما تبقى. على شبكة محدودة (الجوال): لا قطع، بيانات واتصالات فقط.
     */
    fun warmPieces(edges: List<Int>, pieceLength: Int, unmetered: Boolean, budget: Long = WARM_BUDGET): List<Int> {
        if (!unmetered || pieceLength <= 0 || edges.isEmpty() || pieceLength > budget) return emptyList()
        val out = mutableListOf(edges.first())
        var used = pieceLength.toLong()
        for (piece in edges.drop(1).reversed()) {
            if (used + pieceLength > budget) break
            out += piece; used += pieceLength
        }
        return out
    }
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

/**
 * «hotswap» كما في torrent-stream (Stremio): القطعة التي ينتظرها المشغّل عالقة عند مشارك بطيء.
 * libtorrent لا يعيد طلب كتلتها من غيره إلا بعد «متوسط زمن القطعة» أو في نهاية اللعبة (لا تأتي
 * ونحن نطلب قطعًا كثيرة قدّام)، وjlibtorrent بلا إلغاء طلب عند مشارك بعينه. فيُحجب المشارك البطيء
 * الذي يرسل هذه القطعة مؤقتًا: ينقطع، تتحرر كتلته، فتُطلب فورًا من مشارك أسرع.
 */
object TorrentHotswap {
    data class Peer(val ip: String, val piece: Int, val bytesPerSecond: Int)
    /** انتظار القطعة قبل التدخل: أقل من هذا يكتمل غالبًا وحده. */
    const val WAIT_MS = 1_500L
    const val BAN_MS = 60_000L
    private const val SLOW_BPS = 16 * 1024
    private const val MAX_VICTIMS = 2

    /** من يُحجب الآن: يرسل [piece] أبطأ بكثير من غيره، وبقي من يأخذ مكانه أسرع منه. */
    fun victims(peers: List<Peer>, piece: Int, waitedMs: Long): List<String> {
        if (piece < 0 || waitedMs < WAIT_MS) return emptyList()
        val others = peers.filter { it.piece != piece && it.bytesPerSecond > 0 }.map { it.bytesPerSecond }.sorted()
        if (others.isEmpty()) return emptyList()
        val typical = others[others.size / 2]
        val fastest = others.last()
        return peers.asSequence()
            .filter { it.piece == piece && it.ip.isNotBlank() }
            .filter { it.bytesPerSecond < maxOf(SLOW_BPS, typical / 4) && fastest >= maxOf(it.bytesPerSecond * 3, SLOW_BPS) }
            .sortedBy { it.bytesPerSecond }
            .map { it.ip }.distinct().take(MAX_VICTIMS).toList()
    }
}

/** رقم الحلقة من اسم ملف في حزمة موسم. يتجاهل الدقة والترميز والسنة وبصمة CRC. null إن لم يُعرف بثقة. */
object EpisodeNames {
    private val noise = listOf(
        Regex("\\[[0-9A-Fa-f]{8}\\]"),                       // [ABCD1234] CRC
        Regex("(?i)\\b\\d{3,4}[pi]\\b"),                       // 1080p 720p
        Regex("(?i)\\b(?:[xh]\\.?26[45]|hevc|avc|aac\\d?(?:\\.\\d)?|ddp?\\d\\.\\d|10bit|8bit|\\d+ch)\\b"),
        Regex("(?i)\\b(?:19|20)\\d{2}\\b"),                      // السنة
        Regex("(?i)\\bv\\d\\b"),
    )
    private val patterns = listOf(
        Regex("(?i)\\bS\\d{1,2}[ ._-]*E(\\d{1,4})\\b"),
        Regex("(?i)\\b\\d{1,2}x(\\d{1,3})\\b"),
        Regex("(?i)\\b(?:EP?|Episode|Ep\\.)[ ._-]*(\\d{1,4})\\b"),
        Regex("(?:الحلقة|حلقة)[ ._-]*(\\d{1,4})"),
        Regex("\\s-\\s(\\d{1,4})(?:v\\d)?(?=[\\s._\\[(]|$)"),
        Regex("[\\[(](\\d{1,4})(?:v\\d)?[\\])]"),
        Regex("^(\\d{1,4})(?=[\\s._-])"),
    )
    fun episode(path: String): Int? {
        // TO6: التسمية اليابانية «第05話»
        japanese.find(path.substringAfterLast('/'))?.groupValues?.get(1)?.toIntOrNull()?.takeIf { it > 0 }?.let { return it }
        val name = cleaned(path)
        for (p in patterns) p.find(name)?.groupValues?.get(1)?.toIntOrNull()?.takeIf { it > 0 }?.let { return it }
        return null
    }

    private val japanese = Regex("第\\s*(\\d{1,4})\\s*[話话集]")
    private val specialMark = Regex("(?i)(?:^|[/ ._\\-\\[(])(?:s00|specials?|ova|oad|ncop\\d*|nced\\d*|creditless|recap|preview|pv|menu)(?:[/ ._\\-\\])]|$)")
    private val halfEpisode = Regex("(?<![\\d.])\\d{1,4}\\.5(?![\\d])")
    private val seasonMark = Regex("(?i)(?:\\bS(\\d{1,2})[ ._-]*E\\d{1,4}\\b|(?:^|/)(?:Season|S)[ ._]?(\\d{1,2})(?:/|$))")

    private fun cleaned(path: String): String {
        var name = path.substringAfterLast('/').substringBeforeLast('.').replace('_', ' ').replace('.', ' ')
        for (n in noise) name = name.replace(n, " ")
        return name
    }

    /** هوية ملف في حزمة: موسمه وحلقته، وهل هو خاص (S00، OVA، NCOP…) أو نصف حلقة (05.5 ملخّص). */
    data class Ident(val season: Int?, val episode: Int?, val special: Boolean, val fraction: Boolean)

    fun ident(path: String): Ident {
        val file = path.substringAfterLast('/').substringBeforeLast('.')
        val season = seasonMark.findAll(path).firstNotNullOfOrNull { m -> (m.groupValues[1].ifEmpty { m.groupValues[2] }).toIntOrNull() }
        return Ident(season, episode(path), specialMark.containsMatchIn(path) || season == 0, halfEpisode.containsMatchIn(file))
    }

    /**
     * الحزمة كلها معًا (TO2، TO5): حين لا تفرّق الأنماط بين الملفات («العنوان 005» بلا شرطة، أو «86 Eighty Six 05» يُقرأ 86
     * لكلها)، الرقم الذي يتغير بين ملفات الحزمة في الموضع نفسه هو رقم الحلقة.
     */
    fun pack(paths: List<String>): Map<String, Ident> {
        val ids = paths.associateWith(::ident)
        val regular = paths.filter { ids[it]?.let { id -> !id.special && !id.fraction } == true }
        if (regular.size < 2) return ids
        val distinct = regular.mapNotNull { ids[it]?.episode }.let { it.size == regular.size && it.toSet().size == it.size }
        if (distinct) return ids
        val tokens = regular.associateWith { p -> Regex("\\d{1,4}").findAll(cleaned(p)).map { it.value.toInt() }.toList() }
        val width = tokens.values.map { it.size }.distinct().singleOrNull() ?: return ids
        val varying = (0 until width).filter { i -> tokens.values.map { it[i] }.toSet().size == regular.size }
        val at = varying.lastOrNull() ?: return ids
        return ids + regular.associateWith { p -> ids[p]!!.copy(episode = tokens[p]!![at].takeIf { it > 0 }) }
    }
}

/**
 * الخيار B (قرار المالك 26 نوفمبر، Debug فقط): أول قطعة يقرؤها المشغّل بعد كل فتح (بدء أو قفزة) تُقرأ من كتلها المكتوبة
 * على القرص قبل اكتمال التحقق منها، فلا تنتظر قطعة 16MB كاملة (Reacher: أول 9KB بعد 7.1–7.3 ث). بقية القطع موثقة.
 *
 * ما يضمنه: البايتات من كتل أعلن libtorrent كتابتها (block_finished_alert يُطلق بعد نجاح الكتابة،
 * peer_connection::on_disk_write_complete)، متصلة من موضع القراءة، داخل القطعة. فشل تحقق قطعة قُرئ منها
 * (hash_failed_alert) يجعل التورنت موثقًا فقط ويعيد المشغّل تجهيز المصدر من بيانات موثقة.
 * ما لا يضمنه: أن البايتات صحيحة قبل التحقق. تصل إلى مستخرج Media3 في عملية التطبيق ثم المفكك (في عملية media
 * المعزولة من Android). التحقق اللاحق يكشف الخراب ولا يلغي أثر ما قُرئ قبله.
 * لا يمس: التحميلات الدائمة (تنتظر اكتمال libtorrent الموثق)، ولا الرفع للآخرين (libtorrent لا يرفع إلا قطعًا موثقة).
 */
object TurboRead {
    /** حجم كتلة libtorrent (default_block_size). */
    const val BLOCK_BYTES = 16 * 1024
    /** أقل عدد قطع مختلفة يحق لكل فتح أن يقرأ منها قبل التحقق: رأس الملف، وما بعد مرفقات MKV التي تُتخطى. */
    const val PIECES_PER_OPEN = 2
    /** سقف البايتات غير الموثقة لكل فتح، مهما كان حجم القطعة. */
    const val MAX_BYTES_PER_OPEN = 32L * 1024 * 1024
    /**
     * القطع المختلفة الأولى لكل فتح التي تُقرأ قبل التحقق: ما يملأ [MAX_BYTES_PER_OPEN] منها، وقطعتان على الأقل.
     * كانت قطعتين أيًّا كان حجمها: 32MB بقطع 16MB، و8MB فقط بقطع 4MB. تشخيص المالك (حلقة أنمي بقطع 4MB، بعد
     * استئناف بـ3 ث): «ينتظر القطعة 2442 منذ 2.9 ث (232/256 كتلة)» و«قُرئ 4.1MB» من سقف 32MB: الثالثة موثقة فوقف.
     */
    fun piecesPerOpen(pieceLength: Int): Int {
        if (pieceLength <= 0) return PIECES_PER_OPEN
        val fill = (MAX_BYTES_PER_OPEN + pieceLength - 1) / pieceLength
        return fill.coerceIn(PIECES_PER_OPEN.toLong(), 64L).toInt()
    }
    /** مفتاح التعطيل في «المزيد» بالمشغّل (Debug). في Stable مقفل بالكود. */
    const val PREF = "turboUnverified"

    /**
     * كم بايتًا متصلًا من [offset] (داخل قطعة حجمها [pieceSize]) كُتبت كتله كلها، بحد [length]. 0 إن لم تُكتب كتلة
     * [offset] بعد. لا يتجاوز كتلة غير مكتوبة ولا نهاية القطعة أبدًا (اختبار عشوائي في TorrentPolicyTest).
     */
    fun writtenSpan(written: java.util.BitSet?, offset: Int, length: Int, pieceSize: Int, block: Int = BLOCK_BYTES): Int {
        if (written == null || block <= 0 || pieceSize <= 0 || offset < 0 || length <= 0 || offset >= pieceSize) return 0
        val limit = minOf(pieceSize.toLong(), offset.toLong() + length)
        var end = offset.toLong()
        while (end < limit && written.get((end / block).toInt())) end = minOf((end / block + 1) * block, limit)
        return (end - offset).toInt()
    }

    /** رقم كتلة من تنبيه libtorrent صالح لقطعة بهذا الحجم (لا يُصدَّق تنبيه خارج حدودها). */
    fun validBlock(block: Int, pieceLength: Int, blockSize: Int = BLOCK_BYTES): Boolean =
        pieceLength > 0 && block >= 0 && block.toLong() * blockSize < pieceLength
}
