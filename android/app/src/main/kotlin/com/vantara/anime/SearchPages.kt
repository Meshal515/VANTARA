package com.vantara.anime

import com.vantara.anime.adapters.AnimeAdapter
import com.vantara.anime.adapters.Listing
import com.vantara.anime.adapters.SourceAnime

/**
 * Streams search pages inside the caller's total timeout.
 *
 * The general search asks every source with every name of a work. Walking 20 pages per name per source (3 Nov)
 * turned one opened work into hundreds of requests: sites answered with Cloudflare challenges and 429s, the health
 * store cooled the source, and the general card reported it missing while its own page (one request) worked.
 * [enough] ends the walk as soon as a page already holds what the caller looks for.
 */
object SearchPages {
    data class Page(val number: Int, val items: List<SourceAnime>, val hasNext: Boolean, val stop: String?)

    /** Pages for one name in the general search: the work is on the first pages of a site's search or not at all. */
    const val GENERAL_SEARCH_PAGES = 3

    /** Every word of the query appears in the title (case, accents and punctuation ignored). */
    fun covers(query: String, title: String): Boolean {
        val norm = { s: String -> java.text.Normalizer.normalize(s.lowercase(), java.text.Normalizer.Form.NFKD).replace(Regex("\\p{M}+"), "").split(Regex("[^\\p{L}\\p{N}]+")).filter { it.isNotBlank() } }
        val want = norm(query)
        if (want.isEmpty()) return false
        val have = norm(title).toHashSet()
        return want.all { it in have }
    }

    suspend fun walk(
        adapter: AnimeAdapter,
        query: String,
        maxPages: Int = 20,
        enough: (List<SourceAnime>) -> Boolean = { false },
        onPage: (Page) -> Unit,
    ) {
        require(maxPages in 1..100)
        val seen = HashSet<String>()
        val pages = HashSet<List<String>>()
        for (number in 1..maxPages) {
            val page = adapter.page(Listing.SEARCH, number, query)
            val repeated = !pages.add(page.items.map { it.url }.sorted())
            val fresh = page.items.filter { seen.add(it.url) }
            val stop = when {
                page.items.isEmpty() -> "empty_page"
                repeated -> "repeated_page"
                !page.hasNext -> "exhausted"
                enough(page.items) -> "found"
                number == maxPages -> "page_limit"
                else -> null
            }
            onPage(Page(number, fresh, page.hasNext, stop))
            if (stop != null) return
        }
    }
}
