package com.vantara.addons.torrent

/**
 * عناصر MKV العليا كما تمرّ في البايتات التي يسلّمها القارئ للمشغّل بالترتيب من بداية الملف.
 *
 * لماذا: مستخرج MKV في Media3 لا يعرف عنصر المرفقات (Attachments، خطوط الترجمة عادة) فيتخطاه
 * بـ skipFully، وهذا يقرأ كل بايتاته من المصدر. في تورنت يعني تنزيل ~15MB قبل أول صورة (قيس
 * على الجهاز: 14.5 و34.7 ث). المرفقات عنصر عُلوي محدد الحجم لا يفسّر Media3 محتواه، فإعطاؤه
 * أصفارًا بلا تنزيل لا يغيّر ما يراه المشغّل.
 *
 * لا قراءة إضافية: يحلل فقط رؤوس العناصر (≤12 بايت) من البايتات التي مرّت أصلًا.
 */
class MkvHead {
    data class Element(val id: Long, val offset: Long, val header: Int, val size: Long)

    private val found = ArrayList<Element>()
    private val pending = ByteArray(12)
    private var have = 0
    /** موضع رأس العنصر التالي في الملف. */
    private var next = 0L
    private var done = false
    /** محتوى المرفقات في الملف (يُعطى أصفارًا)، أو null. */
    @Volatile var skip: LongRange? = null; private set
    @Volatile var clusterAt = -1L; private set
    @Volatile var skippedBytes = 0L; private set
    /**
     * موضع عنصر Cues (فهرس القفز) في الملف كما يعلنه SeekHead، أو -1. من بايتات SeekHead التي مرّت أصلًا بالقارئ (لا قراءة
     * إضافية). المصدر الذي بدأ بلا فهرس (deferCues) يحتاجه عند أول قفزة، فيُجلب في الخلفية بعد أول صورة (TorrentEngine.fetchCues).
     */
    @Volatile var cuesAt = -1L; private set
    /** بداية بيانات Segment: SeekPosition نسبي إليها. */
    private var segmentData = -1L
    private var seekBody: ByteArray? = null
    private var seekFrom = 0L
    private var seekFilled = 0

    @Synchronized fun elements(): List<Element> = found.toList()
    @Synchronized fun skipped(count: Int) { skippedBytes += count }

    /** [count] بايت سُلّمت للمشغّل من [position] في الملف. */
    @Synchronized fun feed(position: Long, bytes: ByteArray, offset: Int, count: Int) {
        // رأس SeekHead ومحتواه في الدفعة نفسها غالبًا: الالتقاط بعد تحليل الرؤوس أيضًا (يعرف موضعه حينها)
        try { headers(position, bytes, offset, count) } finally { captureSeekHead(position, bytes, offset, count) }
    }

    private fun headers(position: Long, bytes: ByteArray, offset: Int, count: Int) {
        var at = position
        var from = offset
        var left = count
        while (!done && left > 0) {
            val want = next + have
            if (want < at || want >= at + left) {
                // بايتات لا تحمل الرأس المنتظر: قبله نتجاهلها، وبعده (قفزة) لم نعد نعرف الترتيب
                if (want < at && have > 0) done = true
                if (want < at && have == 0) done = true
                return
            }
            val skipIn = (want - at).toInt()
            at += skipIn; from += skipIn; left -= skipIn
            val take = minOf(left, pending.size - have)
            System.arraycopy(bytes, from, pending, have, take)
            have += take; at += take; from += take; left -= take
            val parsed = parse() ?: if (have == pending.size) { done = true; return } else continue
            val (id, header, size) = parsed
            // ما زاد عن الرأس من المأخوذ يعود ليُقرأ كرأس تالٍ إن وقع داخله
            val used = header
            val extra = have - used
            at -= extra; from -= extra; left += extra
            have = 0
            accept(id, next, header, size)
        }
    }

    private fun accept(id: Long, offset: Long, header: Int, size: Long) {
        if (offset == 0L && id != EBML) { done = true; return }
        when {
            id == EBML -> next = offset + header + size
            id == SEGMENT -> { next = offset + header; segmentData = offset + header }
            else -> {
                found += Element(id, offset, header, size)
                if (id == CLUSTER) { clusterAt = offset; done = true; return }
                if (size < 0 || found.size > 64) { done = true; return }
                if (id == ATTACHMENTS && size >= MIN_SKIP) skip = (offset + header) until (offset + header + size)
                // محتوى SeekHead يأتي بعد رأسه مباشرة في البايتات نفسها (يُلتقط في captureSeekHead)
                if (id == SEEK_HEAD && seekBody == null && size in 1..MAX_SEEK_HEAD) { seekBody = ByteArray(size.toInt()); seekFrom = offset + header; seekFilled = 0 }
                next = offset + header + size
            }
        }
    }

    /** ما يقع من [bytes] داخل محتوى SeekHead يُنسخ؛ حين يكتمل يُقرأ منه موضع Cues. بالترتيب فقط (قفزة تتركه ناقصًا). */
    private fun captureSeekHead(position: Long, bytes: ByteArray, offset: Int, count: Int) {
        val body = seekBody ?: return
        if (seekFilled >= body.size) return
        val want = seekFrom + seekFilled
        if (want < position || want >= position + count) return
        val take = minOf(body.size - seekFilled.toLong(), position + count - want).toInt()
        System.arraycopy(bytes, offset + (want - position).toInt(), body, seekFilled, take)
        seekFilled += take
        if (seekFilled == body.size && segmentData >= 0) cuesPosition(body)?.let { cuesAt = segmentData + it }
    }

