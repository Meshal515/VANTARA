package eu.kanade.tachiyomi.network.interceptor

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class BrowserVerificationInterceptorTest {
    @Test
    fun `detects successful verification shell returned as html 200`() {
        val html = """<html><head><title>One moment, please...</title></head><body>Please wait while your request is being verified...</body></html>"""
        assertTrue(looksLikeBrowserVerification("text/html; charset=UTF-8", html))
    }

    @Test
    fun `does not flag a normal manga page or json`() {
        assertFalse(looksLikeBrowserVerification("text/html", "<title>مانجا لينك</title><div class='manga'>One Piece</div>"))
        assertFalse(looksLikeBrowserVerification("application/json", "{\"title\":\"One moment, please...\"}"))
    }
}
