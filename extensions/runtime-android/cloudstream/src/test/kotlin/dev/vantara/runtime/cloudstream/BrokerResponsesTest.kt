package dev.vantara.runtime.cloudstream

import com.lagradost.nicehttp.NiceResponse
import dev.vantara.runtime.api.RuntimeHttpAccess
import okhttp3.Request
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
}
