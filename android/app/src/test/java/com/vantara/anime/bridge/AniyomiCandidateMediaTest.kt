package com.vantara.anime.bridge

import com.vantara.anime.stream.Candidate
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.TimeoutCancellationException
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.SocketPolicy
import okio.Buffer
import org.junit.Assert.*
import org.junit.Test
import java.util.concurrent.TimeUnit

/** Real loopback HTTP verifies production reads/cancellation; no fake probe-success callback. */
class AniyomiCandidateMediaTest {
    private fun candidate(url: String) = Candidate("c","source","fixture","server","localhost",url,
        headers=mapOf("Referer" to "https://source.example/watch"),resolvedAt=0,expiresAt=Long.MAX_VALUE)
    private fun server(block: (MockWebServer, String) -> Unit) {
        MockWebServer().use { server -> server.start();block(server,server.url("/").toString().trimEnd('/')) }
    }
    @Test fun anHttp403WithValidMediaBytesIsStillRejected() = server { server,base ->
        val body=byteArrayOf(0,0,0,24)+"ftypisom".toByteArray()
        server.enqueue(MockResponse().setResponseCode(403).setBody(Buffer().write(body)))
        val error=runCatching { runBlocking { verifyAniyomiCandidateMedia(OkHttpClient(),listOf(candidate("$base/video"))) } }.exceptionOrNull()
        assertEquals("CANDIDATE_MEDIA_UNVERIFIED",error?.message)
        assertTrue("HTTP cause missing: $error",generateSequence(error) { it.cause }.any { it.message == "CANDIDATE_MEDIA_HTTP_403" })
    }
    @Test fun realHlsFetchPreservesHeadersAndRequiresSegmentBytes() = server { server,base ->
        server.enqueue(MockResponse().setBody("#EXTM3U\n#EXTINF:6,\nseg.ts\n"))
        val bytes=ByteArray(564).also { it[0]=0x47;it[188]=0x47;it[376]=0x47 }
        server.enqueue(MockResponse().setBody(Buffer().write(bytes)))
        runBlocking { verifyAniyomiCandidateMedia(OkHttpClient(),listOf(candidate("$base/master.m3u8"))) }
        for(path in listOf("/master.m3u8","/seg.ts")) {
            val sent=server.takeRequest(1,TimeUnit.SECONDS)!!
            assertEquals(path,sent.path);assertEquals("https://source.example/watch",sent.getHeader("Referer"))
        }
    }
    @Test fun anHtmlSegmentCannotPassWithASuccessfulManifest() = server { server,base ->
        server.enqueue(MockResponse().setBody("#EXTM3U\n#EXTINF:6,\nseg.ts\n"))
        server.enqueue(MockResponse().setBody("<html>verification</html>"))
        val error=runCatching { runBlocking { verifyAniyomiCandidateMedia(OkHttpClient(),listOf(candidate("$base/master.m3u8"))) } }.exceptionOrNull()
        assertEquals("CANDIDATE_MEDIA_UNVERIFIED",error?.message)
    }
    @Test fun timeoutCancelsABlockedPhysicalBodyRead() = server { server,base ->
        server.enqueue(MockResponse().setSocketPolicy(SocketPolicy.NO_RESPONSE))
        val began=System.nanoTime()
        val error=runCatching { runBlocking { withTimeout(300) {
            verifyAniyomiCandidateMedia(OkHttpClient(),listOf(candidate("$base/stall")))
        } } }.exceptionOrNull()
        assertTrue("Timeout was swallowed: ${error?.javaClass?.name}: ${error?.message}; cause=${error?.cause}",error is TimeoutCancellationException)
        assertTrue("Cancellation waited for the 10 second HTTP deadline",TimeUnit.NANOSECONDS.toMillis(System.nanoTime()-began)<3000)
    }
}
