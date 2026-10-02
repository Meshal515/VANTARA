package com.vantara.anime.adapters

import okhttp3.HttpUrl.Companion.toHttpUrl

/**
 * بطاقات بحث مواقع السينما العربية (ArabSeed، TukTuk…): كلها تنشر المسلسل
 * حلقةً حلقة («مسلسل X الموسم الثاني الحلقة 8 …»). تُجمع حلقات الموسم الواحد
 * في عمل واحد «مسلسل X الموسم الثاني» رابطه أول حلقة ظهرت (صفحتها تسرد حلقات
 * الموسم كلها)، والفيلم يبقى كما هو.
 */
internal object SiteCards {
    data class Card(val href: String, val title: String, val thumb: String?)

    private val EPISODE = Regex("""\s*(?:الحلقة|حلقة)\s*(\d+(?:\.\d+)?).*$""")
    private val SERIES = Regex("""(^|\s)(مسلسل|برنامج|انمي|أنمي|الموسم|الحلقة)(\s|$)""")

    fun kindOf(title: String): String = if (SERIES.containsMatchIn(title)) "series" else "movie"

    fun episodeNumber(title: String): Float? = EPISODE.find(title)?.groupValues?.get(1)?.toFloatOrNull()

    /** المسار (مع الاستعلام): يبقى صالحًا إن تغيّر دومين المصدر. */
    fun pathOf(href: String): String? = runCatching {
        href.toHttpUrl().let { u -> u.encodedPath + (u.encodedQuery?.let { "?$it" } ?: "") }
    }.getOrNull()

    fun fold(cards: List<Card>, sourceId: String): List<SourceAnime> {
        val seen = LinkedHashMap<String, SourceAnime>()
        for (c in cards) {
            val raw = c.title.trim()
            val path = pathOf(c.href) ?: continue
            if (raw.isBlank()) continue
            val series = kindOf(raw) == "series"
            val title = if (series) raw.replace(EPISODE, "").trim().ifBlank { raw } else raw
            val key = if (series) title else path
            if (key !in seen) seen[key] = SourceAnime(sourceId, path, title, c.thumb)
        }
        return seen.values.toList()
    }
}
