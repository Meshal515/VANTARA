package com.vantara.anime

import com.vantara.anime.hosts.EmbedResolver
import com.vantara.anime.hosts.Sniffer
import com.vantara.anime.hosts.Stream
import eu.kanade.tachiyomi.network.HostRouting
import kotlinx.coroutines.runBlocking
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.*
import org.junit.Test

class CinemaEmbedPolicyTest {
    @Test fun `Cinema requests and browser fallback cannot affect Anime on the same host`() = runBlocking {
        val scoped = mutableListOf<Boolean>()
        var browserCalls = 0
        val client = OkHttpClient.Builder().addInterceptor { chain ->
            scoped += chain.request().tag(HostRouting.NoBrowser::class.java) != null
            Response.Builder().request(chain.request()).protocol(Protocol.HTTP_1_1).code(200).message("OK")
                .body("<html>JS player</html>".toResponseBody()).build()
        }.build()
        val anime = EmbedResolver(client, Sniffer { _, _ -> browserCalls++; Stream("https://media.test/video.mp4") })
        val cinema = anime.forCinema()
        assertTrue(cinema.resolve("https://same-hoster.test/e/one", null).isEmpty())
        assertEquals(0, browserCalls)
        assertEquals(1, anime.resolve("https://same-hoster.test/e/one", null).size)
        assertEquals(1, browserCalls)
        assertEquals(listOf(true, false), scoped)
    }
    @Test fun `direct player media client bypasses browser verification without changing original client`() {
        var verified = 0
        val original = OkHttpClient.Builder().addInterceptor { chain ->
            if (!HostRouting.shouldFailVerification(chain.request())) { verified++; throw java.io.IOException("browser verification") }
            Response.Builder().request(chain.request()).protocol(Protocol.HTTP_1_1).code(206).message("Partial Content")
                .body("video bytes".toResponseBody()).build()
        }.build()
        val cinema = com.vantara.anime.net.CinemaNetwork.client(original)
        val request = okhttp3.Request.Builder().url("https://cdn.test/media.mp4").build()
        cinema.newCall(request).execute().use { assertEquals(206, it.code) }
        assertEquals(0, verified)
        assertTrue(runCatching { original.newCall(request).execute().close() }.isFailure)
        assertEquals(1, verified)
    }

}
