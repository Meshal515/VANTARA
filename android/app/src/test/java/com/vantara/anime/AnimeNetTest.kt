package com.vantara.anime

import com.vantara.anime.health.HealthStore
import com.vantara.anime.net.AnimeDns
import com.vantara.anime.net.AnimeHostRouter
import com.vantara.anime.net.DomainPlan
import com.vantara.anime.net.DomainPolicy
import com.vantara.anime.net.SniFragmentingOutputStream
import com.vantara.anime.net.UrlRewrite
import okhttp3.Dns
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.Response
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.io.IOException
import java.io.OutputStream
import java.net.InetAddress
import java.net.SocketException
import java.net.UnknownHostException
import javax.net.ssl.SSLHandshakeException

class AnimeNetTest {

    private fun ip(s: String) = InetAddress.getByName(s)

    // ── الموجّه: إلغاؤنا ليس عطل المصدر ──

    private fun clientThatFails(cancelFirst: Boolean, error: IOException): OkHttpClient =
        OkHttpClient.Builder()
            .addInterceptor(AnimeHostRouter)
            .addInterceptor { chain ->
                if (cancelFirst) chain.call().cancel()
                throw error
            }
            .build()

    @Test fun `a call we cancelled is not recorded against the source`() {
        val h = HealthStore(null)
        AnimeHostRouter.health = h
        AnimeHostRouter.register("cancel-src", DomainPlan("https://cancel.test"))
        val call = clientThatFails(cancelFirst = true, IOException("Canceled")).newCall(Request.Builder().url("https://cancel.test/").build())
        runCatching { call.execute() }
        assertNull(h.get(HealthStore.sourceKey("cancel-src")))
    }

    @Test fun `a real network failure is recorded with a readable reason`() {
        val h = HealthStore(null)
        AnimeHostRouter.health = h
        AnimeHostRouter.register("dns-src", DomainPlan("https://blocked.test"))
        val call = clientThatFails(cancelFirst = false, UnknownHostException("blocked.test")).newCall(Request.Builder().url("https://blocked.test/").build())
        runCatching { call.execute() }
        val r = h.get(HealthStore.sourceKey("dns-src"))!!
        assertEquals(1, r.fail)
        assertTrue(r.lastError!!, r.lastError!!.startsWith("الدومين لا يُحلّ"))
    }

    // ── الصحة: تنظيف سجلات الإلغاء القديمة ──

    @Test fun `stored records whose only failure was our cancellation are dropped on load`() {
        val f = File.createTempFile("health", ".json")
        f.writeText(
            """[{"key":"source:okanime","fail":4,"streak":4,"lastError":"IOException: Canceled"},
               {"key":"source:witanime","ok":2,"fail":1,"lastError":"IOException: Canceled"},
               {"key":"host:dood.to","fail":1,"lastError":"HTTP 403"}]""",
        )
        val h = HealthStore(f)
        assertNull(h.get("source:okanime"))
        assertEquals(2, h.get("source:witanime")!!.ok)
        assertEquals(1, h.get("host:dood.to")!!.fail)
        f.delete()
    }

    // ── DNS ──

    @Test fun `sinkhole answers are recognised as blocking`() {
        assertTrue(AnimeDns.isSinkhole(listOf(ip("0.0.0.0"))))
        assertTrue(AnimeDns.isSinkhole(listOf(ip("127.0.0.1"))))
        assertTrue(AnimeDns.isSinkhole(listOf(ip("10.10.34.34"))))
        assertFalse(AnimeDns.isSinkhole(listOf(ip("104.21.3.4"))))
        assertFalse(AnimeDns.isSinkhole(emptyList()))
    }

    @Test fun `ordinary hosts use the system resolver untouched`() {
        var asked = 0
        val system = Dns { asked++; listOf(ip("93.184.216.34")) }
        val dns = AnimeDns(isSourceHost = { false }, system = system)
        assertEquals(listOf(ip("93.184.216.34")), dns.lookup("example.org"))
        assertEquals(1, asked)
    }

