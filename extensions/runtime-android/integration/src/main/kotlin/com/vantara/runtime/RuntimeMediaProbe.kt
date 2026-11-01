package com.vantara.runtime

import dev.vantara.runtime.http.HttpBroker
import kotlinx.coroutines.CancellationException
import kotlinx.serialization.json.*
import okhttp3.Headers
import okhttp3.HttpUrl.Companion.toHttpUrl

/** Bounded host media evidence, not decoder certification. No authentication or DRM bypass.
 * The host additionally owns the total timeout and closes the broker session on cancellation.
 */
internal class RuntimeMediaProbe(private val fetch:(String,Headers)->HttpBroker.Output) {
    fun requirePlayable(links:JsonObject) {
        RuntimeCanaryContract.mediaUrls(links)
        var requests=0
        var last:Exception?=null
        for(raw in (links["items"] as JsonArray).take(3)) {
            val link=raw as? JsonObject ?: continue
            val headers=Headers.Builder()
            (link["headers"] as? JsonObject)?.forEach { (key,value) ->
                (value as? JsonPrimitive)?.contentOrNull?.let { headers.add(key,it) }
            }
            if(link.text("referer").isNotBlank() && headers.get("Referer")==null)headers.set("Referer",link.text("referer"))
            headers.set("Range","bytes=0-${HttpBroker.MAX_PROBE_BYTES-1}")
            try {
                fun probe(url:String,depth:Int,inherited:Headers):Boolean {
                    require(depth<=2 && ++requests<=8) { "CANDIDATE_MEDIA_PROBE_LIMIT" }
                    val response=fetch(url,inherited)
                    require(response.status() in setOf(200,206)) { "CANDIDATE_MEDIA_HTTP_${response.status()}" }
                    val bytes=response.body()
                    val content=response.headers()["Content-Type"].orEmpty().lowercase()
                    require(!content.contains("text/html") && !content.contains("application/xhtml")) { "CANDIDATE_MEDIA_HTML" }
                    if(mediaBytes(bytes))return true
                    val text=bytes.decodeToString().removePrefix("\uFEFF").trimStart()
                    require(text.startsWith("#EXTM3U")) { "CANDIDATE_MEDIA_FORMAT_UNVERIFIED" }
                    // AES-128 is not necessarily DRM. Without authorized key/decoded segment
                    // evidence an encrypted playlist remains unverified; no bypass is attempted.
                    val lines=text.lineSequence().map { it.trim() }.toList()
                    require(lines.none { (it.startsWith("#EXT-X-KEY:") || it.startsWith("#EXT-X-SESSION-KEY:")) &&
                        !Regex("(?:^|,)METHOD=NONE(?:,|$)").containsMatchIn(it.substringAfter(':')) }) {
                        "CANDIDATE_MEDIA_ENCRYPTED_UNVERIFIED"
                    }
                    val master=lines.indexOfFirst { it.startsWith("#EXT-X-STREAM-INF:") }
                    val segment=lines.indexOfFirst { it.startsWith("#EXTINF:") }
                    val at=if(master>=0)master else segment
                    require(at>=0) { "CANDIDATE_MEDIA_SEGMENT_MISSING" }
                    val relative=lines.drop(at+1).firstOrNull { it.isNotBlank() && !it.startsWith('#') }
                        ?: error("CANDIDATE_MEDIA_SEGMENT_MISSING")
                    val from=response.url().toHttpUrl()
                    val target=from.resolve(relative) ?: error("CANDIDATE_MEDIA_URL_INVALID")
                    val next=inherited.newBuilder()
                    if(HttpBroker.origin(from)!=HttpBroker.origin(target)) {
                        for(key in listOf("Authorization","Cookie","Origin","Proxy-Authorization"))next.removeAll(key)
                        if(inherited["Referer"]!=null)next.set("Referer",HttpBroker.origin(from)+"/")
                    }
                    return probe(target.toString(),depth+1,next.build())
                }
                if(probe(link.text("url"),0,headers.build()))return
            }catch(cancel:CancellationException){throw cancel}
            catch(error:Exception){last=error}
        }
        throw IllegalStateException("CANDIDATE_MEDIA_UNVERIFIED",last)
    }
    companion object {
        private fun mediaBytes(bytes:ByteArray):Boolean {
            if(bytes.size>=12 && bytes.copyOfRange(4,8).decodeToString() in setOf("ftyp","styp","moof","mdat"))return true
            if(bytes.size>=4 && bytes.take(4).map { it.toInt() and 255 }==listOf(0x1a,0x45,0xdf,0xa3))return true
            return bytes.size>=377 && listOf(0,188,376).all { bytes[it]==0x47.toByte() }
        }
    }
}
