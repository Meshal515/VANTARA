package com.vantara.anime

import com.vantara.anime.net.*
import okhttp3.*
import okhttp3.HttpUrl.Companion.toHttpUrl
import org.junit.Assert.*
import org.junit.Test
import java.net.InetAddress
import java.net.InetSocketAddress
import java.util.concurrent.atomic.AtomicInteger
import com.sun.net.httpserver.HttpServer

class CinemaRoutingTest {
    @Test fun `default Anime policy keeps fingerprints and current host behavior`() {
        val plan = DomainPlan("https://anime.test", legacy = setOf("old.test"), fingerprint = "anime-card")
        assertEquals(DomainPolicy.Verdict.FINGERPRINT_OK, DomainPolicy.judge("https://anime.test".toHttpUrl(), "https://other.test".toHttpUrl(), plan, "anime-card"))
        assertNull(DomainPolicy.rewrite("https://anime.test/a".toHttpUrl(), plan, "https://mirror.test".toHttpUrl()))
    }
    @Test fun `strict source cannot trust an arbitrary site copying its fingerprint`() {
        val plan = DomainPlan("https://source.test", strictRedirects = true, fingerprint = "source-theme")
        assertEquals(DomainPolicy.Verdict.FOREIGN, DomainPolicy.judge("https://source.test".toHttpUrl(), "https://advert.test".toHttpUrl(), plan, "source-theme"))
    }
    @Test fun `candidate needs source identity before acceptance`() {
        val plan = DomainPlan("https://source.test", strictRedirects = true, fingerprint = "source-theme", migrationCandidates = setOf("candidate.test"))
        assertEquals(DomainPolicy.Verdict.FOREIGN, DomainPolicy.judge("https://source.test".toHttpUrl(), "https://candidate.test".toHttpUrl(), plan, "generic movie page"))
        assertEquals(DomainPolicy.Verdict.FINGERPRINT_OK, DomainPolicy.judge("https://source.test".toHttpUrl(), "https://candidate.test".toHttpUrl(), plan, "source-theme"))
        assertFalse("candidate is not pretrusted", "candidate.test" in plan.knownHosts())
    }
    @Test fun `verified active host replaces manifest current only when opted in`() {
        val plan = DomainPlan("https://source.test", followActive = true)
        assertEquals("https://mirror.test/show?q=one", DomainPolicy.rewrite("https://source.test/show?q=one".toHttpUrl(), plan, "https://mirror.test".toHttpUrl()).toString())
        assertNull(DomainPolicy.rewrite("https://video.test/clip".toHttpUrl(), plan, "https://mirror.test".toHttpUrl()))
    }
    @Test fun `unknown intermediate redirect is refused before contacting it`() {
        val visits = AtomicInteger()
        val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        val port = server.address.port
        server.createContext("/start") { e -> e.responseHeaders.add("Location", "http://advert.test:$port/end"); e.sendResponseHeaders(302, -1); e.close() }
        server.createContext("/end") { e -> visits.incrementAndGet(); e.sendResponseHeaders(200, -1); e.close() }
        server.start()
        try {
            val plan = DomainPlan("http://source.test:$port", strictRedirects = true)
            val client = OkHttpClient.Builder().proxy(java.net.Proxy.NO_PROXY).dns { listOf(InetAddress.getByName("127.0.0.1")) }
                .addInterceptor(DomainInterceptor(plan)).addNetworkInterceptor(DomainRedirectGuard).build()
            val failure = runCatching { client.newCall(Request.Builder().url("http://source.test:$port/start").build()).execute().close() }.exceptionOrNull()
            assertTrue(failure.toString(), failure is ForeignRedirectException)
            assertEquals(0, visits.get())
        } finally { server.stop(0) }
    }
    @Test fun `an exact unverified candidate cannot authorize its sibling`() {
        val visits = AtomicInteger()
        val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        val port = server.address.port
        server.createContext("/start") { e -> e.responseHeaders.add("Location", "http://candidate.test:$port/candidate"); e.sendResponseHeaders(302, -1); e.close() }
        server.createContext("/candidate") { e -> e.responseHeaders.add("Location", "http://evil.candidate.test:$port/end"); e.sendResponseHeaders(302, -1); e.close() }
        server.createContext("/end") { e -> visits.incrementAndGet(); e.sendResponseHeaders(200, -1); e.close() }
        server.start()
        try {
            val plan = DomainPlan("http://source.test:$port", strictRedirects = true, fingerprint = "source-theme", migrationCandidates = setOf("candidate.test"))
            val client = OkHttpClient.Builder().proxy(java.net.Proxy.NO_PROXY).dns { listOf(InetAddress.getByName("127.0.0.1")) }
                .addInterceptor(DomainInterceptor(plan)).addNetworkInterceptor(DomainRedirectGuard).build()
            val failure = runCatching { client.newCall(Request.Builder().url("http://source.test:$port/start").build()).execute().close() }.exceptionOrNull()
            assertTrue(failure.toString(), failure is ForeignRedirectException)
            assertEquals(0, visits.get())
        } finally { server.stop(0) }
    }
    @Test fun `direct candidate response requires identity and only then becomes active`() {
        val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        val port = server.address.port
        server.createContext("/") { e ->
            val bytes = (if (e.requestURI.path == "/valid") "<html>source-theme</html>" else "<html>unrelated-site</html>").toByteArray()
            e.responseHeaders.add("Content-Type", "text/html")
            e.sendResponseHeaders(200, bytes.size.toLong()); e.responseBody.use { it.write(bytes) }
        }
        server.start()
        try {
            val domains = DomainInterceptor(DomainPlan("http://source.test:$port", strictRedirects = true, fingerprint = "source-theme", migrationCandidates = setOf("candidate.test")))
            val client = OkHttpClient.Builder().proxy(java.net.Proxy.NO_PROXY).dns { listOf(InetAddress.getByName("127.0.0.1")) }
                .addInterceptor(domains).addNetworkInterceptor(DomainRedirectGuard).build()
            val failure = runCatching { client.newCall(Request.Builder().url("http://candidate.test:$port/invalid").build()).execute().close() }.exceptionOrNull()
            assertTrue(failure.toString(), failure is ForeignRedirectException)
            client.newCall(Request.Builder().url("http://candidate.test:$port/valid").build()).execute().use { assertEquals(200, it.code) }
            assertEquals("http://candidate.test", domains.activeBase())
        } finally { server.stop(0) }
    }
    @Test fun `IPv6 preference is opted in and retains fast IPv4 fallback`() {
        val v4 = InetAddress.getByName("104.21.66.238"); val v6 = InetAddress.getByName("2606:4700::1")
        val dns = AnimeDns({ true }, hasIpv6 = { true })
        assertEquals(listOf(v4, v6), dns.usable(listOf(v6, v4)))
        assertEquals(listOf(v6, v4), dns.usable(listOf(v4, v6), ipv6First = true))
        assertTrue(OkHttpClient().fastFallback)
    }
    @Test fun `scoped DNS cache keeps AAAA when IPv6 becomes available`() {
        var connected = false; var calls = 0
        val v4 = InetAddress.getByName("104.21.66.238"); val v6 = InetAddress.getByName("2606:4700::1")
        val dns = AnimeDns({ true }, hasIpv6 = { connected }, preferIpv6 = { it == "fasel.test" }, dohServers = listOf(Dns { calls++; listOf(v4, v6) }))
        assertEquals(listOf(v4), dns.lookup("fasel.test"))
        connected = true
        assertEquals(listOf(v6, v4), dns.lookup("fasel.test"))
        assertEquals(1, calls)
        connected = false
        assertEquals(listOf(v4), dns.lookup("fasel.test"))
    }
}