    @Test fun `DoH answers keep IPv6 only when the phone has an IPv6 route`() {
        val answer = listOf(ip("2606:4700::1"), ip("104.21.1.1"), ip("172.67.1.1"))
        val noV6 = AnimeDns(isSourceHost = { true }, hasIpv6 = { false })
        assertEquals(listOf(ip("104.21.1.1"), ip("172.67.1.1")), noV6.usable(answer))
        val withV6 = AnimeDns(isSourceHost = { true }, hasIpv6 = { true })
        assertEquals(listOf(ip("104.21.1.1"), ip("172.67.1.1"), ip("2606:4700::1")), withV6.usable(answer))
        // موقع IPv6 فقط يبقى قابلًا للمحاولة
        assertEquals(listOf(ip("2606:4700::1")), noV6.usable(listOf(ip("2606:4700::1"))))
    }

    @Test fun `failures list every address attempt, not just the first`() {
        val first = java.net.ConnectException("connect failed: ENETUNREACH")
        first.addSuppressed(java.net.SocketTimeoutException("connect timed out"))
        val text = AnimeHostRouter.describe(first)
        assertTrue(text, text.contains("ENETUNREACH") && text.contains("انتهت مهلة الاتصال"))
    }

    // ── تجزئة SNI ──

    private class RecordingOutputStream : OutputStream() {
        val chunks = mutableListOf<ByteArray>()
        override fun write(b: Int) { chunks += byteArrayOf(b.toByte()) }
        override fun write(b: ByteArray, off: Int, len: Int) { chunks += b.copyOfRange(off, off + len) }
        override fun flush() = Unit
    }

    @Test fun `the first sizable write is split into two flushed chunks, later writes pass through whole`() {
        val rec = RecordingOutputStream()
        val frag = SniFragmentingOutputStream(rec)
        val clientHello = ByteArray(200) { it.toByte() }
        frag.write(clientHello)
        assertEquals(2, rec.chunks.size)
        assertEquals(5, rec.chunks[0].size)
        assertEquals(195, rec.chunks[1].size)
        assertArrayEquals(clientHello, rec.chunks[0] + rec.chunks[1])

        // بيانات التطبيق بعد المصافحة لا تُقسَّم
        val appData = ByteArray(50) { 7 }
        frag.write(appData)
        assertEquals(3, rec.chunks.size)
        assertArrayEquals(appData, rec.chunks[2])
    }

    @Test fun `a small first write is not split`() {
        val rec = RecordingOutputStream()
        val frag = SniFragmentingOutputStream(rec)
        val tiny = byteArrayOf(1, 2, 3)
        frag.write(tiny)
        assertEquals(1, rec.chunks.size)
        assertArrayEquals(tiny, rec.chunks[0])
    }

    @Test fun `SNI-reset detection matches TLS and reset errors only`() {
        assertTrue(AnimeHostRouter.looksLikeSniReset(SSLHandshakeException("Read error: I/O error during system call, Connection reset by peer")))
        assertTrue(AnimeHostRouter.looksLikeSniReset(SSLHandshakeException("connection closed")))
        assertTrue(AnimeHostRouter.looksLikeSniReset(SocketException("Connection reset")))
        // مشكلة TLS حقيقية ليست حجبًا: لا تُعاد بالتجزئة
        assertFalse(AnimeHostRouter.looksLikeSniReset(SSLHandshakeException("x").apply { initCause(java.security.cert.CertificateException("Trust anchor not found")) }))
        assertFalse(AnimeHostRouter.looksLikeSniReset(javax.net.ssl.SSLPeerUnverifiedException("Hostname x not verified")))
        assertFalse(AnimeHostRouter.looksLikeSniReset(SSLHandshakeException("x")))
        assertTrue(AnimeHostRouter.looksLikeSniReset(SocketException("connection reset by peer")))
        assertFalse(AnimeHostRouter.looksLikeSniReset(UnknownHostException("x")))
        assertFalse(AnimeHostRouter.looksLikeSniReset(java.net.SocketTimeoutException("timeout")))
        assertFalse(AnimeHostRouter.looksLikeSniReset(SocketException("Connection refused")))
    }

