package com.vantara.anime.adapters

import org.jsoup.Jsoup
import org.jsoup.nodes.Element
import java.net.URI
import java.util.Base64

/** Exact title/type/year grouping. Unknown years never join across distinct works. */
object CinemaTitles {
    private val yearPattern = Regex("\\b((?:19|20)\\d{2})\\b")
    fun year(title: String): Int? = yearPattern.find(title)?.value?.toIntOrNull()
    fun type(title: String, path: String): String? = when {
        title.trim().startsWith("فيلم") -> "movie"
        title.trim().startsWith("مسلسل") || title.trim().startsWith("برنامج") || Regex("/(series|serie|season|episode)/").containsMatchIn(path) -> "series"
        else -> null
    }
    fun canonical(raw: String): String = raw.trim()
        .replace(Regex("^جميع مواسم\\s+"), "")
        .replace(Regex("^(?:مشاهدة\\s+)?(?:فيلم|مسلسل|برنامج)\\s+"), "")
        .replace(Regex("^الموسم\\s+\\d+\\s+(?:مسلسل\\s+)?"), "")
        .replace(Regex("\\s+(?:الموسم|الحلقة)\\s+(?:\\d+|الأول|الاول|الثاني|الثالث|الرابع|الخامس|السادس|السابع|الثامن|التاسع|العاشر).*$"), "")
        .replace(Regex("\\s+(?:مترجم|مدبلج|كامل|اون\\s+لاين|أون\\s+لاين|اونلاين|مشاهدة|بجودة).*$"), "")
        .replace(Regex("\\s+(?:1080p|720p|480p|2160p|BluRay|WEB[- ]?DL|WEB|HD|CAM|HDTS)\\b.*$", RegexOption.IGNORE_CASE), "")
        .replace(Regex("\\s+(?:19|20)\\d{2}$"), "").trim()
    private fun normalized(title: String) = canonical(title).lowercase().replace(Regex("\\s+"), " ").trim()
    fun same(a: SourceAnime, b: SourceAnime): Boolean =
        a.mediaType != null && a.mediaType == b.mediaType && a.year != null && a.year == b.year &&
            normalized(a.title) == normalized(b.title)
    fun key(a: SourceAnime) = "cinema:${a.mediaType}:${a.year}:${normalized(a.title)}" +
        if (a.year == null || a.mediaType == null) ":${a.sourceId}:${a.url}" else ""
}

internal fun sourcePath(url: String): String = runCatching {
    val u = URI(url); (u.rawPath ?: "/") + (u.rawQuery?.let { "?$it" } ?: "")
}.getOrDefault(url)
private fun Element.image(): String? = selectFirst("img")?.let { it.absUrl("data-src").ifBlank { it.absUrl("src") }.ifBlank { null } }
private fun Element.label(): String = attr("title").ifBlank { selectFirst("h2.title, h3, h1.BottomTitle")?.text().orEmpty() }.ifBlank { text() }.trim()
private fun safeHttp(raw: String): String? = runCatching { URI(raw.trim()).takeIf { it.scheme in setOf("http", "https") && it.host != null }?.toString() }.getOrNull()

