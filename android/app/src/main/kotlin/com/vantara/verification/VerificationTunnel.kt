package com.vantara.verification

import com.vantara.anime.net.FragmentingSocket
import java.io.InputStream
import java.io.IOException
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException

/**
 * نفق CONNECT محلي لصفحة تحقق مصادر CloudStream وحدها (عملية :verification).
 *
 * وسيط CloudStream يصل لمواقعه بـDNS مشفّر أولًا وتجزئة ClientHello (RuntimeHost)، فيعمل موقع يحجبه مزوّد الإنترنت
 * بالاسم أو بالـSNI. صفحة التحقق كانت تستعمل شبكة النظام: الاسم لا يُحل، أو يُحل لصفحة حجب على نطاق آخر، أو تُقطع
 * المصافحة، فتُغلق الصفحة في لحظة («يطلعني فجأة»). هذا النفق يمرر WebView التحقق بالمسار نفسه.
 *
 * حدود: 127.0.0.1 فقط بمنفذ عشوائي، يعيش ما دامت صفحة التحقق مفتوحة؛ CONNECT إلى 443 فقط؛ اسم يمر
 * [VerificationPolicy.endpoint] وعنوان عام فقط. لا يقرأ المحتوى المشفّر ولا يخزّن شيئًا.
 */
class VerificationTunnel(
    private val resolve: (String) -> List<InetAddress>,
    /** للاختبار وحده: خادم محلي بدل عنوان عام ومنفذ 443. */
    private val allowed: (InetAddress) -> Boolean = VerificationPolicy::publicAddress,
    private val upstreamPort: Int = 443,
) : AutoCloseable {
    private val server = ServerSocket(0, 16, InetAddress.getByName("127.0.0.1"))
    private val pool = Executors.newCachedThreadPool { r -> Thread(r, "verification-tunnel").apply { isDaemon = true } }
    private val lifecycle = Any()
    private val sockets = mutableSetOf<Socket>()
    @Volatile private var open = true
    private var started = false

    private fun track(socket: Socket): Boolean = synchronized(lifecycle) {
        if (!open) false else { sockets.add(socket); true }
    }

    private fun release(socket: Socket) {
        synchronized(lifecycle) { sockets.remove(socket) }
        runCatching { socket.close() }
    }

    /** Submission can race close(); a rejected task never owns a socket. */
    private fun submit(task: () -> Unit): Boolean {
        if (!open) return false
        return try { pool.execute { task() }; true }
        catch (_: RejectedExecutionException) { false }
    }
    val port: Int get() = server.localPort

    /** عنوان عام لهذا الاسم بمسار المحرك نفسه، أو null. */
    fun publicAddress(host: String): InetAddress? =
        runCatching { resolve(host) }.getOrNull()?.takeIf { it.isNotEmpty() && it.all(allowed) }?.first()

    fun start(): VerificationTunnel {
        synchronized(lifecycle) {
            if (!open || started) return this
            started = true
            submit {
                while (open) {
                    val client = try { server.accept() } catch (_: IOException) { break }
                    if (!track(client)) { release(client); break }
                    if (!submit {
                        try { serve(client) }
                        catch (_: IOException) { /* closed or disconnected peer */ }
                        finally { release(client) }
                    }) release(client)
                }
            }
        }
        return this
    }

    private fun serve(client: Socket): Unit = client.use { c ->
        c.soTimeout = 15_000
        val input = c.getInputStream()
        val line = readHead(input)?.let { REQUEST.find(it) } ?: return@use refuse(c)
        val host = line.groupValues[1].lowercase()
        if (line.groupValues[2] != "443" || VerificationPolicy.endpoint("https://$host/") == null) return@use refuse(c)
        val address = publicAddress(host) ?: return@use refuse(c)
        val upstream = FragmentingSocket()
        if (!track(upstream)) { release(upstream); return@use }
        try { upstream.use {
            if (runCatching { upstream.connect(InetSocketAddress(address, upstreamPort), 10_000) }.isFailure) return@use refuse(c)
            c.getOutputStream().apply { write("HTTP/1.1 200 Connection Established\r\n\r\n".toByteArray()); flush() }
            c.soTimeout = 0
            // أول ما يكتبه WebView بعد الرد هو ClientHello: FragmentingSocket يقسّمه كما في وسيط المحرك.
            if (!submit {
                try { upstream.getInputStream().copyTo(c.getOutputStream()) }
                catch (_: IOException) { /* peer closed */ }
                finally { release(c) }
            }) return@use
            runCatching { input.copyTo(upstream.getOutputStream()) }
            Unit
        } } finally { release(upstream) }
    }

    /** رأس الطلب حتى سطر فارغ، بلا قراءة ما بعده (بايتات TLS). */
    private fun readHead(input: InputStream): String? {
        val out = StringBuilder()
        while (out.length < 8192) {
            val b = input.read()
            if (b < 0) return null
            out.append(b.toChar())
            if (out.endsWith("\r\n\r\n")) return out.toString()
        }
        return null
    }

    private fun refuse(c: Socket) {
        runCatching { c.getOutputStream().apply { write("HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n".toByteArray()); flush() } }
    }

    override fun close() {
        val active = synchronized(lifecycle) {
            if (!open) return
            open = false
            sockets.toList().also { sockets.clear() }
        }
        runCatching { server.close() }
        active.forEach { runCatching { it.close() } }
        pool.shutdownNow()
    }

    private companion object {
        val REQUEST = Regex("^CONNECT ([A-Za-z0-9.-]{1,253}):(\\d{1,5}) HTTP/1\\.[01]\r\n")
    }
}
