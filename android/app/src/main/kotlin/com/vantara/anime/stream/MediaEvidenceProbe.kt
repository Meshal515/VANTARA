package com.vantara.anime.stream

import kotlinx.coroutines.CancellationException
import okhttp3.Headers
import okhttp3.HttpUrl.Companion.toHttpUrl

/** Shared bounded format/segment evidence for native extension update admission. Not decoder proof. */
internal class MediaEvidenceProbe(private val fetch:(String,Headers)->Response) {
    data class Link(val url:String,val headers:Headers = Headers.Builder().build())
    data class Response(val url:String,val status:Int,val headers:Headers,val body:ByteArray)
    fun requirePlayable(links:List<Link>) {
        require(links.isNotEmpty()) { "CANDIDATE_MEDIA_EMPTY" }
        var requests=0
        var last:Exception?=null
        for(link in links.take(3)) {
            val headers=link.headers.newBuilder().set("Range","bytes=0-${MAX_PROBE_BYTES-1}")
            try {
                fun probe(url:String,depth:Int,inherited:Headers):Boolean {
                    require(depth<=2 && ++requests<=8) { "CANDIDATE_MEDIA_PROBE_LIMIT" }
                    val response=fetch(url,inherited)
                    require(response.status in setOf(200,206)) { "CANDIDATE_MEDIA_HTTP_${response.status}" }
                    val bytes=response.body
                    val content=response.headers["Content-Type"].orEmpty().lowercase()
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
                    val from=response.url.toHttpUrl()
                    val target=from.resolve(relative) ?: error("CANDIDATE_MEDIA_URL_INVALID")
                    val next=inherited.newBuilder()
                    if(origin(from)!=origin(target)) {
                        for(key in listOf("Authorization","Cookie","Origin","Proxy-Authorization"))next.removeAll(key)
                        if(inherited["Referer"]!=null)next.set("Referer",origin(from)+"/")
                    }
                    return probe(target.toString(),depth+1,next.build())
                }
                if(probe(link.url,0,headers.build()))return
            }catch(cancel:CancellationException){throw cancel}
            catch(error:Exception){last=error}
        }
        throw IllegalStateException("CANDIDATE_MEDIA_UNVERIFIED",last)
    }
    companion object {
        const val MAX_PROBE_BYTES = 64 * 1024
        private fun origin(url:okhttp3.HttpUrl) = url.newBuilder().encodedPath("/").query(null).fragment(null).build().toString().removeSuffix("/")
        private fun mediaBytes(bytes:ByteArray):Boolean {
            if(bytes.size>=12 && bytes.copyOfRange(4,8).decodeToString() in setOf("ftyp","styp","moof","mdat"))return true
            if(bytes.size>=4 && bytes.take(4).map { it.toInt() and 255 }==listOf(0x1a,0x45,0xdf,0xa3))return true
            return bytes.size>=377 && listOf(0,188,376).all { bytes[it]==0x47.toByte() }
        }
    }
}
