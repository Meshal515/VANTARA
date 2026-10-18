package com.vantara.plugins

import eu.kanade.tachiyomi.network.NetworkHelper
import eu.kanade.tachiyomi.source.model.Page
import eu.kanade.tachiyomi.source.model.SChapter
import eu.kanade.tachiyomi.source.online.HttpSource
import okhttp3.Headers
import org.junit.Assert.assertEquals
import org.junit.Test

class HttpSourceHeadersTest {
    private val browserAgent = "Mozilla/5.0 (Linux; Android 16) Chrome/141.0.7390.0 Mobile Safari/537.36"

    private open class FixtureSource : HttpSource() {
        override val name = "Header fixture"
        override val lang = "ar"
        override val baseUrl = "https://source.example"
        fun imageHeaders(): Headers = imageRequest(Page(0, imageUrl = "https://images.example/1.webp")).headers
    }

    @Test fun chapterRequestsUseTheHostBrowserUserAgent() {
        val source = configure(FixtureSource())
        val chapter = SChapter.create().apply { url = "/reader/series/10" }
        assertEquals(browserAgent, source.pageListRequest(chapter).header("User-Agent"))
    }

    @Test fun imageRequestsUseTheSameHostBrowserUserAgent() {
        val source = configure(FixtureSource())
        assertEquals(browserAgent, source.imageHeaders()["User-Agent"])
    }

    @Test fun extensionHeaderOverridesStillWin() {
        val source = configure(object : FixtureSource() {
            override fun headersBuilder(): Headers.Builder = super.headersBuilder()
                .set("User-Agent", "ExplicitSourceAgent/1")
                .set("Referer", "https://source.example/")
                .set("Origin", "https://source.example")
        })
        assertEquals("ExplicitSourceAgent/1", source.imageHeaders()["User-Agent"])
        assertEquals("https://source.example/", source.imageHeaders()["Referer"])
        assertEquals("https://source.example", source.imageHeaders()["Origin"])
    }

    private fun <T : HttpSource> configure(source: T): T {
        // NetworkHelper's Android CookieManager/cache constructor cannot run in a JVM test.
        // Only its real defaultUserAgentProvider() is used by headersBuilder: provide that
        // lazy value without constructing WebViews or replacing the source's header code.
        val unsafeClass = Class.forName("sun.misc.Unsafe")
        val unsafe = unsafeClass.getDeclaredField("theUnsafe").run {
            isAccessible = true
            get(null)
        }
        val network = unsafeClass.getMethod("allocateInstance", Class::class.java)
            .invoke(unsafe, NetworkHelper::class.java) as NetworkHelper
        NetworkHelper::class.java.getDeclaredField("defaultUserAgent\$delegate").apply {
            isAccessible = true
            set(network, lazyOf(browserAgent))
        }
        HttpSource::class.java.getDeclaredField("network\$delegate").apply {
            isAccessible = true
            set(source, lazyOf(network))
        }
        return source
    }
}
