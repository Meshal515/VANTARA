package com.vantara.anime

import eu.kanade.tachiyomi.animesource.model.AnimeFilter
import eu.kanade.tachiyomi.animesource.model.AnimeFilterList
import eu.kanade.tachiyomi.animesource.model.AnimesPage
import eu.kanade.tachiyomi.animesource.model.SAnime
import kotlinx.coroutines.runBlocking
import okhttp3.Headers
import okhttp3.Request
import okhttp3.Response
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Owner request (13 Nov): the source catalogue has its genres. An Aniyomi extension declares them as a search filter
 * (Anime4Up: «التصنيف» Select); each becomes a tab, browsed as Aniyomi does: empty query with that one value selected.
 */
class AniyomiGenreTabsTest {
    private class GenreSelect : AnimeFilter.Select<String>("التصنيف", arrayOf("الكل", "أكشن", "مغامرة"))
    private class Tag(name: String) : AnimeFilter.CheckBox(name)
    private class Tags : AnimeFilter.Group<Tag>("Genres", listOf(Tag("Drama"), Tag("Comedy")))
    private class Order : AnimeFilter.Select<String>("الترتيب", arrayOf("الأحدث", "الأقدم"))

    private fun source(filters: () -> AnimeFilterList, seen: MutableList<Pair<String, AnimeFilterList>>) =
        object : eu.kanade.tachiyomi.animesource.online.AnimeHttpSource() {
            override val name = "Anime4Up"
            override val lang = "ar"
            override val supportsLatest = false
            override val baseUrl = "https://anime4up.test"
            override val client = okhttp3.OkHttpClient()
            override fun headersBuilder() = Headers.Builder()
            override fun getFilterList() = filters()
            override suspend fun getSearchAnime(page: Int, query: String, filters: AnimeFilterList): AnimesPage {
                seen += query to filters
                return AnimesPage(listOf(SAnime.create().apply { url = "/anime/x"; title = "x" }), false)
            }
            override fun popularAnimeRequest(page: Int) = Request.Builder().url(baseUrl).build()
            override fun searchAnimeRequest(page: Int, query: String, filters: AnimeFilterList) = popularAnimeRequest(page)
            override fun latestUpdatesRequest(page: Int) = popularAnimeRequest(page)
            override fun popularAnimeParse(response: Response) = AnimesPage(emptyList(), false)
            override fun searchAnimeParse(response: Response) = popularAnimeParse(response)
            override fun latestUpdatesParse(response: Response) = popularAnimeParse(response)
            override fun animeDetailsParse(response: Response) = SAnime.create()
            override fun episodeListParse(response: Response) = emptyList<eu.kanade.tachiyomi.animesource.model.SEpisode>()
            override fun seasonListParse(response: Response) = emptyList<SAnime>()
            override fun hosterListParse(response: Response) = emptyList<eu.kanade.tachiyomi.animesource.model.Hoster>()
        }

    @Test fun aSelectGenreFilterBecomesOneTabPerGenreBrowsedWithAnEmptyQuery() = runBlocking {
        val seen = mutableListOf<Pair<String, AnimeFilterList>>()
        val adapter = com.vantara.anime.adapters.ExtensionAdapter("a4u", source({ AnimeFilterList(Order(), GenreSelect()) }, seen))
        assertEquals(listOf("popular" to "الرائج", "section:0" to "أكشن", "section:1" to "مغامرة"),
            adapter.sections().map { it.key to it.name })
        assertEquals(1, adapter.section(1, 1).items.size)
        val (query, filters) = seen.single()
        assertEquals("", query)
        assertEquals("مغامرة selected on a fresh list; the order filter untouched", listOf(0, 2), filters.map { it.state })
    }

    @Test fun aGroupOfGenreCheckBoxesWorksTooAndSearchCarriesTheDefaultFilters() = runBlocking {
        val seen = mutableListOf<Pair<String, AnimeFilterList>>()
        val adapter = com.vantara.anime.adapters.ExtensionAdapter("a4u", source({ AnimeFilterList(Tags()) }, seen))
        assertEquals(listOf("Drama", "Comedy"), adapter.sections().drop(1).map { it.name })
        adapter.section(1, 1)
        @Suppress("UNCHECKED_CAST")
        assertEquals(listOf(false, true), (seen.single().second.single().state as List<Tag>).map { it.state })
        adapter.page(com.vantara.anime.adapters.Listing.SEARCH, 1, "naruto")
        assertEquals("search sends the extension's own default filters, as Aniyomi does", 1, seen.last().second.size)
    }
}
