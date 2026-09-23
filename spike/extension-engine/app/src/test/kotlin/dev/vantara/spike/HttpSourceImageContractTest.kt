package dev.vantara.spike

import eu.kanade.tachiyomi.source.model.Page
import eu.kanade.tachiyomi.source.online.HttpSource
import kotlinx.coroutines.runBlocking
import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Test

class HttpSourceImageContractTest {

    @Test
    fun getImageUsesSourceImageRequestAndLeavesBodyReadable() = runBlocking {
        var seenHeader: String? = null
        val payload = byteArrayOf(1, 2, 3, 4)

        val fakeNetwork = object : Interceptor {
            override fun intercept(chain: Interceptor.Chain): Response {
                seenHeader = chain.request().header("X-Source-Image")
                return Response.Builder()
                    .request(chain.request())
                    .protocol(Protocol.HTTP_1_1)
                    .code(200)
                    .message("OK")
                    .body(payload.toResponseBody("image/png".toMediaType()))
                    .build()
            }
        }
        val testClient: OkHttpClient = OkHttpClient.Builder()
            .addInterceptor(fakeNetwork)
            .build()

        val source = object : HttpSource() {
            override val name = "test"
            override val lang = "en"
            override val baseUrl = "https://example.test"
            override val client: OkHttpClient = testClient

            override fun imageRequest(page: Page): Request =
                Request.Builder()
                    .url(page.imageUrl!!)
                    .header("X-Source-Image", "kept")
                    .build()
        }

        source.getImage(Page(0, imageUrl = "https://example.test/page.png")).use { response ->
            assertEquals("kept", seenHeader)
            assertArrayEquals(payload, response.body.bytes())
        }
    }
}
