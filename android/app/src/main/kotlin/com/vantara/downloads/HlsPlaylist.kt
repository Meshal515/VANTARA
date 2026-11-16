package com.vantara.downloads

import java.net.URI

/**
 * قارئ قوائم HLS للحفظ على الجهاز: يفهم ما يلزم لنسخة محلية تعمل بلا اتصال، لا أكثر.
 *
 * - القائمة الرئيسية: أفضل نسخة فيديو (بالدقة المطلوبة أو أعلاها)، ومسارات الصوت والترجمة
 *   المرتبطة بمجموعتها كما هي (كل اللغات): لا تُحذف مسارات صوت أو ترجمات.
 * - قائمة المقاطع: المقاطع بترتيبها، ومقطع التهيئة (EXT-X-MAP)، ومفاتيح AES-128 القياسية.
 * - الحماية: SAMPLE-AES أو أي KEYFORMAT غير identity (Widevine/FairPlay/PlayReady) = محتوى محمي
 *   يُرفض تنزيله صراحة. لا محاولة لتجاوزه.
 */
object HlsPlaylist {

    data class Variant(val uri: String, val bandwidth: Long, val height: Int?, val codecs: String?, val audioGroup: String?, val subtitleGroup: String?)

    data class Rendition(val type: String, val uri: String?, val groupId: String, val language: String?, val name: String?, val default: Boolean)

    data class Master(val variants: List<Variant>, val renditions: List<Rendition>)

    data class Key(val method: String, val uri: String?, val iv: String?, val keyFormat: String?)

    /** [sequence]: رقم المقطع في القائمة الأصلية (MEDIA-SEQUENCE + ترتيبه)، وهو IV مفتاح AES-128 الضمني. */
    data class Segment(val uri: String, val duration: Double, val key: Key?, val byteRange: String?, val map: String?, val mapByteRange: String?,
                       val sequence: Long = 0, val discontinuity: Boolean = false)

    data class Media(val segments: List<Segment>, val targetDuration: Int, val version: Int, val endList: Boolean, val drm: Boolean, val mediaSequence: Long = 0) {
        val duration: Double get() = segments.sumOf { it.duration }
    }

    fun isMaster(text: String): Boolean = text.lineSequence().any { it.startsWith("#EXT-X-STREAM-INF") }

    /** القيم داخل سطر الوسوم: KEY=VALUE أو KEY="VALUE, مع فواصل". */
    fun attributes(line: String): Map<String, String> {
        val body = line.substringAfter(':', "")
        val out = LinkedHashMap<String, String>()
        var i = 0
        while (i < body.length) {
            val eq = body.indexOf('=', i)
            if (eq < 0) break
            val key = body.substring(i, eq).trim()
            var j = eq + 1
            val value: String
            if (j < body.length && body[j] == '"') {
                val end = body.indexOf('"', j + 1).let { if (it < 0) body.length else it }
                value = body.substring(j + 1, end)
                j = end + 1
            } else {
                val end = body.indexOf(',', j).let { if (it < 0) body.length else it }
                value = body.substring(j, end).trim()
                j = end
            }
            out[key.uppercase()] = value
            i = if (j < body.length && body[j] == ',') j + 1 else j
        }
        return out
    }

    fun resolve(base: String, ref: String): String = runCatching { URI(base).resolve(ref.trim()).toString() }.getOrDefault(ref)

    fun parseMaster(text: String, base: String): Master {
        val variants = mutableListOf<Variant>()
        val renditions = mutableListOf<Rendition>()
        var pending: Map<String, String>? = null
        for (raw in text.lineSequence()) {
            val line = raw.trim()
            when {
                line.startsWith("#EXT-X-STREAM-INF") -> pending = attributes(line)
                line.startsWith("#EXT-X-MEDIA:") -> {
                    val a = attributes(line)
                    renditions += Rendition(
                        type = a["TYPE"].orEmpty().uppercase(),
                        uri = a["URI"]?.let { resolve(base, it) },
                        groupId = a["GROUP-ID"].orEmpty(),
                        language = a["LANGUAGE"],
                        name = a["NAME"],
                        default = a["DEFAULT"].equals("YES", true),
                    )
                }
                line.isNotEmpty() && !line.startsWith("#") && pending != null -> {
                    val a = pending
                    val height = a["RESOLUTION"]?.substringAfter('x')?.toIntOrNull()
                    variants += Variant(resolve(base, line), a["BANDWIDTH"]?.toLongOrNull() ?: 0, height, a["CODECS"], a["AUDIO"], a["SUBTITLES"])
                    pending = null
                }
            }
        }
        return Master(variants, renditions)
    }

    /**
     * النسخة المحفوظة: أقرب دقة للمطلوبة دون تجاوزها، وإن كانت كل النسخ أعلى منها فأدناها. التعادل لأعلى معدل بت
     * (الجودة الحقيقية لا اسمها). null = أعلى المتاح.
     */
    fun chooseVariant(master: Master, preferredHeight: Int?): Variant? {
        if (master.variants.isEmpty()) return null
        val byQuality = compareBy<Variant>({ it.height ?: 0 }, { it.bandwidth })
        if (preferredHeight == null || preferredHeight <= 0) return master.variants.maxWithOrNull(byQuality)
        val fitting = master.variants.filter { (it.height ?: 0) in 1..preferredHeight }
        return fitting.maxWithOrNull(byQuality) ?: master.variants.minWithOrNull(byQuality)
    }