object TuktukParser {
    fun cards(html: String, pageUrl: String, id: String): List<SourceAnime> = Jsoup.parse(html, pageUrl)
        .select("div.Block--Item > a[title], div.Small--Box a[title]").mapNotNull { a ->
            val url = a.absUrl("href").ifBlank { return@mapNotNull null }
            val raw = a.label().ifBlank { return@mapNotNull null }
            val type = CinemaTitles.type(raw, url) ?: return@mapNotNull null
            SourceAnime(id, sourcePath(url), CinemaTitles.canonical(raw), a.image(), hasSeasons = type == "series", mediaType = type, year = CinemaTitles.year(raw))
        }.distinctBy { it.url }
    fun hasNext(html: String, pageUrl: String): Boolean = Jsoup.parse(html, pageUrl).select("div.pagination a.next, div.pagination a").any { it.hasClass("next") || it.text().trim() in setOf("»", "›") }
    fun seriesRoot(html: String, pageUrl: String): String? = Jsoup.parse(html, pageUrl)
        .select("#mpbreadcrumbs a[href*=/series/]")
        .firstOrNull { (it.text().startsWith("مسلسل") || it.text().startsWith("برنامج")) && !it.text().contains("الموسم") }
        ?.absUrl("href")?.ifBlank { null }?.let(::sourcePath)
    fun details(html: String, pageUrl: String, fallback: SourceAnime): SourceAnime {
        val doc = Jsoup.parse(html, pageUrl)
        val raw = doc.selectFirst("h1.post-title")?.text().orEmpty().ifBlank { fallback.title }
        val type = CinemaTitles.type(raw, fallback.url) ?: fallback.mediaType
        val year = doc.select("ul.RightTaxContent a[href*=/release-year/]").firstNotNullOfOrNull { CinemaTitles.year(it.text()) } ?: CinemaTitles.year(raw) ?: fallback.year
        return fallback.copy(title = CinemaTitles.canonical(raw), thumbnail = doc.selectFirst("div.left div.image")?.image() ?: fallback.thumbnail,
            description = doc.selectFirst("div.story")?.text()?.ifBlank { null } ?: fallback.description,
            genres = doc.select("div.catssection li a").map { it.text() }.distinct(), hasSeasons = type == "series", mediaType = type, year = year)
    }
    fun seasons(html: String, pageUrl: String, anime: SourceAnime): List<SourceAnime> = Jsoup.parse(html, pageUrl)
        .select("section.SeriesSeasons div.Block--Item > a, section.allseasonss div.Block--Item > a").mapNotNull { a ->
            val href = a.absUrl("href").ifBlank { return@mapNotNull null }
            val n = Regex("الموسم\\s*(\\d+)").find(a.label())?.groupValues?.get(1)?.toDoubleOrNull() ?: return@mapNotNull null
            anime.copy(url = sourcePath(href), title = anime.title, thumbnail = a.image() ?: anime.thumbnail, hasSeasons = false, seasonNumber = n, mediaType = "series")
        }.distinctBy { it.seasonNumber }.sortedBy { it.seasonNumber }
    fun episodes(html: String, pageUrl: String, anime: SourceAnime): List<SourceEpisode> {
        if (anime.mediaType == "movie") return listOf(SourceEpisode(anime.sourceId, anime.url, "مشاهدة", 1f))
        return Jsoup.parse(html, pageUrl).select("section.SeriesEpisodes a.SeriesEpisodeCard, div.episodes--list--side > a").mapNotNull { a ->
            val href = a.absUrl("href").ifBlank { return@mapNotNull null }
            val n = a.selectFirst(".SeriesEpisodeNumber strong, em")?.text()?.trim()?.toFloatOrNull()
                ?: Regex("الحلقة\\s*(\\d+)").find(a.label())?.groupValues?.get(1)?.toFloatOrNull() ?: return@mapNotNull null
            SourceEpisode(anime.sourceId, sourcePath(href), "الحلقة ${n.toInt()}", n)
        }.distinctBy { it.url }.sortedBy { it.number }
    }
    fun embeds(html: String, pageUrl: String): List<String> {
        val doc = Jsoup.parse(html, pageUrl)
        fun decode(raw: String): String? = runCatching { safeHttp(String(Base64.getDecoder().decode(raw.trim()), Charsets.UTF_8)) }.getOrNull()
        val encrypted = doc.select("iframe#main-video-frame[data-crypt]").mapNotNull { decode(it.attr("data-crypt")) }
        val servers = doc.select("li.server--item[data-link]").mapNotNull { decode(it.attr("data-link").substringBefore("0REL0Y").reversed()) }
        return (encrypted + servers).distinct()
    }
}

