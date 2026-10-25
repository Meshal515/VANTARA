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

    @Synchronized fun elements(): List<Element> = found.toList()
    @Synchronized fun skipped(count: Int) { skippedBytes += count }

    /** [count] بايت سُلّمت للمشغّل من [position] في الملف. */
    @Synchronized fun feed(position: Long, bytes: ByteArray, offset: Int, count: Int) {
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
            id == SEGMENT -> next = offset + header
            else -> {
                found += Element(id, offset, header, size)
                if (id == CLUSTER) { clusterAt = offset; done = true; return }
                if (size < 0 || found.size > 64) { done = true; return }
                if (id == ATTACHMENTS && size >= MIN_SKIP) skip = (offset + header) until (offset + header + size)
                next = offset + header + size
            }
        }
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
