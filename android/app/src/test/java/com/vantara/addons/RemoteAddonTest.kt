package com.vantara.addons

import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.*
import org.junit.Test
import java.net.InetAddress

class RemoteAddonTest {
    @Test fun `public addon policy rejects credentials private IP and unsafe scheme`() {
        for (u in listOf("http://addon.test/x", "https://localhost/x", "https://127.0.0.1/x", "https://user@addon.test/x", "https://addon.local/x")) assertTrue(runCatching { RemoteAddonClient.publicUrl(u) }.isFailure)
        assertEquals("addon.test", RemoteAddonClient.publicUrl("https://addon.test/config/manifest.json").host)
    }
    @Test fun `DNS guard preserves both working address families but rejects private answers`() {
        val addresses = listOf(InetAddress.getByName("2606:4700::1111"), InetAddress.getByName("104.21.1.1"))
        assertEquals(addresses, RemoteAddonClient.publicAddresses(addresses))
        assertTrue(runCatching { RemoteAddonClient.publicAddresses(listOf(InetAddress.getByName("10.1.2.3"))) }.isFailure)
        assertTrue(runCatching { RemoteAddonClient.publicAddresses(listOf(InetAddress.getByName("fd00::1"))) }.isFailure)
    }
    @Test fun `bounded GET does not follow redirect or send identity credentials`() {
        var request: Request? = null
        val base = OkHttpClient.Builder().addInterceptor { chain ->
            request = chain.request()
            Response.Builder().request(chain.request()).protocol(Protocol.HTTP_1_1).code(200).message("OK").body("{}".toResponseBody()).build()
        }.build()
        val client = RemoteAddonClient(base)
        assertEquals("{}", client.request("https://addon.test/token/manifest.json", "one"))
        assertNull(request!!.header("Authorization")); assertNull(request!!.header("Cookie"))
        assertTrue(runCatching { client.request("https://addon.test/api", "two", limit = 1) }.isFailure)
    }
    @Test fun `subtitle identity uses season and episode and never guesses from title`() {
        assertEquals("tt1196946:1:1", SubtitleProviders.videoId("""{"kind":"series","externalIds":{"imdb":"tt1196946"},"season":1}""", 1f)?.second)
        assertNull(SubtitleProviders.videoId("""{"kind":"anime","title":"Mentalist"}""", 1f))
        assertNull(SubtitleProviders.videoId("""{"kind":"series","externalIds":{"imdb":"tt1"}}""", 1f))
    }
    @Test fun `late subtitle results cannot cross a server or episode boundary`() {
        val session = SubtitleSession()
        val old = session.begin()
        val current = session.begin()
        val track = AddonSubtitle("ar", "provider", "ar", "https://addon.test/sub.srt")
        assertFalse(session.accept(old, listOf(track)))
        assertTrue(session.tracks.isEmpty())
        assertTrue(session.accept(current, listOf(track)))
        assertEquals(listOf(track), session.tracks)
        session.begin()
        assertTrue(session.tracks.isEmpty())
        assertFalse(session.accept(current, listOf(track)))
        val generation = session.generation
        val firstChoice = session.select()
        val secondChoice = session.select()
        assertFalse(session.current(generation, firstChoice))
        assertTrue(session.current(generation, secondChoice))
    }
    @Test fun `cancel before native IO starts prevents the pending request`() {
        var reached = false
        val client = RemoteAddonClient(OkHttpClient.Builder().addInterceptor { chain ->
            reached = true
            Response.Builder().request(chain.request()).protocol(Protocol.HTTP_1_1).code(200).message("OK").body("{}".toResponseBody()).build()
        }.build())
        client.cancel("pending")
        assertTrue(runCatching { client.request("https://addon.test/api", "pending") }.isFailure)
        assertFalse(reached)
    }

}
