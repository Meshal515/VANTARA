package dev.vantara.runtime.cloudstream.extractors

import com.lagradost.cloudstream3.SubtitleFile
import com.lagradost.cloudstream3.app
import com.lagradost.cloudstream3.mapper
import com.lagradost.cloudstream3.utils.ExtractorLink
import com.lagradost.cloudstream3.utils.ExtractorLinkType
import com.lagradost.cloudstream3.utils.newExtractorLink

/**
 * ok.ru (Odnoklassniki): the embed page carries the player's options in `data-options` (HTML-escaped JSON) whose
 * `flashvars.metadata` lists one address per named quality and an HLS manifest. Every named quality becomes its own
 * link with its real height, so the user chooses the quality. The addresses are bound to the requesting device.
 */
object OkRu:VantaraExtractor {
    override val name="OK.ru"
    override val hosts=listOf("ok.ru","odnoklassniki.ru")
    private val heights=mapOf("mobile" to 144,"lowest" to 240,"low" to 360,"sd" to 480,"hd" to 720,"full" to 1080,"quad" to 1440,"ultra" to 2160)
    private val options=Regex("""data-options="([^"]+)"""")
    private fun unescape(s:String)=s.replace("&quot;","\"").replace("&#39;","'").replace("&lt;","<").replace("&gt;",">").replace("&amp;","&")

    /** (quality name, height, address) for each declared quality, then the HLS manifest as height -1. */
    fun streams(html:String):List<Triple<String,Int,String>> {
        val raw=options.find(html)?.groupValues?.get(1)?:return emptyList()
        val flash=mapper.readTree(unescape(raw)).path("flashvars")
        val node=flash.path("metadata")
        val meta=if(node.isTextual)mapper.readTree(node.asText()) else node
        val out=meta.path("videos").mapNotNull{v->
            val url=v.path("url").asText("");val q=v.path("name").asText("")
            if(url.startsWith("http"))Triple(q,heights[q]?:-1,url) else null
        }.toMutableList()
        meta.path("hlsManifestUrl").asText("").takeIf{it.startsWith("http")}?.let{out+=Triple("hls",-1,it)}
        return out
    }
    override suspend fun extract(url:String,referer:String?,subtitles:(SubtitleFile)->Unit,links:(ExtractorLink)->Unit):Boolean {
        val embed=url.replace("/video/","/videoembed/")
        val page=app.get(embed,referer=referer)
        if(!page.isSuccessful)return false
        val found=streams(page.text)
        for((label,height,address) in found)
            links(newExtractorLink(name,if(height>0)"$name ${height}p" else "$name تلقائي",address,if(label=="hls")ExtractorLinkType.M3U8 else ExtractorLinkType.VIDEO){
                this.referer="https://ok.ru/";this.quality=height
            })
        return found.isNotEmpty()
    }
}