    fun parseMedia(text: String, base: String): Media {
        val segments = mutableListOf<Segment>()
        var duration = 0.0
        var key: Key? = null
        var range: String? = null
        var map: String? = null
        var mapRange: String? = null
        var target = 0
        var version = 3
        var end = false
        var drm = false
        var firstSequence = 0L
        var discontinuity = false
        for (raw in text.lineSequence()) {
            val line = raw.trim()
            when {
                line.startsWith("#EXT-X-MEDIA-SEQUENCE:") -> firstSequence = line.substringAfter(':').trim().toLongOrNull()?.coerceAtLeast(0) ?: 0
                line.startsWith("#EXT-X-DISCONTINUITY") && !line.startsWith("#EXT-X-DISCONTINUITY-SEQUENCE") -> discontinuity = true
                line.startsWith("#EXTINF:") -> duration = line.removePrefix("#EXTINF:").substringBefore(',').trim().toDoubleOrNull() ?: 0.0
                line.startsWith("#EXT-X-TARGETDURATION:") -> target = line.substringAfter(':').trim().toIntOrNull() ?: 0
                line.startsWith("#EXT-X-VERSION:") -> version = line.substringAfter(':').trim().toIntOrNull() ?: 3
                line.startsWith("#EXT-X-ENDLIST") -> end = true
                line.startsWith("#EXT-X-BYTERANGE:") -> range = line.substringAfter(':').trim()
                line.startsWith("#EXT-X-MAP:") -> {
                    val a = attributes(line)
                    map = a["URI"]?.let { resolve(base, it) }
                    mapRange = a["BYTERANGE"]
                }
                line.startsWith("#EXT-X-KEY:") || line.startsWith("#EXT-X-SESSION-KEY:") -> {
                    val a = attributes(line)
                    val method = a["METHOD"].orEmpty().uppercase()
                    val format = a["KEYFORMAT"]
                    if (method == "SAMPLE-AES" || method == "SAMPLE-AES-CTR" || (format != null && !format.equals("identity", true))) drm = true
                    key = if (method == "NONE" || method.isEmpty()) null else Key(method, a["URI"]?.let { resolve(base, it) }, a["IV"], format)
                }
                line.isNotEmpty() && !line.startsWith("#") -> {
                    segments += Segment(resolve(base, line), duration, key, range, map, mapRange, firstSequence + segments.size, discontinuity)
                    duration = 0.0
                    range = null
                    discontinuity = false
                }
            }
        }
        return Media(segments, target, version, end, drm, firstSequence)
    }

    /**
     * قائمة مقاطع محلية: نفس الوسوم والمدد، والروابط أسماء ملفات نسبية في مجلد العنصر.
     * المقاطع ذات BYTERANGE تُحفظ كل واحد في ملفه، فيسقط الوسم في النسخة المحلية.
     */
    fun localMedia(media: Media, segmentName: (Int) -> String, keyName: (Key) -> String?, mapName: (String) -> String): String {
        val out = StringBuilder()
        out.append("#EXTM3U\n#EXT-X-VERSION:").append(maxOf(media.version, 3)).append('\n')
        out.append("#EXT-X-TARGETDURATION:").append(maxOf(media.targetDuration, kotlin.math.ceil(media.segments.maxOfOrNull { it.duration } ?: 1.0).toInt())).append('\n')
        out.append("#EXT-X-MEDIA-SEQUENCE:0\n#EXT-X-PLAYLIST-TYPE:VOD\n")
        var lastKey: Key? = null
        var lastMap: String? = null
        for ((i, s) in media.segments.withIndex()) {
            if (s.discontinuity) out.append("#EXT-X-DISCONTINUITY\n")
            // المفتاح بلا IV: IV الضمني رقم المقطع في الأصل، والقائمة المحلية تبدأ من 0؛ فيُكتب صريحًا لكل مقطع (HL1)
            val implicitIv = s.key != null && s.key.iv == null && s.key.method == "AES-128"
            if (s.key != lastKey || implicitIv) {
                val k = s.key
                if (k == null) out.append("#EXT-X-KEY:METHOD=NONE\n")
                else {
                    out.append("#EXT-X-KEY:METHOD=").append(k.method)
                    keyName(k)?.let { out.append(",URI=\"").append(it).append('"') }
                    (k.iv ?: if (implicitIv) "0x%032X".format(s.sequence) else null)?.let { out.append(",IV=").append(it) }
                    out.append('\n')
                }
                lastKey = k
            }
            if (s.map != null && s.map != lastMap) {
                out.append("#EXT-X-MAP:URI=\"").append(mapName(s.map + "|" + (s.mapByteRange ?: ""))).append("\"\n")
                lastMap = s.map
            }
            out.append("#EXTINF:").append(String.format(java.util.Locale.ROOT, "%.3f", s.duration)).append(",\n")
            out.append(segmentName(i)).append('\n')
        }
        out.append("#EXT-X-ENDLIST\n")
        return out.toString()
    }

    /** «length@offset» إلى مدى Range، مع آخر إزاحة لنفس الملف حين يغيب offset. */
    fun byteRange(spec: String?, previousEnd: Long): LongRange? {
        if (spec.isNullOrBlank()) return null
        val length = spec.substringBefore('@').trim().toLongOrNull() ?: return null
        val offset = if ('@' in spec) spec.substringAfter('@').trim().toLongOrNull() ?: return null else previousEnd
        return offset until offset + length
    }
}
