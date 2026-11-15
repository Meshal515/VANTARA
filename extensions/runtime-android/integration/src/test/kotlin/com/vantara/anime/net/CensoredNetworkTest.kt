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
import java.io.ByteArrayOutputStream
import java.io.OutputStream
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.Socket
import java.net.SocketException
import java.time.Clock
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger
import javax.net.SocketFactory

/**
 * A network like the owner's: an ISP filter that reads the TLS ClientHello and resets the connection when the
 * blocked site's name (SNI) is in it. The emulator in a datacenter has no such filter, which is why sources passed
 * there and failed on the phone. The real engines run through a model of what such a filter sees on the wire.
 *
 * Deterministic, no timing: every write the client makes is flushed with TCP_NODELAY, i.e. one TCP segment. Two
 * kinds of filter exist in the field, and both are modelled:
 *  - FIRST_SEGMENT inspects only the first data segment of a connection (stateless DPI): the split ClientHello
 *    passes it, since the 5-byte first segment carries no name. A filter that inspected every segment alone would
 *    catch the second one, which holds the name; that is the reassembling case below.
 *  - REASSEMBLING joins the stream before matching (stateful DPI). No split defeats it; the engine must fail
 *    clearly and quickly instead of hanging. This is a documented limit, not a hidden one.
 */
class CensoredNetworkTest {
    private enum class Dpi { FIRST_SEGMENT, REASSEMBLING }

    /** The wire between the device and the site, as the filter sees it. */
    private inner class Wire(private val mode: Dpi) {
        val resets = AtomicInteger()
        val passed = AtomicInteger()
        fun sockets(split: Boolean): SocketFactory = object : SocketFactory() {
            override fun createSocket(): Socket = WireSocket(split)
            override fun createSocket(host: String, port: Int) = WireSocket(split).apply { connect(InetSocketAddress(host, port)) }
            override fun createSocket(host: String, port: Int, local: InetAddress, localPort: Int) = createSocket(host, port)
            override fun createSocket(address: InetAddress, port: Int) = WireSocket(split).apply { connect(InetSocketAddress(address, port)) }
            override fun createSocket(address: InetAddress, port: Int, local: InetAddress, localPort: Int) = createSocket(address, port)
        }

        inner class WireSocket(private val split: Boolean) : Socket() {
            private val seen = ByteArrayOutputStream()
            private var decided = false
            private val out by lazy(LazyThreadSafetyMode.NONE) {
                val raw = super.getOutputStream()
                val segments = object : OutputStream() {
                    override fun write(b: Int) = write(byteArrayOf(b.toByte()), 0, 1)
                    override fun write(b: ByteArray, off: Int, len: Int) { inspect(b, off, len); raw.write(b, off, len); raw.flush() }
                    override fun flush() = raw.flush()
                    override fun close() = raw.close()
                }
                if (split) SniFragmentingOutputStream(segments) else segments
            }
            override fun connect(endpoint: java.net.SocketAddress, timeout: Int) { super.connect(endpoint, timeout); tcpNoDelay = true }
            override fun getOutputStream(): OutputStream = out

            /** One segment on the wire. Decided once per connection, at the end of the first TLS record. */
            private fun inspect(b: ByteArray, off: Int, len: Int) {
                if (decided) return
                seen.write(b, off, len)
                val view = if (mode == Dpi.REASSEMBLING) seen.toByteArray() else b.copyOfRange(off, off + len)
                if (String(view, Charsets.ISO_8859_1).contains(name)) {
                    decided = true
                    resets.incrementAndGet()
                    runCatching { setSoLinger(true, 0); close() } // RST, as the filter injects
                    throw SocketException("Connection reset by the filter")
                }
                val all = seen.toByteArray()
                // First-segment DPI decides on that segment alone; the reassembling one waits for the whole record.
                if (mode == Dpi.FIRST_SEGMENT || all.size >= 5 && all.size >= 5 + (((all[3].toInt() and 255) shl 8) or (all[4].toInt() and 255))) {
                    decided = true
                    passed.incrementAndGet()
                }
            }
        }
    }

    private val name = "blocked-site.example"
    private lateinit var site: MockWebServer
    private lateinit var tls: HandshakeCertificates

    @Before fun setUp() {
        val cert = HeldCertificate.Builder().addSubjectAlternativeName(name).build()
        site = MockWebServer().apply { useHttps(HandshakeCertificates.Builder().heldCertificate(cert).build().sslSocketFactory(), false); start() }
        tls = HandshakeCertificates.Builder().addTrustedCertificate(cert.certificate).build()
    }
    @After fun tearDown() { site.shutdown() }

