package dev.vantara.runtime.cloudstream.extractors

import com.lagradost.cloudstream3.SubtitleFile
import com.lagradost.cloudstream3.app
import com.lagradost.cloudstream3.utils.ExtractorLink
import com.lagradost.cloudstream3.utils.ExtractorLinkType
import com.lagradost.cloudstream3.utils.newExtractorLink
import java.net.URI

/**
 * Mixdrop and its mirrors redirect to the current domain; the embed's packed script assigns the media file to
 * `MDCore.wurl` (protocol-relative). Only that assignment is read, never the poster or thumbnail addresses.
 */
object Mixdrop:VantaraExtractor {
    override val name="Mixdrop"
    override val hosts=listOf("mixdrop.co","mixdrop.to","mixdrop.ag","mixdrop.top","mixdrop.ps","mixdrop.sx","mixdrop.club","mixdrop.si","mixdrop.bz","mixdrop.ch",
        "mxdrop.click","mxdrop.to","m1xdrop.com","mixdroop.co","mixdrp.co")
    private val wurl=Regex("""MDCore\.wurl\s*=\s*["']([^"']+)["']""")
    fun mediaAddress(html:String):String? {
        val raw=wurl.find(PlayerPage.scripts(html))?.groupValues?.get(1)?.takeIf{it.isNotBlank()}?:return null
        return if(raw.startsWith("//"))"https:$raw" else raw.takeIf{it.startsWith("http")}
    }
    override suspend fun extract(url:String,referer:String?,subtitles:(SubtitleFile)->Unit,links:(ExtractorLink)->Unit):Boolean {
        val page=app.get(url.replace("/f/","/e/"),referer=referer)
        if(!page.isSuccessful)return false
        val media=mediaAddress(page.text)?:return false
        val origin=URI(page.url).let{"${it.scheme}://${it.host}/"}
        links(newExtractorLink(name,name,media,ExtractorLinkType.VIDEO){this.referer=origin})
        return true
    }
}
