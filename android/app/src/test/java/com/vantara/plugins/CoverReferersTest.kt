package com.vantara.plugins

import org.junit.Assert.assertEquals
import org.junit.Test

class CoverReferersTest {
    @Test fun uninstalledSourceStillTriesTheImageSiteAsReferer() {
        assertEquals(listOf("https://olympustaff.com/", "https://cdn.olympustaff.com/", CoverReferers.NO_REFERER),
            CoverReferers.attempts("https://cdn.olympustaff.com/images/manga/x.webp", hasSource = false))
    }
    @Test fun installedSourceHeadersComeFirst() {
        assertEquals(listOf(CoverReferers.SOURCE_HEADERS, "https://mangalek.com/", CoverReferers.NO_REFERER),
            CoverReferers.attempts("https://mangalek.com/wp-content/x.jpg", hasSource = true))
    }
}
