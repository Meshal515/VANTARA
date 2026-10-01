package com.vantara.anime

import com.vantara.anime.net.CinemaMediaProbe
import eu.kanade.tachiyomi.network.HostRouting
import com.sun.net.httpserver.HttpServer
import java.net.InetSocketAddress
import kotlinx.coroutines.runBlocking
import okhttp3.OkHttpClient
import org.junit.Assert.*
import org.junit.Test

class CinemaMediaProbeTest {
    @Test fun `HTML posing as a video must fail`() = runBlocking {
        withServer { base -> assertFalse(CinemaMediaProbe(OkHttpClient()).probe("$base/html", emptyMap()).isSuccess) }
    }
    @Test fun `HLS must reach an actual segment with candidate headers`() = runBlocking {
        withServer { base ->
            var requests = 0
            val tagged = java.util.concurrent.ConcurrentLinkedQueue<Boolean>()
            val client = OkHttpClient.Builder().addInterceptor { chain ->
                tagged += chain.request().tag(HostRouting.NoBrowser::class.java) != null
                requests++
                chain.proceed(chain.request())
            }.build()
            assertTrue(CinemaMediaProbe(client).probe("$base/master.m3u8", mapOf("Referer" to "https://source.test/")).isSuccess)
            assertEquals(3, requests)
            assertTrue(tagged.all { it })
            assertFalse(CinemaMediaProbe(OkHttpClient()).probe("$base/master.m3u8", emptyMap()).isSuccess)
        }
    }
    private suspend fun withServer(block: suspend (String) -> Unit) {
        val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        server.createContext("/") { exchange ->
            val path = exchange.requestURI.path
            val authorized = exchange.requestHeaders.getFirst("Referer") == "https://source.test/"
            val bytes = when (path) {
                "/master.m3u8" -> "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nmedia.m3u8\n".toByteArray()
                "/media.m3u8" -> "#EXTM3U\n#EXTINF:5,\nsegment.ts\n".toByteArray()
                "/segment.ts" -> byteArrayOf(0x47, 0, 0, 0, 0x47)
                else -> "<html>captcha</html>".toByteArray()
            }
            val code = if (path == "/segment.ts" && !authorized) 403 else 200
            exchange.responseHeaders.add("Content-Type", if (path == "/html") "text/html" else "application/octet-stream")
            exchange.sendResponseHeaders(code, bytes.size.toLong())
            exchange.responseBody.use { it.write(bytes) }
        }
        server.start()
        try { block("http://127.0.0.1:${server.address.port}") } finally { server.stop(0) }
    }
}
