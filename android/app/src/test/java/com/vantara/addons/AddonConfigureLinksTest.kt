package com.vantara.addons

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AddonConfigureLinksTest {
    @Test fun stremioInstallButtonBecomesAnHttpsManifestWithItsConfiguration() {
        assertEquals(
            "https://torrentio.strem.fun/providers=yts%7Ceztv/manifest.json",
            AddonConfigureLinks.manifestFrom("stremio://torrentio.strem.fun/providers=yts%7Ceztv/manifest.json"),
        )
    }

    @Test fun installOnWebLinkIsDecoded() {
        val web = "https://web.stremio.com/#/addons?addon=https%3A%2F%2Fsubdl.strem.top%2Fabc123%2Fmanifest.json"
        assertEquals("https://subdl.strem.top/abc123/manifest.json", AddonConfigureLinks.manifestFrom(web))
    }

    @Test fun ordinaryPagesAndUnsafeTargetsAreNotInstalls() {
        assertNull(AddonConfigureLinks.manifestFrom("https://torrentio.strem.fun/configure"))
        assertNull(AddonConfigureLinks.manifestFrom("stremio://localhost/manifest.json"))
        assertNull(AddonConfigureLinks.manifestFrom("stremio://user:pw@evil.com/manifest.json"))
        assertNull(AddonConfigureLinks.manifestFrom("stremio://evil.com:8080/manifest.json"))
        assertNull(AddonConfigureLinks.manifestFrom("stremio://evil.com/other.json"))
        assertNull(AddonConfigureLinks.manifestFrom("https://web.stremio.com/#/addons?addon=http%3A%2F%2Fx.com%2Fmanifest.json"))
    }

    @Test fun onlyWebPagesStayInsideTheConfigureWindow() {
        assertTrue(AddonConfigureLinks.staysInside("https://subdl.strem.top/configure"))
        assertFalse(AddonConfigureLinks.staysInside("intent://scan/#Intent;scheme=zxing;end"))
        assertFalse(AddonConfigureLinks.staysInside("market://details?id=com.stremio.one"))
    }
}
