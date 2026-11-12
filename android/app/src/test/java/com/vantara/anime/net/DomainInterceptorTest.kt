package com.vantara.anime.net

import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/** A source whose site moved to an unproven domain: the extension still gets the page, as in Aniyomi. */
class DomainInterceptorTest {
    private val oldSite = MockWebServer()
    private val newSite = MockWebServer()

    @Before fun start() { oldSite.start(); newSite.start() }
    @After fun stop() { oldSite.shutdown(); newSite.shutdown() }

    @Test fun movedSiteReachesTheExtensionButNeverBecomesTheActiveDomain() {
        // localhost → 127.0.0.1 are different sites with no fingerprint: the old code threw ForeignRedirectException.
        val base = "http://localhost:${oldSite.port}"
        oldSite.enqueue(MockResponse().setResponseCode(301).addHeader("Location", "http://127.0.0.1:${newSite.port}/home"))
        newSite.enqueue(MockResponse().addHeader("Content-Type", "text/html").setBody("<title>الموقع الجديد</title><div class=card>عمل</div>"))
        val foreign = mutableListOf<ForeignRedirectException>()
        val adopted = mutableListOf<String>()
        val domains = DomainInterceptor(DomainPlan(current = base), onDomain = { adopted += it }, onForeign = { foreign += it })
        val client = OkHttpClient.Builder().addInterceptor(domains).build()
        val body = client.newCall(Request.Builder().url("$base/list").build()).execute().use { it.body.string() }
        assertTrue("The extension must receive the page it was redirected to", body.contains("class=card"))
        assertEquals(1, foreign.size)
        assertEquals("127.0.0.1", foreign.single().to)
        assertEquals("الموقع الجديد", foreign.single().title)
        assertTrue("An unproven host must not become the source's active domain", adopted.isEmpty())
        assertEquals("http://localhost", domains.activeBase())
    }
}