    @Test fun `a handshake reset is retried once via the fragmentation client and its own outcome returned`() {
        val h = HealthStore(null)
        AnimeHostRouter.health = h
        AnimeHostRouter.register("sni-src", DomainPlan("https://sni.test"))
        AnimeHostRouter.fragmentClient = OkHttpClient.Builder()
            .addInterceptor(AnimeHostRouter)
            .addInterceptor { chain -> Response.Builder().request(chain.request()).protocol(Protocol.HTTP_1_1).code(200).message("OK").build() }
            .build()
        val primary = OkHttpClient.Builder()
            .addInterceptor(AnimeHostRouter)
            .addInterceptor { throw SSLHandshakeException("Connection reset") }
            .build()

        val response = primary.newCall(Request.Builder().url("https://sni.test/").build()).execute()

        assertEquals(200, response.code)
        assertEquals(1, h.get(HealthStore.sourceKey("sni-src"))!!.ok)
        AnimeHostRouter.fragmentClient = null
    }

    @Test fun `a host that needed fragmentation goes straight to the fragmentation client afterwards`() {
        AnimeHostRouter.health = HealthStore(null)
        AnimeHostRouter.register("sni-src-3", DomainPlan("https://sni3.test"))
        var fragmented = 0
        AnimeHostRouter.fragmentClient = OkHttpClient.Builder()
            .addInterceptor(AnimeHostRouter)
            .addInterceptor { chain -> fragmented++; Response.Builder().request(chain.request()).protocol(Protocol.HTTP_1_1).code(200).message("OK").build() }
            .build()
        var plain = 0
        val primary = OkHttpClient.Builder()
            .addInterceptor(AnimeHostRouter)
            .addInterceptor { plain++; throw SocketException("Connection reset") }
            .build()

        repeat(3) { primary.newCall(Request.Builder().url("https://sni3.test/p$it").build()).execute().close() }

        assertEquals(1, plain)
        assertEquals(3, fragmented)
        AnimeHostRouter.fragmentClient = null
    }

    // ── مسارات غيّرها الموقع ──

    @Test fun `an old search path is rewritten to the site's new one, keeping other parameters`() {
        val plan = DomainPlan(
            "https://ww3.okanime.xyz",
            rewrites = listOf(UrlRewrite("/search/", to = "/search", params = mapOf("s" to "q"))),
        )
        val fixed = DomainPolicy.fixPath("https://ww3.okanime.xyz/search/?s=ون%20بيس&page=2".toHttpUrl(), plan)
        assertEquals("https://ww3.okanime.xyz/search?q=%D9%88%D9%86%20%D8%A8%D9%8A%D8%B3&page=2", fixed.toString())
        assertNull(DomainPolicy.fixPath("https://ww3.okanime.xyz/anime/one-piece/".toHttpUrl(), plan))
    }

    @Test fun `the request that reaches the network carries the rewritten path`() {
        AnimeHostRouter.health = HealthStore(null)
        AnimeHostRouter.register(
            "rw-src",
            DomainPlan("https://rw.test", legacy = setOf("https://old.rw.test"), rewrites = listOf(UrlRewrite("/search/", "/search", mapOf("s" to "q")))),
        )
        var seen: String? = null
        val client = OkHttpClient.Builder()
            .addInterceptor(AnimeHostRouter)
            .addInterceptor { chain -> seen = chain.request().url.toString(); Response.Builder().request(chain.request()).protocol(Protocol.HTTP_1_1).code(200).message("OK").build() }
            .build()
        client.newCall(Request.Builder().url("https://old.rw.test/search/?s=naruto&page=1").build()).execute().close()
        assertEquals("https://rw.test/search?q=naruto&page=1", seen)
    }

    @Test fun `a handshake reset that fails again after fragmentation is reported once, not twice`() {
        val h = HealthStore(null)
        AnimeHostRouter.health = h
        AnimeHostRouter.register("sni-src-2", DomainPlan("https://sni2.test"))
        AnimeHostRouter.fragmentClient = OkHttpClient.Builder()
            .addInterceptor(AnimeHostRouter)
            .addInterceptor { throw SSLHandshakeException("Connection reset") }
            .build()
        val primary = OkHttpClient.Builder()
            .addInterceptor(AnimeHostRouter)
            .addInterceptor { throw SSLHandshakeException("Connection reset") }
            .build()

        runCatching { primary.newCall(Request.Builder().url("https://sni2.test/").build()).execute() }

        assertEquals(1, h.get(HealthStore.sourceKey("sni-src-2"))!!.fail)
        AnimeHostRouter.fragmentClient = null
    }
}
