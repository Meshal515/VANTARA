package com.vantara.verification

import com.vantara.anime.net.FragmentingSocket
import java.io.InputStream
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.util.concurrent.Executors

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
    @Volatile private var open = true
    val port: Int get() = server.localPort

    /** عنوان عام لهذا الاسم بمسار المحرك نفسه، أو null. */
    fun publicAddress(host: String): InetAddress? =
        runCatching { resolve(host) }.getOrNull()?.takeIf { it.isNotEmpty() && it.all(allowed) }?.first()

    fun start(): VerificationTunnel {
        pool.execute {
            while (open) {
                val client = runCatching { server.accept() }.getOrNull() ?: break
                pool.execute { serve(client) }
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
        FragmentingSocket().use { upstream ->
            if (runCatching { upstream.connect(InetSocketAddress(address, upstreamPort), 10_000) }.isFailure) return@use refuse(c)
            c.getOutputStream().apply { write("HTTP/1.1 200 Connection Established\r\n\r\n".toByteArray()); flush() }
            c.soTimeout = 0
            // أول ما يكتبه WebView بعد الرد هو ClientHello: FragmentingSocket يقسّمه كما في وسيط المحرك.
            pool.execute { runCatching { upstream.getInputStream().copyTo(c.getOutputStream()) }; runCatching { c.close() } }
            runCatching { input.copyTo(upstream.getOutputStream()) }
            Unit
        }
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
        open = false
        runCatching { server.close() }
        pool.shutdownNow()
    }

    private companion object {
        val REQUEST = Regex("^CONNECT ([A-Za-z0-9.-]{1,253}):(\\d{1,5}) HTTP/1\\.[01]\r\n")
    }
}
