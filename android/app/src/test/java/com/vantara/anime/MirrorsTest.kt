package com.vantara.anime

import com.vantara.anime.hosts.EmbedResolver
import com.vantara.anime.hosts.Mirrors
import com.vantara.anime.hosts.Sniffer
import com.vantara.anime.hosts.Stream
import kotlinx.coroutines.runBlocking
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** StreamHG: `hgcloud.to/e/x` يحوّل بسكربت إلى مرآة بنفس المسار فيها الرابط مباشرة. */
class MirrorsTest {
    private fun client(pages: Map<String, String>, asked: MutableList<String>) = OkHttpClient.Builder().addInterceptor { chain ->
        val r = chain.request()
        asked += r.url.host
        val body = pages[r.url.host] ?: "<html><script src=/main.js></script></html>"
        Response.Builder().request(r).protocol(Protocol.HTTP_1_1).code(200).message("OK")
            .body(body.toResponseBody("text/html".toMediaType())).build()
    }.build()

    @Test fun `a known mirror is one plain request, no browser`() = runBlocking {
        Mirrors.learn("hgcloud.to", "vibuxer.com")
        val asked = mutableListOf<String>()
        var sniffed = false
        val r = EmbedResolver(client(mapOf("vibuxer.com" to """<script>var links={"hls2":"https://cdn.x/hls2/a/master.m3u8?t=1"}</script>"""), asked), Sniffer { _, _ -> sniffed = true; null })
        val got = r.resolve("https://hgcloud.to/e/wfw0buonw2r9", "https://tv10.egydead.live/")
        assertEquals("https://cdn.x/hls2/a/master.m3u8?t=1", got.single().url)
        assertEquals(listOf("vibuxer.com"), asked)
        assertTrue(!sniffed)
    }

    @Test fun `the browser teaches a new mirror, a dead one is forgotten`() = runBlocking {
        Mirrors.learn("hgplay.example", "dead.example")
        val asked = mutableListOf<String>()
        val r = EmbedResolver(client(emptyMap(), asked), Sniffer { url, _ ->
            Stream("https://cdn.y/master.m3u8", page = url.replace("hgplay.example", "fresh.example"))
        })
        r.resolve("https://hgplay.example/e/abc", null)
        assertEquals("fresh.example", Mirrors.of("hgplay.example"))
        Mirrors.forget("hgplay.example")
        assertNull(Mirrors.of("hgplay.example"))
    }
}
