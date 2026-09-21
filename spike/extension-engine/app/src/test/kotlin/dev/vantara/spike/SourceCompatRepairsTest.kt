package dev.vantara.spike

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
}
