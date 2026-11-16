package com.vantara.verification

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import kotlin.concurrent.thread

/**
 * صفحة تحقق CloudStream تمر بنفق يحل الاسم بمحلّل المحرك (لا بشبكة النظام). موقع محجوب بالاسم عند المزوّد
 * يصل عبر النفق؛ وما لا يصح (منفذ آخر، عنوان خاص، طلب غير CONNECT) يُرفض.
 */
class VerificationTunnelTest {
    private val loopback = InetAddress.getByName("127.0.0.1")

    private fun request(port: Int, head: String): Pair<String, Socket> {
        val s = Socket("127.0.0.1", port).apply { soTimeout = 5000 }
        s.getOutputStream().apply { write(head.toByteArray()); flush() }
        val reply = StringBuilder()
        val input = s.getInputStream()
        while (!reply.endsWith("\r\n\r\n")) { val b = input.read(); if (b < 0) break; reply.append(b.toChar()) }
        return reply.toString() to s
    }

    @Test fun tunnelsBytesToTheEngineResolvedAddressBothWays() {
        val upstream = ServerSocket(0, 1, loopback)
        val received = ByteArray(64)
        val echo = thread {
            upstream.accept().use { c ->
                val n = c.getInputStream().readNBytes(received, 0, 64)
                c.getOutputStream().apply { write(received, 0, n); flush() }
            }
        }
        // المحلّل المحقون يحل الاسم (والنظام لا يعرفه): هذا مسار موقع محجوب بالـDNS
        VerificationTunnel({ host -> if (host == "blocked-by-isp.example") listOf(loopback) else error("system DNS") },
            allowed = { it == loopback }, upstreamPort = upstream.localPort).start().use { tunnel ->
            val (reply, socket) = request(tunnel.port, "CONNECT blocked-by-isp.example:443 HTTP/1.1\r\nHost: blocked-by-isp.example:443\r\n\r\n")
            socket.use {
                assertTrue(reply, reply.startsWith("HTTP/1.1 200"))
                val hello = ByteArray(64) { it.toByte() } // أكبر من نقطة التقسيم: يمر مقسومًا ويصل كاملًا
                it.getOutputStream().apply { write(hello); flush() }
                val back = it.getInputStream().readNBytes(64)
                assertArrayEquals(hello, back)
            }
        }
        echo.join(5000)
        upstream.close()
    }

    @Test fun refusesOtherPortsPrivateAddressesAndPlainRequests() {
        VerificationTunnel({ listOf(InetAddress.getByName("10.0.0.7")) }).start().use { tunnel ->
            for (head in listOf(
                "CONNECT example.org:80 HTTP/1.1\r\n\r\n",
                "CONNECT example.org:443 HTTP/1.1\r\n\r\n", // يُحل لعنوان خاص
                "GET http://example.org/ HTTP/1.1\r\nHost: example.org\r\n\r\n",
                "CONNECT localhost:443 HTTP/1.1\r\n\r\n",
            )) {
                val (reply, socket) = request(tunnel.port, head)
                socket.close()
                assertTrue("$head → $reply", reply.startsWith("HTTP/1.1 403"))
            }
            assertEquals(null, tunnel.publicAddress("example.org"))
        }
    }
}
