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
    // الغلاف يظهر خلال ثوانٍ: لا تكرار لما لا يصلحه تغيير Referer
    @Test fun onlyRefererRejectionsOrNonImagesTryTheNextReferer() {
        assertEquals(true, CoverReferers.worthNextAttempt(403, gotNonImage = false))
        assertEquals(true, CoverReferers.worthNextAttempt(401, gotNonImage = false))
        assertEquals(true, CoverReferers.worthNextAttempt(200, gotNonImage = true))
        assertEquals(false, CoverReferers.worthNextAttempt(null, gotNonImage = false))
        assertEquals(false, CoverReferers.worthNextAttempt(404, gotNonImage = false))
        assertEquals(false, CoverReferers.worthNextAttempt(503, gotNonImage = false))
        assertEquals(true, CoverReferers.BUDGET_MS <= 6_000L)
    }
    // المحاولة الصبورة تطلب مهلة أطول، محصورة: لا أقل من العادية ولا أكثر من عشرين ثانية، وبلا طلب = العادية
    @Test fun aPatientRetryGetsALongerButBoundedBudget() {
        assertEquals(CoverReferers.BUDGET_MS, CoverReferers.budget(null))
        assertEquals(15_000L, CoverReferers.budget(15_000L))
        assertEquals(CoverReferers.MAX_BUDGET_MS, CoverReferers.budget(600_000L))
        assertEquals(CoverReferers.BUDGET_MS, CoverReferers.budget(10L))
    }
}
