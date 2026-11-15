package dev.vantara.runtime.cloudstream

import com.lagradost.cloudstream3.utils.ExtractorLink
import com.lagradost.nicehttp.NiceResponse
import okhttp3.MediaType
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.Response
import okhttp3.ResponseBody
import okio.Buffer
import okio.BufferedSource
import org.junit.Assert.*
import org.junit.Test

/** Exact additional descriptors observed in the published Mehdi Anime4Up v4 DEX. */
class ObservedExtractorAbiTest {
    @Test fun opaqueExtractorDataSurvivesTheExactStringGetterAndSetter() {
        val link = ExtractorLink("server", "server", "https://media.example/video.mp4")
        val get = ExtractorLink::class.java.getMethod("getExtractorData")
        val set = ExtractorLink::class.java.getMethod("setExtractorData", String::class.java)
        assertEquals(String::class.java, get.returnType)
        assertEquals(Void.TYPE, set.returnType)
        assertNull(get.invoke(link))
        val opaque = "{\"token\":\"opaque-provider-data\",\"episode\":17}"
        set.invoke(link, opaque)
        assertEquals(opaque, get.invoke(link))
        set.invoke(link, null)
        assertNull(get.invoke(link))
        assertEquals("https://media.example/video.mp4", link.url)
    }

    @Test fun okhttpResponseIsTheExistingResponseWithoutAnotherBodyRead() {
        var sourceCalls = 0
        val bytes = Buffer().writeUtf8("retained body")
        val body = object : ResponseBody() {
            override fun contentType(): MediaType? = null
            override fun contentLength(): Long = 13
            override fun source(): BufferedSource { sourceCalls++; return bytes }
        }
        val original = Response.Builder().request(Request.Builder().url("https://source.example/").build())
            .protocol(Protocol.HTTP_1_1).code(200).message("OK").body(body).build()
        val wrapped = NiceResponse(original)
        val callsBeforeGetter = sourceCalls
        val get = NiceResponse::class.java.getMethod("getOkhttpResponse")
        assertEquals(Response::class.java, get.returnType)
        repeat(2) { assertSame(original, get.invoke(wrapped)) }
        assertEquals(callsBeforeGetter, sourceCalls)
        assertEquals("retained body", wrapped.text)
        assertEquals(callsBeforeGetter, sourceCalls)
    }
}
