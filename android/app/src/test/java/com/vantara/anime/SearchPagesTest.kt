package com.vantara.anime

import com.vantara.anime.adapters.*
import com.vantara.anime.stream.Candidate
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test
import java.io.IOException

class SearchPagesTest {
    private fun adapter(fetch: suspend (Int) -> SourcePage) = object : AnimeAdapter {
        override val id = "test"
        override val name = "Example"
        override suspend fun page(listing: Listing, page: Int, query: String) = fetch(page)
        override suspend fun details(anime: SourceAnime) = anime
        override suspend fun seasons(anime: SourceAnime) = emptyList<SourceAnime>()
        override suspend fun episodes(anime: SourceAnime) = emptyList<SourceEpisode>()
        override suspend fun candidates(episode: SourceEpisode, now: Long, trace: ResolveTrace?, enough: Int) = emptyList<Candidate>()
    }
    private fun item(n: Int) = SourceAnime("test", "/$n", "Work $n")

    @Test fun `search streams later pages without waiting to expose page one`() = runBlocking {
        val results = mutableListOf<SearchPages.Page>()
        SearchPages.walk(adapter { p ->
            if (p == 2) assertEquals(listOf("/1"), results.flatMap { it.items }.map { it.url })
            SourcePage(listOf(item(p)), p < 3)
        }, "Work", onPage = { results.add(it) })
        assertEquals(listOf("/1", "/2", "/3"), results.flatMap { it.items }.map { it.url })
        assertEquals("exhausted", results.last().stop)
    }

    @Test fun `a looping provider is bounded and duplicate results are not published twice`() = runBlocking {
        val results = mutableListOf<SearchPages.Page>()
        SearchPages.walk(adapter { SourcePage(listOf(item(1)), true) }, "Work", onPage = { results.add(it) })
        assertEquals(listOf("/1"), results.flatMap { it.items }.map { it.url })
        assertEquals("repeated_page", results.last().stop)
    }

    @Test fun `a later page error retains the original exception and already streamed results`() = runBlocking {
        val original = IOException("upstream failure", IllegalStateException("parser stage"))
        val results = mutableListOf<SearchPages.Page>()
        try {
            SearchPages.walk(adapter { p -> if (p == 2) throw original else SourcePage(listOf(item(1)), true) }, "Work", onPage = { results.add(it) })
            fail("page two must be requested")
        } catch (error: IOException) { assertSame(original, error) }
        assertEquals(listOf("/1"), results.flatMap { it.items }.map { it.url })
    }

    @Test fun `a page limit is explicit instead of claiming the search was exhaustive`() = runBlocking {
        val results = mutableListOf<SearchPages.Page>()
        SearchPages.walk(adapter { p -> SourcePage(listOf(item(p)), true) }, "Work", maxPages = 2, onPage = { results.add(it) })
        assertEquals(listOf("/1", "/2"), results.flatMap { it.items }.map { it.url })
        assertEquals("page_limit", results.last().stop)
        assertTrue(results.last().hasNext)
    }
}
