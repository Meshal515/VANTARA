package dev.vantara.runtime.cloudstream

import com.lagradost.nicehttp.Requests
import kotlinx.coroutines.runBlocking
import okhttp3.*
import okhttp3.ResponseBody.Companion.toResponseBody
import okhttp3.MediaType.Companion.toMediaType
import org.junit.Assert.*
import org.junit.After
import org.junit.Test
import java.util.concurrent.atomic.AtomicReference

class RequestsContractTest {
    @After fun cleanup(){NetworkBridge.reset()}
    @Test fun requestsUseInstalledBrokerAndKeepPostPayloadAndHeaders()=runBlocking {
        val seen=AtomicReference<Request>()
        NetworkBridge.install { request,follow ->
            seen.set(request);assertFalse(follow)
            Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(201).message("Created").header("X-Reply","actual").body("مرحبا".toResponseBody("text/plain; charset=utf-8".toMediaType())).build()
        }
        val response=Requests().post("https://source.vantara.example/api",headers=mapOf("X-Source" to "test"),json=mapOf("name" to "عمل"),allowRedirects=false)
        assertEquals(201,response.code);assertEquals("مرحبا",response.text);assertEquals("مرحبا",response.text)
        val bytes=okio.Buffer();seen.get().body!!.writeTo(bytes)
        assertTrue(bytes.readUtf8().contains("عمل"));assertEquals("test",seen.get().header("X-Source"))
    }
    @Test fun rawClientBuilderFlagsAndAppendedInterceptorRemainBrokered() {
        val seen=AtomicReference<Request>()
        NetworkBridge.install { request,follow ->seen.set(request);assertFalse(follow);Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(200).message("OK").body("result".toResponseBody()).build()}
        val clone=Requests().baseClient.newBuilder().followRedirects(false).addInterceptor { chain->chain.proceed(chain.request().newBuilder().header("X-After-Clone","preserved").build()) }.build()
        clone.newCall(Request.Builder().url("https://source.vantara.example/raw").build()).execute().use {assertEquals("result",it.body.string())}
        assertEquals("preserved",seen.get().header("X-After-Clone"))
    }
    @Test fun absentBrokerCannotFallBackToDirectNetwork() {
        try {Requests().baseClient.newCall(Request.Builder().url("https://source.vantara.example/").build()).execute();fail("Unbrokered network")}
        catch(expected:java.io.IOException){assertEquals("BROKER_NOT_INSTALLED",expected.message)}
    }
    @Test fun tlsDisableIsExplicitlyRejectedWithoutCallingTransport()=runBlocking {
        NetworkBridge.install{_,_->throw AssertionError("Unsafe transport invoked")}
        try{Requests().get("https://source.vantara.example",verify=false);fail("TLS disable accepted")}
        catch(expected:java.io.IOException){assertEquals("TLS_VERIFICATION_DISABLE_UNSUPPORTED",expected.message)}
    }
}
