package com.vantara.runtime

import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

/**
 * The job a provider's WebViewResolver sends the host browser is provider code: only a public page, bounded patterns,
 * headers and timeout reach a WebView, and the answer always fits the IPC text limit.
 */
class RuntimeBrowserTest {
    private val publicScope = setOf("*")
    private fun job(body: String) = """{"url":"https://player.example/e/abc","intercept":"\\.m3u8",$body"timeoutMs":60000}"""

    private fun refused(json: String, scope: Set<String> = publicScope): String =
        try { RuntimeBrowser.parse(json, scope, "HostUA"); fail("accepted: $json"); "" } catch (e: IllegalArgumentException) { e.message!! }

    @Test fun aProvidersJobIsReadWithItsPatternsHeadersAndABoundedTimeout() {
        val parsed = RuntimeBrowser.parse(
            job(""""referer":"https://anime.example/ep/1","headers":{"X-Requested-With":"XMLHttpRequest","Cookie":"sid=1","Host":"x"},"extra":["\\.vtt"],"script":"1+1","userAgent":"PluginUA","""),
            publicScope, "HostUA")
        assertEquals("https://player.example/e/abc", parsed.url)
        assertEquals("https://anime.example/ep/1", parsed.referer)
        assertEquals(mapOf("X-Requested-With" to "XMLHttpRequest"), parsed.headers)
        assertEquals("PluginUA", parsed.userAgent)
        assertTrue(RuntimeBrowser.matches(parsed.intercept!!, "https://cdn.example/master.m3u8?t=1"))
        assertEquals(listOf("\\.vtt"), parsed.extra.map { it.pattern })
        assertEquals("1+1", parsed.script)
        // CloudStream's 60 s default is above the link budget of one server page
        assertEquals(RuntimeBrowser.MAX_TIMEOUT_MS, parsed.timeoutMs)
        assertEquals("HostUA", RuntimeBrowser.parse(job(""), publicScope, "HostUA").userAgent)
    }

    @Test fun onlyAPublicHttpPageMayBeOpened() {
        for (url in listOf("file:///data/data/x", "content://x/y", "javascript:alert(1)", "https://localhost/a", "http://127.0.0.1/",
            "https://10.0.0.5/", "https://192.168.1.1/", "https://[::1]/", "https://user:pw@player.example/", "https://router.lan/", "https://intranet/"))
            assertEquals(url, "INVALID_ENDPOINT", refused("""{"url":"$url","intercept":"x"}"""))
        assertEquals("ORIGIN_NOT_ALLOWED", refused("""{"url":"https://other.example/","intercept":"x"}""", setOf("https://site.example")))
        assertEquals("https://site.example/e/1",
            RuntimeBrowser.parse("""{"url":"https://site.example/e/1","intercept":"x"}""", setOf("https://site.example"), "UA").url)
        assertEquals("BROWSER_METHOD_UNSUPPORTED", refused("""{"url":"https://player.example/","method":"POST","intercept":"x"}"""))
        assertEquals("BROWSER_PATTERN_INVALID", refused("""{"url":"https://player.example/","intercept":"(unclosed"}"""))
        assertEquals("BROWSER_PATTERN_LIMIT", refused("""{"url":"https://player.example/","intercept":"${"a".repeat(2_000)}"}"""))
        assertEquals("INVALID_BROWSER_JOB", refused("not json"))
    }

    @Test fun aCatastrophicPatternReadsAsNoMatchInsteadOfHangingTheApp() {
        val evil = Regex("(a+)+b")
        val started = System.nanoTime()
        assertFalse(RuntimeBrowser.matches(evil, "https://x.example/" + "a".repeat(40) + "c"))
        assertTrue("bounded work", (System.nanoTime() - started) / 1_000_000 < 2_000)
        assertTrue(RuntimeBrowser.matches(Regex("master\\.m3u8"), "https://cdn.example/hls/master.m3u8"))
    }

    @Test fun theAnswerKeepsTheMatchAndFitsTheIpcLimit() {
        val hit = RuntimeBrowser.Seen("https://cdn.example/master.m3u8", "GET", mapOf("User-Agent" to "UA", "Referer" to "https://player.example/", "Cookie" to "secret"))
        val many = (1..2_000).map { RuntimeBrowser.Seen("https://cdn.example/seg/$it-" + "x".repeat(200) + ".ts", "GET", emptyMap()) }
        val text = RuntimeBrowser.encode(RuntimeBrowser.Result(hit, listOf(hit), many, listOf("y".repeat(20_000))))
        assertTrue("within the 64 KiB text limit: ${text.length}", text.length <= 56 * 1024)
        val root = RuntimeJson.parse(text).jsonObject
        val intercepted = root["intercepted"]!!.jsonObject
        assertEquals("https://cdn.example/master.m3u8", intercepted["url"]!!.jsonPrimitive.content)
        val headers = intercepted["headers"]!!.jsonObject
        assertEquals("UA", headers["User-Agent"]!!.jsonPrimitive.content)
        assertNull("cookies never cross", headers["Cookie"])
        assertTrue(root["seen"]!!.jsonArray.size in 1 until 2_000)
        val empty = RuntimeJson.parse(RuntimeBrowser.encode(RuntimeBrowser.Result(null, emptyList(), emptyList(), emptyList()))).jsonObject
        assertEquals("null", empty["intercepted"].toString())
    }
}
