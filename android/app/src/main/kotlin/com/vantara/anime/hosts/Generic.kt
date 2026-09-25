package com.vantara.anime.hosts

import org.jsoup.Jsoup

/**
 * فك `eval(function(p,a,c,k,e,d){…}('…',a,c,'…'.split('|')))` نصيًّا: استبدال كل
 * كلمة بمقابلها من القاموس بعد قراءتها بأساس [a]. لا يُنفَّذ أي JavaScript.
 * streamruby، earnvids، lulustream، mixdrop وعائلة streamwish تخبّئ رابط m3u8/mp4 هكذا.
 */
object Packer {
    private val PACKED = Regex("""\}\('(.*?)',\s*(\d+),\s*(\d+),\s*'(.*?)'\.split\('\|'\)""", RegexOption.DOT_MATCHES_ALL)
    private val WORD = Regex("""\b\w+\b""")
    private const val ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"

    fun unpackAll(source: String): List<String> = PACKED.findAll(source).mapNotNull { m ->
        val payload = m.groupValues[1].replace("\\'", "'")
        val base = m.groupValues[2].toIntOrNull() ?: return@mapNotNull null
        val words = m.groupValues[4].split('|')
        if (base !in 2..62) return@mapNotNull null
        WORD.replace(payload) { w ->
            val i = unbase(w.value, base)
            if (i != null && i < words.size && words[i].isNotEmpty()) words[i] else w.value
        }
    }.toList()

    private fun unbase(s: String, base: Int): Int? {
        var n = 0L
        for (ch in s) {
            val d = ALPHABET.indexOf(ch)
            if (d < 0 || d >= base) return null
            n = n * base + d
            if (n > Int.MAX_VALUE) return null
        }
        return n.toInt()
    }
}

/**
 * رابط الفيديو من صفحة المشغّل نفسها، بلا متصفح: HTML الصفحة + كل كتلة مضغوطة
 * بعد فكها ← روابط m3u8/mp4، و`<video>`/`<source>`. مجرّب على صفحات حقيقية:
 * mp4upload (`player.src({src:"…/video.mp4"})`)، streamruby وearnvids وlulustream
 * (m3u8 داخل كتلة مضغوطة)، mixdrop (`//…mp4`)، krakenfiles و4shared (`<source>`).
 */
object Generic {
    // الامتداد يجب أن ينهي المسار: «www.mp4upload.com» ليس ملف mp4
    private val MEDIA = Regex("""(?:https?:)?//[^\s"'<>\\]+?\.(?:m3u8|mp4)(?=[?#"'\s<>\\,)]|$)(?:\?[^\s"'<>\\]*)?""")
    private val NOISE = Regex("""/(ads?|vast|preroll|banner)/|[?&](ad|vast)=|\.(jpg|jpeg|png|webp|gif)(\?|$)""", RegexOption.IGNORE_CASE)

    fun streams(html: String, pageUrl: String): List<String> {
        val texts = listOf(html) + Packer.unpackAll(html)
        val found = LinkedHashSet<String>()
        for (t in texts) {
            MEDIA.findAll(t.replace("\\/", "/")).forEach { found += absolute(it.value, pageUrl) }
        }
        runCatching {
            Jsoup.parse(html, pageUrl).select("video[src], video source[src], source[type^=video][src]").forEach { el ->
                el.absUrl("src").takeIf { it.startsWith("http") }?.let { found += it }
            }
        }
        return found.filter { it.startsWith("http") && !NOISE.containsMatchIn(it) }
            // قائمة HLS الرئيسية أولًا (تحمل كل الجودات)، ثم الملفات
            .sortedBy { if (it.contains(".m3u8")) 0 else 1 }
    }

    private fun absolute(u: String, pageUrl: String): String = when {
        u.startsWith("//") -> "https:$u"
        else -> u
    }.let { if (it.startsWith("http")) it else runCatching { java.net.URI(pageUrl).resolve(it).toString() }.getOrDefault(it) }
}
