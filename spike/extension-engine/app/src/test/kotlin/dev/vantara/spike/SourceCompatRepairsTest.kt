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
}
