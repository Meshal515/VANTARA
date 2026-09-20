package dev.vantara.spike

import java.nio.file.Files
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CatalogueCrawlCheckpointStoreTest {

    @Test
    fun `page commit survives recreation and resumes at next page`() {
        val dir = Files.createTempDirectory("vantara-catalogue-checkpoint").toFile()
        val key = "pkg|123"

        CatalogueCrawlCheckpointStore(dir).savePage(
            key = key,
            nextPage = 8,
            newKeys = listOf("/manga/a", "/manga/b"),
        )

        val recreated = CatalogueCrawlCheckpointStore(dir)
        val resume = recreated.load(key)!!

        assertEquals(8, resume.nextPage)
        assertEquals(setOf("/manga/a", "/manga/b"), resume.seenKeys)
        assertTrue(recreated.hasAnyProgress())
    }

    @Test
    fun `replayed page duplicates do not change recovered unique set`() {
        val dir = Files.createTempDirectory("vantara-catalogue-checkpoint").toFile()
        val store = CatalogueCrawlCheckpointStore(dir)
        val key = "pkg|456"

        store.savePage(key, 2, listOf("a", "b"))
        store.savePage(key, 3, listOf("b", "c"))

        assertEquals(setOf("a", "b", "c"), CatalogueCrawlCheckpointStore(dir).load(key)!!.seenKeys)
    }

    @Test
    fun `completed source is skipped and transient page state is removed`() {
        val dir = Files.createTempDirectory("vantara-catalogue-checkpoint").toFile()
        val store = CatalogueCrawlCheckpointStore(dir)
        val key = "pkg|789"

        store.savePage(key, 5, listOf("x"))
        store.markComplete(key)

        assertTrue(store.isComplete(key))
        assertEquals(null, store.load(key))
        assertFalse(store.hasResumeState())
        assertTrue(store.hasAnyProgress())
    }
}
