package com.vantara.anime

import com.vantara.anime.adapters.AnimeAdapter
import com.vantara.anime.adapters.Listing
import com.vantara.anime.adapters.SourceAnime

/** Streams search pages inside the caller's total timeout. */
object SearchPages {
    data class Page(val number: Int, val items: List<SourceAnime>, val hasNext: Boolean, val stop: String?)
    suspend fun walk(adapter: AnimeAdapter, query: String, maxPages: Int = 20, onPage: (Page) -> Unit) {
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
                number == maxPages -> "page_limit"
                else -> null
            }
            onPage(Page(number, fresh, page.hasNext, stop))
            if (stop != null) return
        }
    }
}
