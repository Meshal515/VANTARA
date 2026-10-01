package com.vantara.anime.registry

import kotlinx.serialization.Serializable
import org.jsoup.Jsoup
import java.net.URLEncoder
import okhttp3.HttpUrl.Companion.toHttpUrl

/** Declarative fallback for a changed extension search page. The extension still runs first. */
@Serializable
data class SearchPage(val urlTemplate: String, val cards: CardSelectors) {
    fun url(base: String, page: Int, query: String): String {
        val encoded = URLEncoder.encode(query, "UTF-8").replace("+", "%20")
        val path = urlTemplate.replace("{query}", encoded).replace("{page}", page.toString())
        return requireNotNull(base.toHttpUrl().resolve(path)).toString()
    }
}

@Serializable
data class PageDetails(
    val title: String? = null,
    val description: String? = null,
    val image: String? = null,
    val imageAttr: String = "src",
    val genres: String? = null,
) {
    data class Item(val title: String?, val description: String?, val image: String?, val genres: List<String>)
    fun extract(html: String, pageUrl: String): Item {
        val doc = Jsoup.parse(html, pageUrl)
        return Item(title?.let { doc.selectFirst(it)?.text()?.trim()?.ifBlank { null } },
            description?.let { doc.selectFirst(it)?.text()?.trim()?.ifBlank { null } },
            image?.let { doc.selectFirst(it)?.absUrl(imageAttr)?.ifBlank { null } },
            genres?.let { doc.select(it).map { e -> e.text() }.filter { it.isNotBlank() }.distinct() }.orEmpty())
    }
}
