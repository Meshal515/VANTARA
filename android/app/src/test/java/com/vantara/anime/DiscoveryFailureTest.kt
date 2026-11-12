package com.vantara.anime

import org.junit.Assert.*
import org.junit.Test
import java.io.IOException

class DiscoveryFailureTest {
    @Test fun `debug failure preserves the original cause and strips source URL credentials`() {
        val cause = IllegalArgumentException("GET https://source.example/private?token=secret HTTP 522\nCookie: clearance=firstSecret; session=secondSecret")
        val text = DiscoveryFailure.describe(IOException("search wrapper", cause))
        assertTrue(text.contains("IllegalArgumentException"))
        assertTrue(text.contains("HTTP 522"))
        assertTrue(text.contains("search wrapper"))
        assertFalse(text.contains("token=secret"))
        assertFalse(text.contains("secondSecret"))
    }
    @Test fun `bounded bridge text includes the deepest cause before wrapper stack frames`() {
        var error: Throwable = IOException("original DNS failure")
        repeat(8) { error = IllegalStateException("wrapper $it", error) }
        assertTrue(DiscoveryFailure.describe(error).take(1600).contains("original DNS failure"))
    }
}
