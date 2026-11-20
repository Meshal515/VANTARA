package com.vantara.plugins

import com.vantara.plugins.MangaSelfUpdate.Action
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** قرار المالك (20 نوفمبر): التحديث التلقائي فقط إن كان الإصدار الجديد آمنًا ويعمل، ويدوي، ورجوع للسابق. */
class MangaSelfUpdateTest {
    private val verified = UpdatePreflight.Verdict(true, "RUNTIME_UPDATE_VERIFIED")
    private val siteDown = UpdatePreflight.Verdict(true, "RUNTIME_UPDATE_UNVERIFIED_ENVIRONMENT")
    private val broken = UpdatePreflight.Verdict(false, "RUNTIME_UPDATE_PREFLIGHT_FAILED")

    @Test fun `a newer version that really returns works is applied`() {
        assertEquals(Action.APPLY, MangaSelfUpdate.decide(newer = true, held = null, repoCode = 12, verdict = verified))
    }

    @Test fun `a broken new version, or one that could not be checked, keeps the current one`() {
        assertEquals(Action.SKIP_REJECTED, MangaSelfUpdate.decide(true, null, 12, broken))
        assertEquals(Action.SKIP_REJECTED, MangaSelfUpdate.decide(true, null, 12, null))
        // الموقع لم يرد أثناء الفحص: يكفي لليدوي، لا للتلقائي (يُعاد غدًا)
        assertEquals(Action.SKIP_UNVERIFIED, MangaSelfUpdate.decide(true, null, 12, siteDown))
    }

    @Test fun `after a manual rollback the same version is not re-applied, only a newer one`() {
        assertEquals(Action.SKIP_HELD, MangaSelfUpdate.decide(true, held = 12, repoCode = 12, verdict = verified))
        assertEquals(Action.SKIP_HELD, MangaSelfUpdate.decide(true, held = 12, repoCode = 0, verdict = verified))
        assertEquals(Action.APPLY, MangaSelfUpdate.decide(true, held = 12, repoCode = 13, verdict = verified))
    }

    @Test fun `newer compares version codes when both are known, otherwise the name`() {
        assertTrue(MangaSelfUpdate.newer(106000, "1.6.0", 106001, "1.6.1"))
        assertFalse(MangaSelfUpdate.newer(106001, "1.6.1", 106001, "1.6.1"))
        assertFalse("a lower code is never an update", MangaSelfUpdate.newer(106001, "1.6.1", 6, "1.4.6"))
        assertTrue(MangaSelfUpdate.newer(0, "1.4.5", 0, "1.4.6"))
        assertEquals(Action.SKIP_NOT_NEWER, MangaSelfUpdate.decide(false, null, 12, verified))
    }

    @Test fun `only failures that mean the site changed trigger an early check`() {
        for (code in listOf("SITE_HTTP_404", "SITE_HTTP_410", "EXTENSION_PARSE", "EXTENSION_FAILED")) assertTrue(code, MangaSelfUpdate.suggestsUpdate(code))
        for (code in listOf("SITE_TIMEOUT", "SITE_DNS", "SITE_HTTP_503", "HOST_COOLING", "SITE_VERIFICATION")) assertFalse(code, MangaSelfUpdate.suggestsUpdate(code))
    }
}