object EgyDeadParser {
    fun cards(html: String, pageUrl: String, id: String): List<SourceAnime> = Jsoup.parse(html, pageUrl).select("li.movieItem").mapNotNull { card ->
        val a = card.selectFirst("a[href]") ?: return@mapNotNull null
        val href = a.absUrl("href").ifBlank { return@mapNotNull null }
        val raw = card.selectFirst("h1.BottomTitle")?.text().orEmpty().ifBlank { a.label() }.ifBlank { return@mapNotNull null }
        val type = CinemaTitles.type(raw, href) ?: if (!href.contains("/assembly/")) "movie" else return@mapNotNull null
        SourceAnime(id, sourcePath(href), CinemaTitles.canonical(raw), card.image(), hasSeasons = type == "series", mediaType = type, year = CinemaTitles.year(raw))
    }.distinctBy { it.url }
    fun details(html: String, pageUrl: String, fallback: SourceAnime): SourceAnime {
        val doc = Jsoup.parse(html, pageUrl)
        val raw = doc.selectFirst("div.infoBox div.singleTitle")?.text().orEmpty().ifBlank { fallback.title }
        val type = CinemaTitles.type(raw, fallback.url) ?: fallback.mediaType
        return fallback.copy(title = CinemaTitles.canonical(raw), thumbnail = doc.selectFirst("div.single-thumbnail")?.image() ?: fallback.thumbnail,
            description = doc.selectFirst("div.infoBox div.extra-content p")?.text()?.ifBlank { null } ?: fallback.description,
            genres = doc.select("div.LeftBox li:contains(النوع) a").map { it.text() },
            year = CinemaTitles.year(raw) ?: doc.select("div.LeftBox li:contains(السنه) a").firstNotNullOfOrNull { CinemaTitles.year(it.text()) } ?: fallback.year,
            mediaType = type, hasSeasons = type == "series")
    }
    fun seriesRoot(html: String, pageUrl: String): String? = Jsoup.parse(html, pageUrl).select("#breadcrumbs a[href*=/serie/]").firstOrNull()?.absUrl("href")?.let(::sourcePath)
    fun seasons(html: String, pageUrl: String, anime: SourceAnime): List<SourceAnime> = Jsoup.parse(html, pageUrl).select("div.seasons-list li.movieItem a[href]").mapNotNull { a ->
        val href = a.absUrl("href").ifBlank { return@mapNotNull null }
        val n = Regex("[sS]0?(\\d+)(?:/|$)").find(href)?.groupValues?.get(1)?.toDoubleOrNull()
            ?: Regex("الموسم\\s*(\\d+)").find(a.label())?.groupValues?.get(1)?.toDoubleOrNull() ?: return@mapNotNull null
        anime.copy(url = sourcePath(href), seasonNumber = n, hasSeasons = false, mediaType = "series")
    }.distinctBy { it.seasonNumber }.sortedBy { it.seasonNumber }
    fun episodes(html: String, pageUrl: String, anime: SourceAnime): List<SourceEpisode> {
        if (anime.mediaType == "movie") return listOf(SourceEpisode(anime.sourceId, anime.url, "مشاهدة", 1f))
        return Jsoup.parse(html, pageUrl).select("div.EpsList li a[href]").mapNotNull { a ->
            val href = a.absUrl("href").ifBlank { return@mapNotNull null }
            val n = Regex("[eE]0?(\\d+)(?:/|$)").find(href)?.groupValues?.get(1)?.toFloatOrNull()
                ?: Regex("\\d+").find(a.text())?.value?.toFloatOrNull() ?: return@mapNotNull null
            SourceEpisode(anime.sourceId, sourcePath(href), "الحلقة ${n.toInt()}", n)
        }.distinctBy { it.url }.sortedBy { it.number }
    }
    fun embeds(html: String, pageUrl: String): List<String> = Jsoup.parse(html, pageUrl).select("ul.serversList li[data-link], .mob-servers li[data-link]").mapNotNull { safeHttp(it.attr("data-link")) }.distinct()
}
