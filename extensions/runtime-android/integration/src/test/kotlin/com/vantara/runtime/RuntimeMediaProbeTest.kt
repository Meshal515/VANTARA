package com.vantara.runtime

import dev.vantara.runtime.http.HttpBroker
import kotlinx.serialization.json.*
import okhttp3.Headers
import org.junit.Assert.*
import org.junit.Test

class RuntimeMediaProbeTest {
    private fun links(vararg urls:String)=buildJsonObject {put("items",buildJsonArray {urls.forEach {url->add(buildJsonObject {put("url",url);put("referer","https://source.example/watch")})}})}
    private fun response(url:String,body:ByteArray,status:Int=200,type:String="application/octet-stream")=HttpBroker.Output(url,status,Headers.headersOf("Content-Type",type),body)
    private val ts=ByteArray(564).also {it[0]=0x47;it[188]=0x47;it[376]=0x47}
    private fun rejected(block:()->Unit):Throwable {try{block();fail("Unverified media accepted")}catch(error:IllegalStateException){return error};error("unreachable")}
    @Test fun linkShapeCannotAdmit403OrHtmlEvenWhenMediaUrlLooksValid() {
        for((status,body) in listOf(403 to ts,200 to "<html>blocked</html>".toByteArray())) {
            val error=rejected {RuntimeMediaProbe {url,_->response(url,body,status)}.requirePlayable(links("https://cdn.example/video.mp4"))}
            assertEquals("CANDIDATE_MEDIA_UNVERIFIED",error.message)
        }
    }
    @Test fun hlsManifestRequiresActualSegmentBytesAndStopsAtFirstUsableLink() {
        val visited=mutableListOf<String>()
        val probe=RuntimeMediaProbe {url,headers->
            visited+=url;assertEquals("https://source.example/watch",headers["Referer"])
            response(url,when {url.endsWith("master.m3u8")->"#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=128000\nvariant.m3u8\n".toByteArray()
                url.endsWith("variant.m3u8")->"#EXTM3U\n#EXTINF:6,\nseg.ts\n".toByteArray();else->ts})
        }
        probe.requirePlayable(links("https://cdn.example/master.m3u8","https://unused.example/video.mp4"))
        assertEquals(listOf("https://cdn.example/master.m3u8","https://cdn.example/variant.m3u8","https://cdn.example/seg.ts"),visited)
    }
    @Test fun manifestWith403OrHtmlSegmentIsNotMediaProof() {
        for(status in listOf(200,403))rejected {
            RuntimeMediaProbe {url,_->response(url,if(url.endsWith("m3u8"))"#EXTM3U\n#EXTINF:6,\nseg.ts\n".toByteArray() else "<html>denied</html>".toByteArray(),if(url.endsWith("m3u8"))200 else status)}
                .requirePlayable(links("https://cdn.example/master.m3u8"))
        }
    }
    @Test fun encryptedHlsRemainsExplicitlyUnverified() {
        val error=rejected { RuntimeMediaProbe {url,_->response(url,"#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI=\"key\"\n#EXTINF:6,\nseg.ts\n".toByteArray())}.requirePlayable(links("https://cdn.example/a.m3u8")) }
        assertEquals("CANDIDATE_MEDIA_ENCRYPTED_UNVERIFIED",error.cause?.message)
    }
    @Test fun supportsDirectMp4WebmAndFmp4Segments() {
        val bodies=listOf(byteArrayOf(0,0,0,24)+"ftypisom".toByteArray(),byteArrayOf(0x1a,0x45,0xdf.toByte(),0xa3.toByte()),byteArrayOf(0,0,0,24)+"moofdata".toByteArray())
        bodies.forEach {body->RuntimeMediaProbe {url,_->response(url,body)}.requirePlayable(links("https://cdn.example/media"))}
    }
    @Test fun onlyThreeCandidatesAndEightRequestsCanBeProbed() {
        var count=0
        rejected {RuntimeMediaProbe {url,_->count++;response(url,"html".toByteArray())}.requirePlayable(links(*Array(20){"https://cdn.example/$it"}))}
        assertEquals(3,count)
    }
    @Test fun crossOriginPlaylistDoesNotLeakCredentials() {
        val all=buildJsonObject {put("items",buildJsonArray {add(buildJsonObject {put("url","https://cdn.example/a.m3u8");put("referer","https://source.example/private");put("headers",buildJsonObject {put("Authorization","secret");put("Cookie","session=secret")})})})}
        RuntimeMediaProbe {url,headers->
            if(url.contains("cdn.example"))response(url,"#EXTM3U\n#EXTINF:6,\nhttps://other.example/seg.ts\n".toByteArray()) else {
                assertNull(headers["Authorization"]);assertNull(headers["Cookie"]);assertEquals("https://cdn.example/",headers["Referer"]);response(url,ts)
            }
        }.requirePlayable(all)
    }
}
