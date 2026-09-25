package com.vantara.anime

import com.vantara.anime.adapters.SourceAnime
import com.vantara.anime.adapters.SourcePage
import com.vantara.anime.catalog.CatalogCrawler
import com.vantara.anime.catalog.CatalogStore
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.IOException
import java.nio.file.Files

class CatalogCrawlerTest {

    private fun item(i: Int) = SourceAnime("s", "/a/$i", "Anime $i")
    private fun store() = CatalogStore(Files.createTempDirectory("cat").toFile())
    private val crawler get() = CatalogCrawler(storeRef, pause = {})
    private lateinit var storeRef: CatalogStore

    @Test fun `crawls every page until the source says no more`() = runBlocking {
        storeRef = store()
        val c = crawler.run("s", { p -> SourcePage((1..10).map { item((p - 1) * 10 + it) }, hasNext = p < 7) })
        assertTrue(c.done)
        assertEquals(70, c.count)
        assertEquals(70, storeRef.items("s").size)
    }

    @Test fun `a site repeating its last page does not loop forever`() = runBlocking {
        storeRef = store()
        val c = crawler.run("s", { p -> SourcePage((1..5).map { item((minOf(p, 3) - 1) * 5 + it) }, hasNext = true) })
        assertTrue(c.done)
        assertEquals(15, c.count)
        assertEquals(4, c.pagesFetched)
    }

    @Test fun `template listings ignore a lying hasNext and stop at an empty page`() = runBlocking {
        storeRef = store()
        val c = crawler.run("s", { p -> if (p <= 4) SourcePage((1..3).map { item(p * 10 + it) }, hasNext = false) else SourcePage(emptyList(), false) }, trustHasNext = false)
        assertTrue(c.done)
        assertEquals(12, c.count)
    }

    @Test fun `a permanent failure saves the cursor and the next run resumes`() = runBlocking {
        storeRef = store()
        var broken = true
        val fetch = CatalogCrawler.PageFetcher { p ->
            if (p == 3 && broken) throw IllegalStateException("parse")
            SourcePage((1..2).map { item(p * 10 + it) }, hasNext = p < 5)
        }
        val first = crawler.run("s", fetch)
        assertFalse(first.done)
        assertEquals(3, first.nextPage)
        broken = false
        val second = crawler.run("s", fetch)
        assertTrue(second.done)
        assertEquals(10, storeRef.items("s").size)
    }

    @Test fun `transient errors are retried`() = runBlocking {
        storeRef = store()
        var fails = 2
        val c = crawler.run("s", { p ->
            if (p == 2 && fails-- > 0) throw IOException("timeout")
            SourcePage(listOf(item(p)), hasNext = p < 3)
        })
        assertTrue(c.done)
        assertEquals(3, c.count)
    }
}
