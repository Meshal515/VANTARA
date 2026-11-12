package eu.kanade.tachiyomi.network

import eu.kanade.tachiyomi.network.interceptor.HttpsUpgradeInterceptor
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.assertEquals
import org.junit.Test

/** انحدار الفحص الحي: صور AsgardScans بروابط http رُفضت بـCLEARTEXT؛ تُرقّى الآن إلى https. */
class HttpsUpgradeTest {
    private fun seen(url: String): String {
        var sent = ""
        val client = OkHttpClient.Builder()
            .addInterceptor(HttpsUpgradeInterceptor())
            .addInterceptor { chain ->
                sent = chain.request().url.toString()
                Response.Builder().request(chain.request()).protocol(Protocol.HTTP_1_1).code(200).message("")
                    .body("".toResponseBody("text/plain".toMediaType())).build()
            }.build()
        client.newCall(Request.Builder().url(url).build()).execute().close()
        return sent
    }

    @Test fun externalHttpBecomesHttps() {
        assertEquals("https://asgardscans.com/wp-content/a.jpg", seen("http://asgardscans.com/wp-content/a.jpg"))
        assertEquals("https://cdn.example:8443/x", seen("http://cdn.example:8443/x"))
    }

    @Test fun localHostsAllowedByPolicyStayAsTheyAre() {
        assertEquals("http://127.0.0.1:8080/x", seen("http://127.0.0.1:8080/x"))
        assertEquals("http://10.0.2.2/x", seen("http://10.0.2.2/x"))
        assertEquals("http://box.vantara.local/x", seen("http://box.vantara.local/x"))
        assertEquals("https://already.example/x", seen("https://already.example/x"))
    }

    @Test fun redirectToExternalHttpIsUpgradedBeforeOkHttpFollowsIt() {
        val server = java.net.ServerSocket(0, 1, java.net.InetAddress.getLoopbackAddress())
        val worker = Thread {
            server.accept().use { socket ->
                val input = socket.getInputStream().bufferedReader()
                while (input.readLine()?.isNotEmpty() == true) Unit
                socket.getOutputStream().write(
                    "HTTP/1.1 301 Moved\r\nLocation: http://asgard.example/api/public/page/1\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".toByteArray(),
                )
            }
        }.apply { start() }
        val client = OkHttpClient.Builder().followRedirects(false)
            .addNetworkInterceptor(HttpsUpgradeInterceptor.Redirects).build()
        val location = client.newCall(Request.Builder().url("http://127.0.0.1:${server.localPort}/x").build()).execute().use { it.header("Location") }
        worker.join(5000); server.close()
        assertEquals("https://asgard.example/api/public/page/1", location)
    }
}

