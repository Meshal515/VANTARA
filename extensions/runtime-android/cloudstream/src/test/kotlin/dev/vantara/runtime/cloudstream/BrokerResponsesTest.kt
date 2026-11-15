package dev.vantara.runtime.cloudstream

import com.lagradost.nicehttp.NiceResponse
import dev.vantara.runtime.api.RuntimeHttpAccess
import okhttp3.Request
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import org.junit.Assert.*
import org.junit.Test
import java.nio.charset.Charset

class BrokerResponsesTest {
    @Test fun declaredArabicCharsetSurvivesBrokerAndBothParserPaths() {
        val text="مرحبا بالعالم"
        val request=Request.Builder().url("https://source.example/").build()
        val encoded=RuntimeHttpAccess.Response("https://source.example/final",201,mapOf("content-type" to listOf("text/html; charset=windows-1256")),text.toByteArray(Charset.forName("windows-1256")))
        assertEquals(text,NiceResponse(BrokerResponses.convert(request,encoded)).text)
        BrokerResponses.convert(request,encoded).use{response->assertEquals(text,response.body.string());assertEquals(201,response.code);assertEquals("https://source.example/final",response.request.url.toString())}
    }

    // WitAnime's /sources POST (CSRF): OkHttp adds Content-Type from the body only after the bridge, so the site got
    // application/octet-stream. The body's own type is sent; a header the provider set itself is kept as it is.
    @Test fun aPostCarriesItsBodysMediaTypeToTheBroker() {
        val json=okhttp3.Request.Builder().url("https://witanime.example/watch/x/sources")
            .post("{}".toRequestBody("application/json; charset=utf-8".toMediaType())).build()
        assertEquals(listOf("application/json; charset=utf-8"),BrokerResponses.headers(json)["Content-Type"])
        val explicit=json.newBuilder().header("Content-Type","application/x-www-form-urlencoded").build()
        assertEquals(listOf("application/x-www-form-urlencoded"),BrokerResponses.headers(explicit)["Content-Type"])
        assertNull(BrokerResponses.headers(okhttp3.Request.Builder().url("https://witanime.example/").build())["Content-Type"])
    }
}