    /** SeekPosition للعنصر Cues في محتوى SeekHead: Seek { SeekID, SeekPosition }، أو null. */
    private fun cuesPosition(body: ByteArray): Long? {
        var i = 0
        fun vint(keepMarker: Boolean): Pair<Long, Int>? {
            if (i >= body.size) return null
            val first = body[i].toInt() and 0xFF
            if (first == 0) return null
            val length = Integer.numberOfLeadingZeros(first) - 23
            if (length > 8 || i + length > body.size) return null
            var v = if (keepMarker) first.toLong() else (first and (0xFF shr length)).toLong()
            for (k in 1 until length) v = (v shl 8) or (body[i + k].toLong() and 0xFF)
            return v to length
        }
        while (i < body.size) {
            val (id, idLen) = vint(true) ?: return null
            i += idLen
            val (size, sizeLen) = vint(false) ?: return null
            i += sizeLen
            val end = i + size.toInt()
            if (size < 0 || end > body.size) return null
            if (id == SEEK) {
                var target = -1L
                var at = -1L
                while (i < end) {
                    val (cid, cl) = vint(true) ?: return null
                    i += cl
                    val (cs, csl) = vint(false) ?: return null
                    i += csl
                    if (cs < 0 || i + cs > end) return null
                    var v = 0L
                    for (k in 0 until cs.toInt()) v = (v shl 8) or (body[i + k].toLong() and 0xFF)
                    if (cid == SEEK_ID) target = v else if (cid == SEEK_POSITION) at = v
                    i += cs.toInt()
                }
                if (target == CUES && at >= 0) return at
            }
            i = end
        }
        return null
    }

    /** (المعرّف، طول الرأس، حجم المحتوى أو -1 إن كان مجهولًا) أو null إن لم تكتمل البايتات. */
    private fun parse(): Triple<Long, Int, Long>? {
        val idLength = vintLength(pending[0]) ?: run { done = true; return null }
        if (idLength > 4) { done = true; return null }
        if (have < idLength + 1) return null
        var id = 0L
        for (i in 0 until idLength) id = (id shl 8) or (pending[i].toLong() and 0xFF)
        val sizeLength = vintLength(pending[idLength]) ?: run { done = true; return null }
        if (have < idLength + sizeLength) return null
        var size = (pending[idLength].toLong() and 0xFF) and (0xFF shr sizeLength).toLong()
        var allOnes = size == (0xFF shr sizeLength).toLong()
        for (i in 1 until sizeLength) {
            val b = pending[idLength + i].toLong() and 0xFF
            size = (size shl 8) or b
            allOnes = allOnes && b == 0xFFL
        }
        return Triple(id, idLength + sizeLength, if (allOnes) -1L else size)
    }

    private fun vintLength(first: Byte): Int? {
        val b = first.toInt() and 0xFF
        if (b == 0) return null
        return Integer.numberOfLeadingZeros(b) - 23
    }

    /** للتشخيص: «SeekHead 4KB · Info 1KB · Attachments 15.4MB · Cluster عند 15.6MB». */
    @Synchronized fun describe(): String? {
        if (found.isEmpty()) return null
        return found.joinToString(" · ") { e ->
            val name = NAMES[e.id] ?: "0x" + java.lang.Long.toHexString(e.id).uppercase()
            if (e.id == CLUSTER) "$name عند ${size(e.offset)}" else "$name ${if (e.size < 0) "?" else size(e.size)}"
        }
    }

    companion object {
        const val EBML = 0x1A45DFA3L
        const val SEGMENT = 0x18538067L
        const val CLUSTER = 0x1F43B675L
        const val ATTACHMENTS = 0x1941A469L
        const val SEEK_HEAD = 0x114D9B74L
        const val SEEK = 0x4DBBL
        const val SEEK_ID = 0x53ABL
        const val SEEK_POSITION = 0x53ACL
        const val CUES = 0x1C53BB6BL
        /** SeekHead الحقيقي بضع عشرات من البايتات (79B في لقطات المالك)؛ أكبر من هذا لا يُلتقط. */
        private const val MAX_SEEK_HEAD = 64L * 1024
        /** أقل من هذا لا يستحق: يُنزَّل في ثوانٍ قليلة على أي حال. */
        const val MIN_SKIP = 512L * 1024
        private val NAMES = mapOf(
            0x114D9B74L to "SeekHead", 0x1549A966L to "Info", 0x1654AE6BL to "Tracks", 0x1043A770L to "Chapters",
            ATTACHMENTS to "Attachments", 0x1254C367L to "Tags", 0x1C53BB6BL to "Cues", CLUSTER to "Cluster",
            0xECL to "Void", 0xBFL to "CRC",
        )
        fun size(n: Long): String = when {
            n >= 1024L * 1024 -> String.format(java.util.Locale.ROOT, "%.1fMB", n / 1048576.0)
            n >= 1024 -> "${n / 1024}KB"
            else -> "${n}B"
        }
    }
}
