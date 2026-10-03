package com.vantara.anime

import com.vantara.anime.net.AnimeNetworkEvents
import okhttp3.Dns
import okhttp3.OkHttpClient
import okhttp3.Request
import org.junit.Assert.*
import org.junit.Test
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.Proxy
import java.net.ServerSocket
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread

class AnimeNetworkEventsTest {
    private fun race(live: String, dead: String, family: String) {
        val server = ServerSocket()
        try { server.bind(InetSocketAddress(InetAddress.getByName(live), 0)) }
        catch (e: Exception) { server.close(); org.junit.Assume.assumeNoException(e); return }
        server.soTimeout = 5000
        val task = thread(isDaemon = true) {
            server.accept().use { socket ->
                socket.soTimeout = 3000
                val reader = socket.getInputStream().bufferedReader()
                while (!reader.readLine().isNullOrEmpty()) { }
                socket.getOutputStream().write("HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nOK".toByteArray())
            }
        }
        try {
            val host = "race-${family.lowercase()}.test"
            val client = OkHttpClient.Builder().proxy(Proxy.NO_PROXY)
                .dns(Dns { listOf(InetAddress.getByName(dead), InetAddress.getByName(live)) })
                .fastFallback(true).connectTimeout(5, TimeUnit.SECONDS).callTimeout(3, TimeUnit.SECONDS)
                .eventListenerFactory { AnimeNetworkEvents() }.build()
            client.newCall(Request.Builder().url("http://$host:${server.localPort}/").build()).execute().use {
                assertEquals("OK", it.body.string())
            }
            val detail = AnimeNetworkEvents.of(host).orEmpty()
            assertTrue(detail, detail.contains("winning address family=$family"))
            assertTrue(detail, detail.contains("connection latency="))
        } finally { server.close(); task.join(1000) }
    }
    @Test fun `IPv6 wins even when DNS returns a dead IPv4 first`() = race("::1", "192.0.2.1", "IPv6")
    @Test fun `IPv4 still succeeds when the IPv6 route is unavailable`() = race("127.0.0.1", "2001:db8::1", "IPv4")
}
