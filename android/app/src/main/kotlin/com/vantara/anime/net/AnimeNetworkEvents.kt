package com.vantara.anime.net

import okhttp3.Call
import okhttp3.Connection
import okhttp3.EventListener
import okhttp3.Protocol
import java.io.IOException
import java.net.Inet6Address
import java.net.InetSocketAddress
import java.net.Proxy
import java.util.concurrent.ConcurrentHashMap

/** Bounded diagnostics for the anime source/video client; no effect on routing or playback. */
class AnimeNetworkEvents : EventListener() {
    private val connects = ConcurrentHashMap<InetSocketAddress, Long>()
    private var requestStarted = System.nanoTime()
    private var stage = "call"
    private var winningDetail: String? = null
    override fun callStart(call: Call) { requestStarted = System.nanoTime() }
    override fun dnsStart(call: Call, domainName: String) { stage = "DNS" }
    override fun connectStart(call: Call, inetSocketAddress: InetSocketAddress, proxy: Proxy) {
        stage = "TCP"
        connects[inetSocketAddress] = System.nanoTime()
    }
    override fun secureConnectStart(call: Call) { stage = "TLS" }
    override fun connectFailed(call: Call, inetSocketAddress: InetSocketAddress, proxy: Proxy, protocol: Protocol?, ioe: IOException) {
        connects.remove(inetSocketAddress)
    }
    override fun connectionAcquired(call: Call, connection: Connection) {
        val route = connection.route()
        val start = connects[route.socketAddress]
        val family = if (route.proxy.type() != Proxy.Type.DIRECT) "proxy (origin family unknown)"
            else if (route.socketAddress.address is Inet6Address) "IPv6" else "IPv4"
        winningDetail = "winning address family=$family · connection latency=${start?.let { "${(System.nanoTime() - it) / 1_000_000}ms" } ?: "reused"}"
        save(call, requireNotNull(winningDetail))
        stage = "HTTP"
    }
    override fun callFailed(call: Call, ioe: IOException) {
        save(call, "${winningDetail?.let { "$it · " }.orEmpty()}failed stage=$stage · ${(System.nanoTime() - requestStarted) / 1_000_000}ms · ${ioe.javaClass.simpleName}")
    }
    private fun save(call: Call, detail: String) = synchronized(recent) {
        recent.remove(call.request().url.host)
        recent[call.request().url.host] = detail
        stamped[call.request().url.host] = System.currentTimeMillis()
        while (recent.size > 128) {
            val oldest = recent.keys.first()
            recent.remove(oldest); stamped.remove(oldest)
        }
    }
    companion object {
        private val recent = LinkedHashMap<String, String>()
        private val stamped = HashMap<String, Long>()
        fun since(at: Long): List<Pair<String, String>> = synchronized(recent) { recent.entries.filter { (stamped[it.key] ?: 0) >= at }.map { it.key to it.value } }
        fun of(host: String): String? = synchronized(recent) { recent[host] }
    }
}
