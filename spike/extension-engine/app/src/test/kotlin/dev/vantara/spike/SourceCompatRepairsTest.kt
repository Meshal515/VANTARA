package dev.vantara.spike

import eu.kanade.tachiyomi.source.CatalogueSource
import eu.kanade.tachiyomi.source.model.SChapter
import eu.kanade.tachiyomi.source.model.SManga
import eu.kanade.tachiyomi.source.model.SMangaUpdate
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class SourceCompatRepairsTest {
    @Test
    fun `lazy real image beats data uri placeholder`() {
        val picked = chooseRealImageUrl(
            listOf(
                "https://cdn.example/manga/page-01.webp",
                "data:image/gif;base64,R0lGODlhAQABAAAAACw=",
            ),
        )
        assertEquals("https://cdn.example/manga/page-01.webp", picked)
    }

    @Test
    fun `data uri alone is never treated as downloadable image`() {
        assertNull(
            chooseRealImageUrl(
                listOf("data:image/gif;base64,R0lGODlhAQABAAAAACw="),
            ),
        )
    }

    @Test
    fun `MangaDar data-mds base64 resolves to its signed image url`() {
        val picked = chooseRealImageUrl(
            listOf(
                "data:image/gif;base64,R0lGODlhAQABAAAAACw=",
                "aHR0cHM6Ly9tYW5nYWRhci5jb20vP21kcnM9MSZjPTE3Nzc4MyZpPTAmZXhwPTE3ODk5OTIwMDAmcG5vbmNlPW4wJnNpZz1zMA==",
            ),
        )

        assertEquals(
            "https://mangadar.com/?mdrs=1&c=177783&i=0&exp=1789992000&pnonce=n0&sig=s0",
            picked,
        )
    }

    private class RecordingSource(override val name: String) : CatalogueSource {
        override val id: Long = 1L
        override val lang: String = "ar"
        val calls = mutableListOf<Pair<Boolean, Boolean>>()

        override suspend fun getMangaUpdate(
            manga: SManga,
            chapters: List<SChapter>,
            fetchDetails: Boolean,
            fetchChapters: Boolean,
        ): SMangaUpdate {
            calls += fetchDetails to fetchChapters
            return SMangaUpdate(manga, listOf(SChapter.create().apply { url = "/c1"; name = "1" }))
        }
    }

    @Test
    fun `series asks lib 1_6 for details and chapters in one call`() = runBlocking {
        // شطرُها إلى ندائين متوازيين كان يرمي «must not be called concurrently»
        val source = RecordingSource("Azora")
        val update = SourceCompatRepairs.loadSeries(source, SManga.create().apply { url = "/m"; title = "t" })

        assertEquals(listOf(true to true), source.calls)
        assertEquals(1, update.chapters.size)
    }

    @Test
    fun `a Hizo name without an http source still takes the plain path`() = runBlocking {
        // الإصلاح يخصّ مصدر Hizo الحقيقي؛ الاسم وحده لا يحوّل مسارًا لا يستطيع خدمته
        val source = RecordingSource("Hizo Manga")
        SourceCompatRepairs.loadSeries(source, SManga.create().apply { url = "/m"; title = "t" })

        assertEquals(listOf(true to true), source.calls)
    }
}
