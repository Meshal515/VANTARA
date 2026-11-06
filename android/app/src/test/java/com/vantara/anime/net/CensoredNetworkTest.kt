package com.vantara.anime.net

import dev.vantara.runtime.http.HttpBroker
import okhttp3.Dns
import okhttp3.Headers
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.tls.HandshakeCertificates
import okhttp3.tls.HeldCertificate
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.time.Clock
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger

/**
 * A network like the owner's: an ISP filter that reads the first packet of every connection and resets it when the
 * blocked site's name is in it (the TLS ClientHello carries it in clear, SNI). The emulator in a datacenter has no
 * such filter, which is why sources passed there and failed on the phone. These tests run the real engines through it.
 */
class CensoredNetworkTest {
    private class Filter(private val upstream: Int, private val blocked: String) : AutoCloseable {
        private val server = ServerSocket(0, 50, InetAddress.getByName("127.0.0.1"))
        private val pool = Executors.newCachedThreadPool()
        val port get() = server.localPort
        val resets = AtomicInteger()
        val passed = AtomicInteger()
        init {
            pool.execute {
                while (!server.isClosed) {
                    val client = runCatching { server.accept() }.getOrNull() ?: break
                    pool.execute { handle(client) }
                }
            }
        }
        private fun handle(client: Socket) {
            val input = client.getInputStream()
            val first = ByteArray(16384)
            val n = runCatching { input.read(first) }.getOrDefault(-1)
            if (n <= 0) return client.close()
            if (String(first, 0, n, Charsets.ISO_8859_1).contains(blocked)) {
                resets.incrementAndGet()
                client.setSoLinger(true, 0) // RST, as the filter injects
                return client.close()
            }
            passed.incrementAndGet()
            val up = Socket("127.0.0.1", upstream)
            up.getOutputStream().apply { write(first, 0, n); flush() }
            pool.execute { runCatching { input.copyTo(up.getOutputStream()) }; runCatching { up.shutdownOutput() } }
            runCatching { up.getInputStream().copyTo(client.getOutputStream()) }
            runCatching { client.close() }; runCatching { up.close() }
        }
        override fun close() { server.close(); pool.shutdownNow() }
    }

    private val name = "blocked-site.example"
    private lateinit var site: MockWebServer
    private lateinit var filter: Filter
    private lateinit var tls: HandshakeCertificates

    @Before fun setUp() {
        val cert = HeldCertificate.Builder().addSubjectAlternativeName(name).build()
        site = MockWebServer().apply { useHttps(HandshakeCertificates.Builder().heldCertificate(cert).build().sslSocketFactory(), false); start() }
        tls = HandshakeCertificates.Builder().addTrustedCertificate(cert.certificate).build()
        filter = Filter(site.port, name)
    }
    @After fun tearDown() { filter.close(); site.shutdown() }

    private fun client() = OkHttpClient.Builder().sslSocketFactory(tls.sslSocketFactory(), tls.trustManager).build()
    private fun broker(fragmenting: javax.net.SocketFactory?) = HttpBroker(client(), Dns { listOf(InetAddress.getByName("127.0.0.1")) },
        { it.isLoopbackAddress }, { object : HttpBroker.CookieVault {
            override fun load(url: okhttp3.HttpUrl) = emptyList<okhttp3.Cookie>()
            override fun save(url: okhttp3.HttpUrl, cookies: List<okhttp3.Cookie>) {}
        } }, Clock.systemUTC(), HttpBroker.DEFAULT_PER_HOST, fragmenting)
    private val origin get() = "https://$name:${filter.port}"
    private fun scope() = HttpBroker.Scope("cloudstream", "test.package", "Akwam", "s", setOf(origin))
    private fun get(path: String) = HttpBroker.Input("$origin$path", "GET", Headers.Builder().build(), null, true)

    @Test fun theFilterReallyBlocksAPlainHandshake() {
        site.enqueue(MockResponse().setBody("never"))
        broker(null).open(scope()).use { session ->
            val code = runCatching { session.execute(get("/home")) }.exceptionOrNull() as? HttpBroker.Failure
            assertEquals("a CloudStream source without the split handshake fails exactly as on the phone", "TRANSPORT_FAILED", code?.code)
        }
        assertEquals(1, filter.resets.get())
    }

    @Test fun cloudStreamSourcesGetThroughTheFilterWithTheSplitHandshake() {
        repeat(6) { site.enqueue(MockResponse().setBody("page $it")) }
        broker(SniFragmentingSocketFactory()).open(scope()).use { session ->
            for (i in 0 until 6) assertEquals("page $i", String(session.execute(get("/p$i")).body()))
        }
        assertEquals("one reset to learn the host, then never again", 1, filter.resets.get())
        assertTrue(filter.passed.get() >= 1)
    }

    @Test fun aPoisonedDnsAnswerIsNotTrustedForAddonSources() {
        val blockPage = InetAddress.getByName("203.0.113.9") // public-looking block page, not 0.0.0.0
        val real = InetAddress.getByName("198.51.100.7")
        val dns = AnimeDns({ false }, system = Dns { listOf(blockPage) }, hasIpv6 = { false }, dohResolvers = listOf(Dns { listOf(real) }))
        assertEquals("built-in path for unregistered hosts: the ISP's answer", listOf(blockPage), dns.lookup("site.example"))
        assertEquals("CloudStream broker: DoH first, as built-in sources", listOf(real), dns.dohFirst.lookup("other.example"))
    }

    @Test fun manyConcurrentRequestsThroughTheFilterAllSucceed() {
        repeat(24) { site.enqueue(MockResponse().setBody("ok")) }
        val http = broker(SniFragmentingSocketFactory())
        // 4 in parallel: the first ones are all reset at once (the race this covers). More threads overload this
        // test filter itself: it reads from its receive buffer, not packet by packet as an ISP filter does.
        val pool = Executors.newFixedThreadPool(4)
        val ok = AtomicInteger()
        val errors = ConcurrentHashMap.newKeySet<String>()
        val jobs = (0 until 24).map { i -> pool.submit { http.open(scope()).use { s -> runCatching { s.execute(get("/c$i")) }.onSuccess { ok.incrementAndGet() }.onFailure { errors += it.toString() } } } }
        jobs.forEach { it.get() }
        pool.shutdown()
        assertEquals("all 24 parallel requests (errors: $errors)", 24, ok.get())
    }
}