    private fun broker(wire: Wire, split: Boolean) = HttpBroker(
        OkHttpClient.Builder().sslSocketFactory(tls.sslSocketFactory(), tls.trustManager).socketFactory(wire.sockets(split = false)).build(),
        Dns { listOf(InetAddress.getByName("127.0.0.1")) },
        { it.isLoopbackAddress }, { object : HttpBroker.CookieVault {
            override fun load(url: okhttp3.HttpUrl) = emptyList<okhttp3.Cookie>()
            override fun save(url: okhttp3.HttpUrl, cookies: List<okhttp3.Cookie>) {}
        } }, Clock.systemUTC(), HttpBroker.DEFAULT_PER_HOST, if (split) wire.sockets(split = true) else null)
    private val origin get() = "https://$name:${site.port}"
    private fun scope() = HttpBroker.Scope("cloudstream", "test.package", "Akwam", "s", setOf(origin))
    private fun get(path: String) = HttpBroker.Input("$origin$path", "GET", Headers.Builder().build(), null, true)

    @Test fun theFilterReallyBlocksAPlainHandshake() {
        val wire = Wire(Dpi.FIRST_SEGMENT)
        site.enqueue(MockResponse().setBody("never"))
        broker(wire, split = false).open(scope()).use { session ->
            val code = runCatching { session.execute(get("/home")) }.exceptionOrNull() as? HttpBroker.Failure
            assertEquals("a CloudStream source without the split handshake fails exactly as on the phone", "TRANSPORT_FAILED", code?.code)
        }
        assertEquals(1, wire.resets.get())
    }

    @Test fun firstSegmentFilterIsPassedWithTheSplitHandshake() {
        val wire = Wire(Dpi.FIRST_SEGMENT)
        repeat(6) { site.enqueue(MockResponse().setBody("page $it")) }
        broker(wire, split = true).open(scope()).use { session ->
            for (i in 0 until 6) assertEquals("page $i", String(session.execute(get("/p$i")).body()))
        }
        assertEquals("one reset to learn the host, then never again", 1, wire.resets.get())
        assertTrue(wire.passed.get() >= 1)
    }

    /** A stateful filter sees the whole ClientHello however it is split: VANTARA must say so, fast, not hang. */
    @Test fun reassemblingFilterIsNotDefeatedAndTheFailureIsClearAndBounded() {
        val wire = Wire(Dpi.REASSEMBLING)
        repeat(3) { site.enqueue(MockResponse().setBody("never")) }
        val started = System.nanoTime()
        broker(wire, split = true).open(scope()).use { session ->
            val code = runCatching { session.execute(get("/home")) }.exceptionOrNull() as? HttpBroker.Failure
            assertEquals("TRANSPORT_FAILED", code?.code)
        }
        val ms = (System.nanoTime() - started) / 1_000_000
        assertTrue("bounded, not hanging (${ms}ms)", ms < 10_000)
        assertTrue("plain attempt and at most two split attempts, no retry loop (${wire.resets.get()})", wire.resets.get() in 2..3)
        assertEquals(0, wire.passed.get())
    }

    @Test fun aPoisonedDnsAnswerIsNotTrustedForAddonSources() {
        val blockPage = InetAddress.getByName("203.0.113.9") // public-looking block page, not 0.0.0.0
        val real = InetAddress.getByName("198.51.100.7")
        val dns = AnimeDns({ false }, system = Dns { listOf(blockPage) }, hasIpv6 = { false }, dohResolvers = listOf(Dns { listOf(real) }))
        assertEquals("built-in path for unregistered hosts: the ISP's answer", listOf(blockPage), dns.lookup("site.example"))
        assertEquals("CloudStream broker: DoH first, as built-in sources", listOf(real), dns.dohFirst.lookup("other.example"))
    }

    @Test fun manyConcurrentRequestsThroughTheFirstSegmentFilterAllSucceed() {
        val wire = Wire(Dpi.FIRST_SEGMENT)
        repeat(24) { site.enqueue(MockResponse().setBody("ok")) }
        val http = broker(wire, split = true)
        // Deterministic now (segments, not timing), so the race is exercised with 8 parallel requests.
        val pool = Executors.newFixedThreadPool(8)
        val ok = AtomicInteger()
        val errors = ConcurrentHashMap.newKeySet<String>()
        val jobs = (0 until 24).map { i -> pool.submit { http.open(scope()).use { s -> runCatching { s.execute(get("/c$i")) }.onSuccess { ok.incrementAndGet() }.onFailure { errors += it.toString() } } } }
        jobs.forEach { it.get() }
        pool.shutdown()
        assertEquals("all 24 parallel requests (errors: $errors)", 24, ok.get())
    }
}
