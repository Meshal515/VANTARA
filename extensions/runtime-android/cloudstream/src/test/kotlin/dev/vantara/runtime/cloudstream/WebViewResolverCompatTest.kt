package dev.vantara.runtime.cloudstream

import com.lagradost.cloudstream3.network.WebViewResolver
import kotlinx.coroutines.runBlocking
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * A provider's own WebViewResolver in the isolated worker: it has no WebView, so the page goes to VANTARA's hidden
 * browser in the host as a JSON job, and the request the page made comes back. Without a host browser it behaves as
 * CloudStream's JVM build (nothing intercepted, the request goes on unchanged).
 */
class WebViewResolverCompatTest {
    @After fun reset() { WorkerState.browser = null }

    @Test fun theProvidersPatternAndPageGoToTheHostBrowserAndTheStreamComesBack() = runBlocking {
        val jobs = mutableListOf<String>()
        WorkerState.browser = { job ->
            jobs += job
            """{"intercepted":{"url":"https://cdn.example/hls/master.m3u8","method":"GET","headers":{"User-Agent":"PageUA","Referer":"https://player.example/e/1"}},
               "extra":[{"url":"https://cdn.example/ar.vtt","method":"GET","headers":{}}],"seen":[],"scripts":["42"]}"""
        }
        val scripts = mutableListOf<String>()
        val resolver = WebViewResolver(Regex("""\.m3u8"""), listOf(Regex("""\.vtt""")), script = "6*7", scriptCallback = { scripts += it })
        val (found, extra) = resolver.resolveUsingWebView("https://player.example/e/1", referer = "https://anime.example/ep/3", headers = emptyMap())
        assertEquals("https://cdn.example/hls/master.m3u8", found!!.url.toString())
        assertEquals("PageUA", found.header("User-Agent"))
        assertEquals(listOf("https://cdn.example/ar.vtt"), extra.map { it.url.toString() })
        assertEquals(listOf("42"), scripts)
        val job = com.lagradost.cloudstream3.mapper.readTree(jobs.single())
        assertEquals("https://player.example/e/1", job["url"].asText())
        assertEquals("https://anime.example/ep/3", job["referer"].asText())
        assertEquals("""\.m3u8""", job["intercept"].asText())
        assertEquals("""\.vtt""", job["extra"][0].asText())
        assertEquals(WebViewResolver.DEFAULT_TIMEOUT, job["timeoutMs"].asLong())
        assertTrue(job["userAgent"].asText().contains("Chrome/"))
    }

    @Test fun asAnInterceptorTheProvidersRequestGoesOnToTheInterceptedStream() {
        WorkerState.browser = { """{"intercepted":{"url":"https://cdn.example/v.mp4","method":"GET","headers":{}},"extra":[],"seen":[],"scripts":[]}""" }
        val reached = mutableListOf<String>()
        val client = OkHttpClient.Builder().addInterceptor(WebViewResolver(Regex("""\.mp4""")))
            .addInterceptor { chain ->
                reached += chain.request().url.toString()
                Response.Builder().request(chain.request()).protocol(Protocol.HTTP_1_1).code(200).message("")
                    .body("".toResponseBody("video/mp4".toMediaType())).build()
            }.build()
        client.newCall(Request.Builder().url("https://player.example/e/2").build()).execute().close()
        assertEquals(listOf("https://cdn.example/v.mp4"), reached)
    }

    @Test fun withoutAHostBrowserNothingIsInterceptedAsOnCloudStreamsJvmBuild() = runBlocking {
        WorkerState.browser = null
        val (found, extra) = WebViewResolver(Regex("x")).resolveUsingWebView("https://player.example/e/3", headers = emptyMap())
        assertNull(found)
        assertTrue(extra.isEmpty())
    }

    @Test fun aRequestCallbackChoosesFromWhatThePageRequested() = runBlocking {
        WorkerState.browser = { """{"intercepted":null,"extra":[],"seen":[{"url":"https://ads.example/a.js","method":"GET"},{"url":"https://cdn.example/p.m3u8","method":"GET"}],"scripts":[]}""" }
        val (found, _) = WebViewResolver(Regex("never")).resolveUsingWebView(
            Request.Builder().url("https://player.example/e/4").build()) { it.url.encodedPath.endsWith(".m3u8") }
        assertEquals("https://cdn.example/p.m3u8", found!!.url.toString())
    }
}
