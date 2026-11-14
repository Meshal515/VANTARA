package dev.vantara.runtime.cloudstream

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.After
import org.junit.Assert.*
import org.junit.Test

/**
 * WitAnime builds its own OkHttpClient (own TLS settings and cookie jar) instead of CloudStream's `app`. In the isolated
 * worker that client had no network and the provider failed before its first request (live sweep, 14 Nov). The Debug
 * build hooks OkHttpClient.Builder.build() to NetworkBridge.adopt; this is that call.
 */
class ProviderOwnClientTest {
    @After fun reset() { NetworkBridge.reset() }

    @Test fun aProvidersOwnClientEndsInTheBrokerAndKeepsItsCookieJar() {
        val asked = mutableListOf<String>()
        NetworkBridge.install { request, _ ->
            asked += request.url.toString() + " cookie=" + request.header("Cookie")
            Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(200).message("")
                .header("Set-Cookie", "session=two; Path=/")
                .body("<html>ok</html>".toResponseBody("text/html".toMediaType())).build()
        }
        val jar = object : okhttp3.CookieJar {
            val saved = mutableListOf<okhttp3.Cookie>()
            override fun saveFromResponse(url: okhttp3.HttpUrl, cookies: List<okhttp3.Cookie>) { saved += cookies }
            override fun loadForRequest(url: okhttp3.HttpUrl) = listOf(okhttp3.Cookie.Builder().name("session").value("one").domain(url.host).build())
        }
        val builder = OkHttpClient.Builder().cookieJar(jar).followRedirects(false)
        NetworkBridge.adopt(builder)
        NetworkBridge.adopt(builder) // a second build of the same builder adds nothing
        val client = builder.build()
        assertEquals(1, client.interceptors.size)
        client.newCall(Request.Builder().url("https://witanime.example/").build()).execute().use { assertEquals("<html>ok</html>", it.body.string()) }
        assertEquals(listOf("https://witanime.example/ cookie=session=one"), asked)
        assertEquals("the provider's own jar still receives its cookies", "two", jar.saved.single().value)
    }

    @Test fun outsideAWorkerTheHookChangesNothing() {
        val builder = OkHttpClient.Builder()
        NetworkBridge.adopt(builder)
        assertTrue("the host app's clients keep their own network", builder.build().interceptors.isEmpty())
    }
}
