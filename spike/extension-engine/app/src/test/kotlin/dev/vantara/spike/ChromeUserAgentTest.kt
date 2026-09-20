package dev.vantara.spike

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ChromeUserAgentTest {

    @Test
    fun `chrome version is parsed for matching client hint metadata`() {
        assertEquals(
            ChromeVersion("140", "140.0.7339.51"),
            ChromeUserAgent.parse(
                "Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 " +
                    "Chrome/140.0.7339.51 Mobile Safari/537.36",
            ),
        )
    }

    @Test
    fun `non chrome user agent does not fabricate metadata`() {
        assertNull(ChromeUserAgent.parse("VANTARA-Spike/1.0"))
    }
}
