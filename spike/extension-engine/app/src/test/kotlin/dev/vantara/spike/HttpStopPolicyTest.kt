package dev.vantara.spike

import eu.kanade.tachiyomi.network.HttpException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * متى يكون خطأ HTTP «اهدأ وارجع» ومتى يكون وقوفًا؟
 *
 * دليل حيّ: Mangalek وقف على الجهاز عند p970 بـHttpException والموقع نفسه
 * يعرض p970 سليمة وينتهي فعلًا عند p2029. الخطأ كان عابرًا، والمنسّق عامله
 * كوقوفٍ نهائي فظهر نصف الكتالوج.
 */
class HttpStopPolicyTest {

    @Test
    fun `rate limits, server errors and edge refusals are temporary`() {
        for (code in listOf(403, 408, 425, 429, 500, 502, 503, 504, 520, 522, 524)) {
            assertTrue("$code", HttpStopPolicy.isTemporary(HttpException(code)))
        }
    }

    @Test
    fun `client errors that describe the request are not temporary`() {
        for (code in listOf(400, 401, 404, 410)) {
            assertFalse("$code", HttpStopPolicy.isTemporary(HttpException(code)))
        }
    }

    @Test
    fun `the http code is found through wrapping exceptions`() {
        val wrapped = RuntimeException("wrapped", HttpException(503))
        assertEquals(503, HttpStopPolicy.codeOf(wrapped))
        assertTrue(HttpStopPolicy.isTemporary(wrapped))
    }

    @Test
    fun `the report names the code, not just the exception class`() {
        assertEquals("HTTP 429", HttpStopPolicy.describe(HttpException(429)))
    }

    @Test
    fun `retry delays grow and stay bounded`() {
        val delays = (0 until HttpStopPolicy.PAGE_RETRIES).map(HttpStopPolicy::retryDelayMs)
        assertEquals(delays.sorted(), delays)
        assertTrue(delays.last() <= 60_000L)
    }
}
